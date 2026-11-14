// Camada de armazenamento.
//  - Local (padrão): arquivo JSON em DATA_DIR, com backups automáticos e escrita atômica.
//  - Vercel/produção: PostgreSQL relacional (Supabase) via DATABASE_URL / POSTGRES_URL — o disco da Vercel não é persistente.
// O resto do sistema usa o objeto `db` (um Proxy para o banco da requisição atual) e `await save()`.
// No Postgres, a cada requisição o banco é lido das tabelas para o objeto `db`, e o `save()` grava só as linhas que mudaram.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { ddl, seedSql, SCHEMA_RE } = require('./schema');

const SCHEMA_VERSION = 4; // versão do formato do documento (usado pelo modo arquivo e pela migração)
const DB_VERSION = 1;     // versão da estrutura de tabelas do Postgres (guardada em meta.version)
const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// As tabelas ficam num schema próprio ("agenda"), que o Supabase NÃO expõe na API pública (PostgREST).
const SCHEMA = process.env.DB_SCHEMA || 'agenda';
if (!SCHEMA_RE.test(SCHEMA)) throw new Error('DB_SCHEMA inválido (use letras minúsculas, números e _).');

// Configuração do pool. Supabase: use a string do "Transaction pooler" (porta 6543) — a conexão direta é só IPv6 e
// não funciona na Vercel. O Supabase exige SSL; por padrão não verificamos o certificado (defina DATABASE_SSL_CA para verificar).
function poolConfig(url, env = process.env) {
  const cfg = { connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 };
  try {
    const u = new URL(url);
    ['sslmode', 'pgbouncer', 'connect_timeout', 'supa'].forEach((k) => u.searchParams.delete(k)); // evitam conflito com o ssl abaixo
    cfg.connectionString = u.toString();
    if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
      cfg.ssl = env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : { rejectUnauthorized: false };
    }
  } catch { /* string fora do padrão: usa como veio */ }
  return cfg;
}

// Atualiza dados antigos para a estrutura atual, sem nunca descartar registros existentes
function migrate(d, defaultServices) {
  const from = d.version || 0;
  d.users = d.users || []; d.appointments = d.appointments || []; d.slots = d.slots || []; d.seq = d.seq || 0;
  if (!d.services) d.services = defaultServices.map((s) => ({ ...s })); // v2: catálogo de serviços editável
  d.services.forEach((s) => { if (s.ativo === undefined) s.ativo = true; if (!s.icone) s.icone = '💅'; });
  d.settings = d.settings || { studio: null, logo: null, logoV: 0 }; // v4: nome e logo editáveis
  const ids = [...d.users, ...d.appointments, ...d.slots].map((x) => +x.id || 0);
  d.seq = Math.max(d.seq, ...ids); // garante que novos ids nunca repitam
  d.version = SCHEMA_VERSION;
  return from;
}

