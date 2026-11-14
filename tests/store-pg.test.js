// Testa o adaptador PostgreSQL (tabelas relacionais) usando um Postgres em memória (pg-mem).
// Não substitui um teste no Supabase real, mas valida o SQL, o mapeamento, a transação e a migração.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');
const { createStore, migrate, poolConfig, SCHEMA, SCHEMA_VERSION, DB_VERSION } = require('../lib/store');
const { fullSql } = require('../lib/schema');
const { DEFAULT_SERVICES } = require('../lib/defaults');

const DEFAULTS = [{ id: 'manicure', nome: 'Manicure', minutos: 60, preco: 35, icone: '💅', ativo: true }];
const mem = () => { const { Pool } = newDb().adapters.createPg(); return new Pool(); };
const fakeReq = (method) => ({ method });
const fakeRes = () => { const h = {}; return { once: (e, f) => (h[e] = f), emit: (e) => h[e] && h[e]() }; };
const run = (store, method, fn) => new Promise((resolve, reject) => {
  const res = fakeRes();
  store.middleware(fakeReq(method), res, (err) => {
    if (err) return reject(err);
    Promise.resolve(fn(res)).then((v) => { res.emit('close'); resolve(v); }, (e) => { res.emit('close'); reject(e); });
  });
});
const novoStore = async (pool = mem()) => { const s = createStore({ defaultServices: DEFAULTS, pool }); await s.init(); return s; };
const cliente = (id, tel = `5511900000${String(id).padStart(3, '0')}`) => ({ id, name: `Cliente ${id}`, phone: tel, hash: 'x' });
const pedido = (id, userId, extra = {}) => ({ id, userId, clienteNome: 'Maria', clienteTel: '5511912345678', servicoId: 'manicure', servicoNome: 'Manicure', minutos: 60, preco: 35, date: '2026-12-01', time: '10:00', notes: '', status: 'pendente', criadoEm: new Date().toISOString(), ...extra });

test('init cria o esquema e o documento inicial (serviços padrão, contador, configurações)', async () => {
  const store = await novoStore();
  const d = await run(store, 'GET', () => ({ ...store.current() }));
  assert.equal(d.version, SCHEMA_VERSION);
  assert.equal(d.services.length, 1); assert.equal(d.services[0].preco, 35);
  assert.equal(d.seq, 0); assert.deepEqual(d.users, []); assert.equal(d.settings.logo, null);
});

test('init é repetível e não duplica os dados iniciais', async () => {
  const pool = mem();
  await novoStore(pool); const b = await novoStore(pool);
  assert.equal(await run(b, 'GET', () => b.db.services.length), 1);
});

test('todos os tipos de dados fazem ida e volta (cliente, serviço, horário, agendamento, configurações)', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => {
    store.db.users.push(cliente(1));
    store.db.services.push({ id: 's2', nome: 'Spa', minutos: 45, preco: 55.5, icone: '🌿', ativo: false });
    store.db.slots.push({ id: 2, date: '2026-12-01', time: '10:00' }, { id: 3, date: '2026-12-01', time: '11:00' });
    store.db.appointments.push(pedido(4, 1, { notes: 'esmalte nude' }));
    store.db.settings = { studio: 'Studio Teste', logo: 'png', logoV: 99 };
    store.db.seq = 4;
    await store.save();
  });
  const d = await run(store, 'GET', () => JSON.parse(JSON.stringify(store.current())));
  assert.equal(d.users[0].name, 'Cliente 1');
  assert.deepEqual(d.services.map((s) => [s.id, s.preco, s.ativo]), [['manicure', 35, true], ['s2', 55.5, false]], 'ordem e tipos dos serviços');
  assert.deepEqual(d.slots.map((s) => s.time), ['10:00', '11:00']);
  assert.equal(d.appointments[0].notes, 'esmalte nude'); assert.equal(d.appointments[0].preco, 35); assert.equal(d.appointments[0].userId, 1);
  assert.equal(d.appointments[0].status, 'pendente'); assert.ok(d.appointments[0].criadoEm.endsWith('Z'));
  assert.equal(d.settings.studio, 'Studio Teste'); assert.equal(d.seq, 4);
});

test('save grava só o que mudou: alterar, remover e adicionar', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => { store.db.users.push(cliente(1), cliente(2)); store.db.appointments.push(pedido(3, 1), pedido(4, 2, { time: '11:00' })); store.db.seq = 4; await store.save(); });
  await run(store, 'POST', async () => {
    store.db.appointments.find((a) => a.id === 3).status = 'aprovado'; store.db.appointments.find((a) => a.id === 3).atualizadoEm = new Date().toISOString();
    store.db.appointments.splice(store.db.appointments.findIndex((a) => a.id === 4), 1);
    store.db.slots.push({ id: 5, date: '2026-12-02', time: '09:00' }); store.db.seq = 5;
    await store.save();
  });
  const d = await run(store, 'GET', () => JSON.parse(JSON.stringify(store.current())));
  assert.deepEqual(d.appointments.map((a) => [a.id, a.status]), [[3, 'aprovado']]);
  assert.ok(d.appointments[0].atualizadoEm);
  assert.equal(d.slots.length, 1); assert.equal(d.seq, 5);
});

test('excluir cliente apaga os agendamentos dela (cascata) e preserva os outros', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => { store.db.users.push(cliente(1), cliente(2)); store.db.appointments.push(pedido(3, 1), pedido(4, 2, { time: '11:00' })); store.db.seq = 4; await store.save(); });
  await run(store, 'POST', async () => {
    store.db.users.splice(0, 1); store.db.appointments = store.db.appointments.filter((a) => a.userId !== 1); await store.save();
  });
  const d = await run(store, 'GET', () => JSON.parse(JSON.stringify(store.current())));
  assert.deepEqual(d.users.map((u) => u.id), [2]); assert.deepEqual(d.appointments.map((a) => a.id), [4]);
});

test('o banco impede horário duplicado e WhatsApp duplicado (restrições)', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => { store.db.users.push(cliente(1), cliente(2)); store.db.appointments.push(pedido(3, 1)); store.db.seq = 3; await store.save(); });
  // dois pedidos ativos no mesmo dia/hora -> erro 23505 (e a transação inteira é desfeita)
  await assert.rejects(run(store, 'POST', async () => { store.db.appointments.push(pedido(4, 2)); store.db.seq = 4; await store.save(); }), (e) => e.code === '23505' || /unique|duplicate/i.test(e.message));
  await assert.rejects(run(store, 'POST', async () => { store.db.users.push(cliente(9, store.db.users[0].phone)); store.db.seq = 9; await store.save(); }), (e) => e.code === '23505' || /unique|duplicate/i.test(e.message));
  assert.equal(await run(store, 'GET', () => store.db.appointments.length), 1);
  // pedido cancelado não ocupa o horário
  await run(store, 'POST', async () => { store.db.appointments[0].status = 'cancelado'; store.db.appointments.push(pedido(5, 2)); store.db.seq = 5; await store.save(); });
  assert.equal(await run(store, 'GET', () => store.db.appointments.filter((a) => a.status === 'pendente').length), 1);
});

test('requisição que não chama save() não persiste nada (rollback)', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => { store.db.users.push(cliente(1)); /* sem save */ });
  assert.equal(await run(store, 'GET', () => store.db.users.length), 0);
});

test('save() duas vezes na mesma requisição é bloqueado', async () => {
  const store = await novoStore();
  await assert.rejects(run(store, 'POST', async () => { await store.save(); await store.save(); }), /mais de uma vez/);
});

test('contextos simultâneos não se misturam (AsyncLocalStorage)', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => { store.db.seq = 5; await store.save(); });
  const seen = await Promise.all([1, 2, 3, 4, 5].map((i) => run(store, 'GET', async () => { await new Promise((r) => setTimeout(r, 5 * (6 - i))); return store.db.seq; })));
  assert.deepEqual(seen, [5, 5, 5, 5, 5]);
});

test('gravação em lote: 800 horários de uma vez', async () => {
  const store = await novoStore();
  await run(store, 'POST', async () => {
    for (let i = 1; i <= 800; i++) store.db.slots.push({ id: i, date: `2026-12-${String(1 + (i % 28)).padStart(2, '0')}`, time: `${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` });
    store.db.seq = 800; await store.save();
  });
  assert.ok((await run(store, 'GET', () => store.db.slots.length)) > 700);
});