// ---------- Mapeamento documento <-> tabelas (PostgreSQL) ----------
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const TABLES = [
  { name: 'users', key: 'users', cols: ['id', 'name', 'phone', 'hash'],
    toRow: (u) => [u.id, u.name, u.phone, u.hash],
    fromRow: (r) => ({ id: r.id, name: r.name, phone: r.phone, hash: r.hash }) },
  { name: 'services', key: 'services', cols: ['id', 'nome', 'minutos', 'preco', 'icone', 'ativo', 'pos'], order: 'pos, id',
    toRow: (s, i) => [s.id, s.nome, s.minutos, s.preco, s.icone, s.ativo !== false, i],
    fromRow: (r) => ({ id: r.id, nome: r.nome, minutos: r.minutos, preco: Number(r.preco), icone: r.icone, ativo: r.ativo }) },
  { name: 'slots', key: 'slots', cols: ['id', 'dia', 'hora'],
    toRow: (s) => [s.id, s.date, s.time],
    fromRow: (r) => ({ id: r.id, date: r.dia, time: r.hora }) },
  { name: 'appointments', key: 'appointments',
    cols: ['id', 'user_id', 'cliente_nome', 'cliente_tel', 'servico_id', 'servico_nome', 'minutos', 'preco', 'dia', 'hora', 'notes', 'status', 'criado_em', 'atualizado_em'],
    toRow: (a) => [a.id, a.userId, a.clienteNome, a.clienteTel, a.servicoId || null, a.servicoNome, a.minutos, a.preco, a.date, a.time, a.notes || '', a.status, a.criadoEm || new Date().toISOString(), a.atualizadoEm || null],
    fromRow: (r) => {
      const a = { id: r.id, userId: r.user_id, clienteNome: r.cliente_nome, clienteTel: r.cliente_tel, servicoId: r.servico_id, servicoNome: r.servico_nome, minutos: r.minutos, preco: Number(r.preco), date: r.dia, time: r.hora, notes: r.notes, status: r.status, criadoEm: iso(r.criado_em) };
      if (r.atualizado_em) a.atualizadoEm = iso(r.atualizado_em);
      return a;
    } },
];
const DELETE_ORDER = ['appointments', 'slots', 'services', 'users']; // appointments antes de users (chave estrangeira)
const UPSERT_ORDER = ['users', 'services', 'slots', 'appointments'];
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// "Foto" do que está no banco, para gravar depois só o que mudou (usada pelo Postgres e pela API do Supabase)
function snapshotOf(doc) {
  const snap = { meta: JSON.stringify([doc.seq, doc.settings]) };
  TABLES.forEach((t) => { snap[t.name] = new Map(doc[t.key].map((x, i) => [x.id, JSON.stringify(t.toRow(x, i))])); });
  return snap;
}

// Calcula o que mudou entre o banco lido (snap) e o estado atual (doc): linhas a remover e a inserir/atualizar
function diffChanges(doc, snap) {
  const deletes = {}, upserts = {}; let count = 0;
  for (const name of DELETE_ORDER) {
    const t = TABLES.find((x) => x.name === name);
    const keep = new Set(doc[t.key].map((x) => x.id));
    const gone = [...snap[name].keys()].filter((id) => !keep.has(id));
    if (gone.length) { deletes[name] = gone; count += gone.length; }
  }
  for (const name of UPSERT_ORDER) {
    const t = TABLES.find((x) => x.name === name);
    const rows = doc[t.key].map((x, i) => t.toRow(x, i)).filter((row) => snap[name].get(row[0]) !== JSON.stringify(row));
    if (rows.length) { upserts[name] = rows.map((row) => Object.fromEntries(t.cols.map((c, k) => [c, row[k]]))); count += rows.length; }
  }
  const metaChanged = snap.meta !== JSON.stringify([doc.seq, doc.settings]);
  if (metaChanged) count++;
  return { deletes, upserts, meta: metaChanged ? { seq: doc.seq, settings: doc.settings } : null, count };
}

function createStore({ defaultServices, dataDir, databaseUrl, pool: injectedPool, supabaseUrl = '', supabaseKey = '', requirePg = false }) {
  const als = new AsyncLocalStorage();
  const usePg = !!(injectedPool || databaseUrl);                    // PostgreSQL direto (string de conexão)
  const useRest = !usePg && !!(supabaseUrl && supabaseKey);         // API do Supabase (URL + chave secreta)
  const useFile = !usePg && !useRest;                                // arquivo local
  let fileDb = null;      // modo arquivo: um único objeto em memória
  let pool = injectedPool || null;
  let ready;

  const current = () => {
    const ctx = als.getStore();
    if (ctx) return ctx.db;
    if (useFile) return fileDb;
    throw new Error('Banco acessado fora de uma requisição.');
  };
  // `db` age como o banco da requisição atual (seguro com várias requisições simultâneas)
  const db = new Proxy({}, { get: (_, k) => current()[k], set: (_, k, v) => { current()[k] = v; return true; } });

  // ===================== Modo arquivo =====================
  const file = {};
  if (useFile) {
    const DATA_DIR = dataDir;
    const DB_FILE = path.join(DATA_DIR, 'db.json');
    const BACKUP_DIR = path.join(DATA_DIR, 'backups');
    const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // dentro de DATA_DIR: sobrevive a atualizações
    const MAX_BACKUPS = 40;
    const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const listBackups = () => fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort();

    const backup = (tag) => {
      if (!fs.existsSync(DB_FILE)) return;
      try {
        fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-${stamp()}-${tag}.json`));
        const all = listBackups();
        all.slice(0, Math.max(0, all.length - MAX_BACKUPS)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      } catch (e) { console.warn('Falha ao criar backup:', e.message); }
    };
    const backupIfOlderThan = (hours, tag) => {
      const last = listBackups().pop();
      const age = last ? Date.now() - fs.statSync(path.join(BACKUP_DIR, last)).mtimeMs : Infinity;
      if (age > hours * 3600e3) backup(tag);
    };
    const loadDb = () => {
      if (!fs.existsSync(DB_FILE)) {
        if (fs.existsSync(DB_FILE + '.tmp')) { try { return readJson(DB_FILE + '.tmp'); } catch {} } // gravação interrompida
        return null; // primeira execução
      }
      try { return readJson(DB_FILE); } catch (e) {
        console.error('⚠ db.json ilegível:', e.message);
        for (const f of listBackups().reverse()) {
          try {
            const d = readJson(path.join(BACKUP_DIR, f));
            fs.copyFileSync(DB_FILE, DB_FILE + '.corrompido-' + Date.now()); // guarda o arquivo ruim para análise
            console.warn('✔ Dados restaurados do backup', f);
            return d;
          } catch {}
        }
        console.error('✖ Nenhum backup válido. Encerrando para NÃO sobrescrever seus dados. Verifique:', DB_FILE);
        process.exit(1);
      }
    };
    const writeDb = () => {
      fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(fileDb, null, 2));
      fs.renameSync(DB_FILE + '.tmp', DB_FILE); // troca atômica: nunca deixa o arquivo pela metade
    };
    let lastBackupDay = '';

    file.init = () => {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fileDb = loadDb();
      const first = !fileDb;
      if (first) fileDb = {};
      const from = migrate(fileDb, defaultServices);
      if (!first && from !== SCHEMA_VERSION) backup(`pre-migracao-v${from}`); // cópia antes de gravar a nova estrutura
      writeDb();
      backupIfOlderThan(6, 'inicio');
    };
    file.save = () => {
      writeDb();
      const day = new Date().toLocaleDateString('sv-SE');
      if (day !== lastBackupDay) { lastBackupDay = day; backupIfOlderThan(20, 'diario'); }
    };
    const clearLogoFiles = () => Object.keys(LOGO_TYPES).forEach((e) => fs.rmSync(path.join(UPLOAD_DIR, 'logo.' + e), { force: true }));
    file.logoGet = () => {
      const ext = fileDb.settings.logo; if (!ext) return null;
      const f = path.join(UPLOAD_DIR, 'logo.' + ext);
      return fs.existsSync(f) ? { mime: LOGO_TYPES[ext], buffer: fs.readFileSync(f) } : null;
    };
    file.logoPut = (buf, ext) => { clearLogoFiles(); fs.writeFileSync(path.join(UPLOAD_DIR, 'logo.' + ext), buf); };
    file.logoDel = () => clearLogoFiles();
    file.logoExists = () => { const l = fileDb.settings.logo; return !!l && fs.existsSync(path.join(UPLOAD_DIR, 'logo.' + l)); };
  }

  // ===================== Modo PostgreSQL (relacional) =====================
  const S = SCHEMA;
  const pg = { snapshot: snapshotOf };
  if (usePg) {
    // Lê as tabelas e monta o objeto `db` (formato único usado pelo restante do sistema)
    pg.load = async (run, parallel) => {
      const queries = [`SELECT key, value FROM ${S}.meta`, ...TABLES.map((t) => `SELECT * FROM ${S}.${t.name} ORDER BY ${t.order || 'id'}`)];
      const results = [];
      if (parallel) results.push(...(await Promise.all(queries.map((q) => run(q))))); else for (const q of queries) results.push(await run(q));
      const meta = Object.fromEntries(results[0].rows.map((r) => [r.key, r.value]));
      const doc = { version: SCHEMA_VERSION, seq: (meta.seq && meta.seq.n) || 0, settings: meta.settings || { studio: null, logo: null, logoV: 0 } };
      TABLES.forEach((t, i) => { doc[t.key] = results[i + 1].rows.map(t.fromRow); });
      return doc;
    };
    pg.write = async (c, doc, snap) => {
      const ch = diffChanges(doc, snap);
      for (const name of DELETE_ORDER) {
        const gone = ch.deletes[name] || [];
        for (const part of chunk(gone, 500)) await c.query(`DELETE FROM ${S}.${name} WHERE id IN (${part.map((_, i) => '$' + (i + 1)).join(',')})`, part);
      }
      for (const name of UPSERT_ORDER) {
        const t = TABLES.find((x) => x.name === name);
        const changed = (ch.upserts[name] || []).map((o) => t.cols.map((c0) => o[c0]));
        const per = Math.max(1, Math.min(200, Math.floor(30000 / t.cols.length)));
        const set = t.cols.filter((c0) => c0 !== 'id').map((c0) => `${c0}=EXCLUDED.${c0}`).join(', ');
        for (const part of chunk(changed, per)) {
          const values = part.map((_, r) => '(' + t.cols.map((__, k) => '$' + (r * t.cols.length + k + 1)).join(',') + ')').join(',');
          await c.query(`INSERT INTO ${S}.${t.name} (${t.cols.join(',')}) VALUES ${values} ON CONFLICT (id) DO UPDATE SET ${set}`, part.flat());
        }
      }
      if (ch.meta) await c.query(`INSERT INTO ${S}.meta (key, value) VALUES ('seq', $1), ('settings', $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ n: doc.seq }), JSON.stringify(doc.settings)]);
    };
    // A linha meta.seq é a "trava": quem a segura escreve sozinho (dois pedidos simultâneos nunca se sobrescrevem)
    pg.lock = (c) => c.query(`SELECT value FROM ${S}.meta WHERE key='seq' FOR UPDATE`);

    pg.init = async () => {
      if (!pool) {
        const { Pool } = require('pg');
        pool = new Pool(poolConfig(databaseUrl));
        pool.on('error', (e) => console.error('Erro no pool do Postgres:', e.message));
      }
      let ok = false;
      try { ok = (await pool.query(`SELECT 1 FROM ${S}.meta WHERE key='version' AND value = $1::jsonb`, [JSON.stringify(DB_VERSION)])).rows.length > 0; } catch { ok = false; }
      if (ok) return; // estrutura já criada e atualizada
      for (const st of ddl(S)) await pool.query(st.sql).catch((e) => { if (!st.optional) throw e; });
      const first = (await pool.query(`SELECT 1 FROM ${S}.meta WHERE key='seq'`)).rows.length === 0;
      if (first) for (const sql of seedSql(S, defaultServices, DB_VERSION)) await pool.query(sql);
      await pool.query(`INSERT INTO ${S}.meta (key, value) VALUES ('version', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(DB_VERSION)]);
    };
  }

  // ===================== Modo API do Supabase (URL + chave secreta) =====================
  // Fala com as funções RPC criadas por supabase/schema.sql. As tabelas ficam em schema privado: a API só enxerga as funções.
  const rest = {};
  if (useRest) {
    const base = supabaseUrl.replace(/\/+$/, '');
    const headers = { apikey: supabaseKey, 'Content-Type': 'application/json' };
    if (!supabaseKey.startsWith('sb_')) headers.Authorization = `Bearer ${supabaseKey}`; // chaves novas (sb_...) vão só no apikey; as antigas (JWT) também no Authorization
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    rest.rpc = async (name, args = {}) => {
      let r;
      try { r = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(12000) }); }
      catch (e) { const err = new Error('Falha de rede ao falar com o Supabase: ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message)); err.code = (e.cause && e.cause.code) || e.name; throw err; }
      const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
      if (!r.ok) {
        const err = new Error((body && (body.message || body.msg || body.error_description)) || `HTTP ${r.status}`);
        err.code = (body && body.code) || String(r.status); err.status = r.status; err.details = body && body.details;
        throw err;
      }
      return body;
    };
    rest.fromRaw = (raw) => {
      const meta = raw.meta || {};
      const doc = { version: SCHEMA_VERSION, seq: (meta.seq && meta.seq.n) || 0, settings: meta.settings || { studio: null, logo: null, logoV: 0 } };
      TABLES.forEach((t) => { doc[t.key] = (raw[t.name] || []).map(t.fromRow); });
      return doc;
    };
    rest.load = async () => rest.fromRaw(await rest.rpc('agenda_load'));
    // Trava de escrita (lease no banco): só um pedido altera os dados por vez, mesmo em várias instâncias
    rest.acquire = async (token) => {
      const t0 = Date.now(); let wait = 80;
      for (;;) {
        if ((await rest.rpc('agenda_lock', { p_token: token, p_ttl: 10 })) === true) return;
        if (Date.now() - t0 > 8000) { const e = new Error('Sistema ocupado. Tente novamente.'); e.code = 'LOCK_TIMEOUT'; throw e; }
        await sleep(wait + Math.random() * wait); wait = Math.min(wait * 1.5, 400);
      }
    };
    rest.unlock = (token) => rest.rpc('agenda_unlock', { p_token: token }).catch(() => {});
    rest.init = async () => {
      try { await rest.rpc('agenda_load'); }
      catch (e) {
        if (['PGRST202', '42883', '42P01', '404'].includes(String(e.code))) { const x = new Error('As funções do banco não foram criadas. Rode supabase/schema.sql no SQL Editor do Supabase.'); x.code = 'SCHEMA_AUSENTE'; throw x; }
        throw e;
      }
    };
  }

  // ===================== Interface comum =====================
  // Se a inicialização falhar (ex.: banco fora do ar), a próxima requisição tenta de novo em vez de ficar quebrada
  const init = () => {
    if (!ready) {
      ready = (async () => {
        if (useFile && requirePg) { // na Vercel o disco não é permanente: sem banco, não há como guardar dados
          const e = new Error('Nenhum banco configurado (DATABASE_URL ou SUPABASE_URL + SUPABASE_SECRET_KEY).'); e.code = 'SEM_DATABASE_URL'; throw e;
        }
        return usePg ? pg.init() : useRest ? rest.init() : file.init();
      })().catch((e) => { ready = null; throw e; });
    }
    return ready;
  };

  // Middleware: abre o "contexto" do banco para cada requisição.
  // Leituras (GET) só consultam. Escritas abrem uma transação e travam (meta.seq FOR UPDATE).
  const middleware = (req, res, next) => {
    (async () => {
      await init();
      if (useFile) return als.run({ db: fileDb }, next);
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (useRest) {
        if (!mutating) return als.run({ db: await rest.load() }, next);
        const token = crypto.randomUUID();
        await rest.acquire(token);
        let doc; try { doc = await rest.load(); } catch (e) { await rest.unlock(token); throw e; }
        const ctx = { db: doc, snap: pg.snapshot(doc), token, held: true };
        // Se a requisição terminar sem gravar (ex.: erro de validação), solta a trava ANTES de responder
        const end = res.end.bind(res);
        res.end = (...a) => { if (!ctx.held) return end(...a); ctx.held = false; rest.unlock(token).then(() => end(...a)); return res; };
        return als.run(ctx, next);
      }
      const ctx = { db: null, client: null, snap: null };
      if (mutating) {
        ctx.client = await pool.connect();
        try {
          await ctx.client.query('BEGIN');
          await pg.lock(ctx.client);
          ctx.db = await pg.load((q) => ctx.client.query(q), false);
          ctx.snap = pg.snapshot(ctx.db);
        } catch (e) { await ctx.client.query('ROLLBACK').catch(() => {}); ctx.client.release(); throw e; }
        res.once('close', async () => { // se ninguém gravou (ex.: erro de validação), desfaz e solta a conexão
          if (!ctx.client) return;
          const c = ctx.client; ctx.client = null;
          await c.query('ROLLBACK').catch(() => {}); c.release();
        });
      } else {
        ctx.db = await pg.load((q) => pool.query(q), true);
      }
      als.run(ctx, next);
    })().catch(next);
  };

  // Grava o banco da requisição atual
  const save = async () => {
    if (useFile) return file.save();
    const ctx = als.getStore();
    if (useRest) {
      if (!ctx.held) throw new Error('save() chamado mais de uma vez na mesma requisição (gravaria sem a trava do banco).');
      const ch = diffChanges(ctx.db, ctx.snap);
      if (!ch.count) return; // nada mudou: a trava é solta ao responder
      await rest.rpc('agenda_apply', { p_token: ctx.token, p_changes: { deletes: ch.deletes, upserts: ch.upserts, meta: ch.meta } });
      ctx.held = false; // a própria função solta a trava ao concluir
      return;
    }
    if (!ctx.client) throw new Error('save() chamado mais de uma vez na mesma requisição (gravaria sem a trava do banco).');
    const c = ctx.client; ctx.client = null;
    try { await pg.write(c, ctx.db, ctx.snap); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };

  // Importa um documento completo (ex.: data/db.json) para o Postgres. Recusa se já houver dados, a menos que force.
  const importDocument = async (doc, { force = false } = {}) => {
    if (useFile) throw new Error('importDocument só vale no modo PostgreSQL/Supabase.');
    await init();
    migrate(doc, defaultServices);
    if (useRest) {
      const token = crypto.randomUUID();
      await rest.acquire(token);
      try {
        const cur = await rest.load();
        if ((cur.users.length || cur.appointments.length) && !force) { const e = new Error(`O banco de destino já tem dados (${cur.users.length} clientes, ${cur.appointments.length} agendamentos).`); e.code = 'HAS_DATA'; throw e; }
        const ch = diffChanges(doc, pg.snapshot(cur));
        await rest.rpc('agenda_apply', { p_token: token, p_changes: { deletes: ch.deletes, upserts: ch.upserts, meta: ch.meta } });
      } catch (e) { await rest.unlock(token); throw e; }
      return { users: doc.users.length, appointments: doc.appointments.length, slots: doc.slots.length, services: doc.services.length };
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await pg.lock(c);
      const cur = await pg.load((q) => c.query(q), false);
      if ((cur.users.length || cur.appointments.length) && !force) {
        const e = new Error(`O banco de destino já tem dados (${cur.users.length} clientes, ${cur.appointments.length} agendamentos).`); e.code = 'HAS_DATA'; throw e;
      }
      await pg.write(c, doc, pg.snapshot(cur));
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    return { users: doc.users.length, appointments: doc.appointments.length, slots: doc.slots.length, services: doc.services.length };
  };

  const logo = {
    async get() {
      if (useFile) return file.logoGet();
      if (useRest) { const r = await rest.rpc('agenda_logo_get'); return r ? { mime: r.mime, buffer: Buffer.from(r.data, 'base64') } : null; }
      const r = await pool.query(`SELECT mime, data FROM ${S}.assets WHERE name='logo'`);
      return r.rows[0] ? { mime: r.rows[0].mime, buffer: Buffer.from(r.rows[0].data, 'base64') } : null;
    },
    async put(buf, ext) {
      if (useFile) return file.logoPut(buf, ext);
      if (useRest) return void (await rest.rpc('agenda_logo_put', { p_mime: LOGO_TYPES[ext], p_data: buf.toString('base64') }));
      await pool.query(`INSERT INTO ${S}.assets (name, mime, data) VALUES ('logo', $1, $2) ON CONFLICT (name) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data`, [LOGO_TYPES[ext], buf.toString('base64')]);
    },
    async del() {
      if (useFile) return file.logoDel();
      if (useRest) return void (await rest.rpc('agenda_logo_del'));
      await pool.query(`DELETE FROM ${S}.assets WHERE name='logo'`);
    },
    exists: () => (useFile ? file.logoExists() : !!db.settings.logo),
  };

  return { kind: usePg ? 'postgres' : useRest ? 'supabase-api' : 'arquivo', init, middleware, db, save, logo, current, importDocument, LOGO_TYPES, SCHEMA_VERSION, close: () => pool && pool.end() };
}

module.exports = { createStore, migrate, diffChanges, poolConfig, TABLES, SCHEMA, SCHEMA_VERSION, DB_VERSION, LOGO_TYPES };