test('importDocument: importa um banco local e recusa sobrescrever dados existentes', async () => {
  const store = await novoStore();
  const local = { seq: 7, users: [cliente(3)], appointments: [pedido(5, 3)], slots: [{ id: 6, date: '2026-12-01', time: '10:00' }], settings: { studio: 'Meu Studio', logo: null, logoV: 0 } };
  const r = await store.importDocument(local);
  assert.deepEqual([r.users, r.appointments, r.slots], [1, 1, 1]);
  const d = await run(store, 'GET', () => JSON.parse(JSON.stringify(store.current())));
  assert.equal(d.settings.studio, 'Meu Studio'); assert.ok(d.seq >= 7); assert.equal(d.services.length, 1, 'serviços padrão preservados');
  await assert.rejects(store.importDocument({ users: [], appointments: [] }), (e) => e.code === 'HAS_DATA');
  assert.equal(await run(store, 'GET', () => store.db.users.length), 1, 'nada foi alterado');
  await store.importDocument({ users: [], appointments: [] }, { force: true });
  assert.equal(await run(store, 'GET', () => store.db.users.length), 0, 'force sobrescreve');
});

test('logo: grava, lê, substitui e remove', async () => {
  const store = await novoStore();
  assert.equal(await store.logo.get(), null);
  await store.logo.put(Buffer.from([1, 2, 3, 4]), 'png');
  const l = await store.logo.get();
  assert.equal(l.mime, 'image/png'); assert.deepEqual([...l.buffer], [1, 2, 3, 4]);
  await store.logo.put(Buffer.from([9]), 'webp');
  assert.equal((await store.logo.get()).mime, 'image/webp');
  await store.logo.del();
  assert.equal(await store.logo.get(), null);
});

test('migração do formato antigo: mantém tudo e ganha os campos novos', () => {
  const velho = { seq: 7, users: [{ id: 3 }], appointments: [{ id: 5 }], slots: [{ id: 6 }] };
  assert.equal(migrate(velho, DEFAULTS), 0);
  assert.equal(velho.users.length, 1); assert.equal(velho.appointments.length, 1); assert.equal(velho.slots.length, 1);
  assert.equal(velho.services.length, 1); assert.equal(velho.version, SCHEMA_VERSION); assert.ok(velho.settings); assert.ok(velho.seq >= 7);
});

// ---------- Supabase ----------
test('supabase/schema.sql está em dia com lib/schema.js (rode "npm run schema" se falhar)', () => {
  const arquivo = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  assert.equal(arquivo, fullSql(SCHEMA, DEFAULT_SERVICES, DB_VERSION));
  for (const t of ['meta', 'users', 'services', 'slots', 'appointments', 'assets']) assert.match(arquivo, new RegExp(`CREATE TABLE IF NOT EXISTS ${SCHEMA}\\.${t}\\b`));
  assert.match(arquivo, /ENABLE ROW LEVEL SECURITY/); assert.match(arquivo, /appointments_slot_ativo_uk/);
});
test('string do pooler do Supabase vira config com SSL e sem parâmetros conflitantes', () => {
  const url = 'postgresql://postgres.abcd:senha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connect_timeout=15';
  const c = poolConfig(url, {});
  assert.deepEqual(c.ssl, { rejectUnauthorized: false });
  assert.ok(!/sslmode|pgbouncer|connect_timeout/.test(c.connectionString));
  assert.match(c.connectionString, /pooler\.supabase\.com:6543\/postgres/);
});
test('DATABASE_SSL_CA ativa a verificação do certificado (\\n literal vira quebra de linha)', () => {
  const c = poolConfig('postgresql://u:p@db.supabase.co:5432/postgres', { DATABASE_SSL_CA: 'LINHA1\\nLINHA2' });
  assert.deepEqual(c.ssl, { ca: 'LINHA1\nLINHA2' });
});
test('Postgres local não usa SSL', () => {
  assert.equal(poolConfig('postgres://u:p@localhost:5432/db', {}).ssl, undefined);
});
