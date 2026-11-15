// Testes de QA da API. Rode com:  npm test
// Sobe o servidor em uma pasta de dados temporária (nunca toca nos seus dados reais).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 4100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-qa-'));
const ADMIN = { user: 'admin', password: 'senha-de-teste-123' };
let proc;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toLocaleDateString('sv-SE');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// Cliente HTTP com "jar" de cookies
function client() {
  let cookie = '';
  return async (url, { method = 'GET', body, headers = {}, raw } = {}) => {
    const r = await fetch(BASE + url, {
      method,
      headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers, setCookie: sc };
  };
}

async function startServer(extraEnv = {}, dataDir = DATA, port = PORT) {
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_USER: ADMIN.user, ADMIN_PASS: ADMIN.password, SESSION_SECRET: 'segredo-de-teste-bem-longo-0123456789', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', DATABASE_URL: '', POSTGRES_URL: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', NODE_ENV: '', RATE_REGISTER_MAX: '100000', ADMIN_MAX_FAILS: '100000', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/config`); if (r.ok) return p; } catch {}
    if (p.exitCode !== null) break;
    await sleep(150);
  }
  return p;
}

before(async () => { proc = await startServer(); });
after(() => { proc?.kill(); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} });

const admin = client();
const novoCliente = async (n) => {
  const c = client();
  const tel = `11${String(900000000 + n * 7919).slice(0, 9)}`;
  const r = await c('/api/register', { method: 'POST', body: { name: `Cliente ${n}`, phone: tel, password: 'senha123' } });
  assert.equal(r.status, 200, 'cadastro deveria funcionar: ' + r.text);
  return { c, tel };
};

// ---------- Cadastro e login ----------
test('cadastro: valida nome, telefone e senha', async () => {
  const c = client();
  assert.equal((await c('/api/register', { method: 'POST', body: { name: 'A', phone: '11912345678', password: '123456' } })).status, 400);
  assert.equal((await c('/api/register', { method: 'POST', body: { name: 'Maria', phone: '123', password: '123456' } })).status, 400);
  assert.equal((await c('/api/register', { method: 'POST', body: { name: 'Maria', phone: '11912345678', password: '123' } })).status, 400);
});
test('cadastro: nome gigante é recusado', async () => {
  const c = client();
  const r = await c('/api/register', { method: 'POST', body: { name: 'x'.repeat(500), phone: '11911112222', password: '123456' } });
  assert.equal(r.status, 400);
});
test('cadastro: telefone com dígitos demais é recusado', async () => {
  const c = client();
  const r = await c('/api/register', { method: 'POST', body: { name: 'Maria', phone: '1191234567812345678', password: '123456' } });
  assert.equal(r.status, 400);
});
test('cadastro: WhatsApp duplicado (mesmo número, formatos diferentes) é recusado', async () => {
  const a = client(), b = client();
  assert.equal((await a('/api/register', { method: 'POST', body: { name: 'Ana Dup', phone: '(11) 98888-7777', password: '123456' } })).status, 200);
  assert.equal((await b('/api/register', { method: 'POST', body: { name: 'Ana Dup 2', phone: '11988887777', password: '123456' } })).status, 409);
});
test('login: erro genérico e sucesso', async () => {
  const c = client();
  assert.equal((await c('/api/login', { method: 'POST', body: { phone: '11988887777', password: 'errada' } })).status, 401);
  const ok = await c('/api/login', { method: 'POST', body: { phone: '(11) 98888-7777', password: '123456' } });
  assert.equal(ok.status, 200);
  assert.equal((await c('/api/me')).json.user.name, 'Ana Dup');
});
test('sessão: cookie é HttpOnly e SameSite', async () => {
  const c = client();
  const r = await c('/api/login', { method: 'POST', body: { phone: '11988887777', password: '123456' } });
  const ck = r.setCookie.join(';').toLowerCase();
  assert.match(ck, /httponly/); assert.match(ck, /samesite=/);
});
test('sessão: cookie adulterado é ignorado', async () => {
  const c = client();
  const r = await c('/api/me', { headers: { Cookie: 'sid=eyJ1Ijoz.fake' } });
  assert.equal(r.json.user, null); assert.equal(r.json.admin, false);
});
test('rotas protegidas exigem login', async () => {
  const c = client();
  for (const [m, u] of [['GET', '/api/appointments'], ['POST', '/api/appointments'], ['GET', '/api/admin/appointments'], ['GET', '/api/admin/clients'], ['GET', '/api/admin/backup'], ['PUT', '/api/admin/settings'], ['DELETE', '/api/admin/services/manicure']]) {
    assert.equal((await c(u, { method: m, body: m === 'GET' ? undefined : {} })).status, 401, `${m} ${u}`);
  }
});

// ---------- Administrador ----------
test('admin: login incorreto e correto', async () => {
  const c = client();
  assert.equal((await c('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'x' } })).status, 401);
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: ADMIN })).status, 200);
});
test('admin: login tem limite de tentativas (força bruta)', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 12; i++) last = await c('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'errada' + i } });
  assert.equal(last.status, 429, 'depois de várias falhas deveria bloquear');
  const ok = await c('/api/admin/login', { method: 'POST', body: ADMIN });
  assert.equal(ok.status, 429, 'mesmo a senha certa deve esperar o bloqueio');
});

const amanha = iso(addDays(1)), depois = iso(addDays(2));
const diaSemana = (d) => new Date(d + 'T12:00:00').getDay();

test('agenda: criar horários, validar entradas', async () => {
  const sched = (d) => ({ [diaSemana(d)]: [{ start: '09:00', end: '11:00' }] });
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: '2026-02-31', to: '2026-03-02', interval: 60, schedule: { 1: [{ start: '09:00', end: '10:00' }] } } })).status, 400, 'data inexistente');
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: amanha, interval: 60, schedule: { 1: [{ start: '12:00', end: '09:00' }] } } })).status, 400, 'faixa invertida');
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: iso(addDays(900)), interval: 15, schedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '00:00', end: '23:45' }]])) } })).status, 400, 'excesso de horários');
  const r = await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: depois, interval: 60, schedule: { ...sched(amanha), ...sched(depois) } } });
  assert.equal(r.status, 200); assert.equal(r.json.adicionados, 6);
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: depois, interval: 60, schedule: { ...sched(amanha), ...sched(depois) } } })).json.adicionados, 0, 'não duplica');
});
test('agenda pública: só mostra horários livres e futuros', async () => {
  const c = client();
  const d = await c('/api/available-days');
  assert.equal(d.json[amanha], 3);
  assert.deepEqual((await c(`/api/slots?date=${amanha}`)).json, ['09:00', '10:00', '11:00']);
  assert.deepEqual((await c('/api/slots?date=2026-02-31')).json, []);
  assert.deepEqual((await c('/api/slots?date=lixo')).json, []);
  assert.deepEqual((await c(`/api/slots?date=${iso(addDays(-3))}`)).json, []);
});

// ---------- Agendamento ----------
test('agendar: sucesso, horário some, repetir falha', async () => {
  const { c } = await novoCliente(1);
  const r = await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '09:00', notes: 'n'.repeat(1000) } });
  assert.equal(r.status, 201); assert.equal(r.json.status, 'pendente'); assert.ok(r.json.notes.length <= 300);
  assert.deepEqual((await c(`/api/slots?date=${amanha}`)).json, ['10:00', '11:00']);
  assert.equal((await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '09:00' } })).status, 409);
});
test('agendar: horário não publicado, serviço inválido, data passada', async () => {
  const { c } = await novoCliente(2);
  assert.equal((await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '15:00' } })).status, 409);
  assert.equal((await c('/api/appointments', { method: 'POST', body: { service: 'nao-existe', date: amanha, time: '10:00' } })).status, 400);
  assert.equal((await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: iso(addDays(-1)), time: '10:00' } })).status, 409);
  assert.equal((await c('/api/appointments', { method: 'POST', body: {} })).status, 400);
});
test('agendar: 10 pedidos simultâneos no mesmo horário -> só 1 vence', async () => {
  const cs = [];
  for (let i = 0; i < 10; i++) cs.push((await novoCliente(100 + i)).c);
  const rs = await Promise.all(cs.map((c) => c('/api/appointments', { method: 'POST', body: { service: 'pedicure', date: depois, time: '09:00' } })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, 'exatamente um deve ganhar');
  assert.equal(rs.filter((r) => r.status === 409).length, 9);
});
test('agendar: limite de pedidos ativos por cliente', async () => {
  const { c } = await novoCliente(3);
  const extra = iso(addDays(5));
  await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: extra, to: extra, interval: 30, schedule: { [diaSemana(extra)]: [{ start: '08:00', end: '12:00' }] } } });
  const resultados = [];
  for (const t of ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00']) resultados.push((await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: extra, time: t } })).status);
  assert.ok(resultados.includes(429) || resultados.includes(409), 'deveria limitar pedidos ativos: ' + resultados);
  assert.ok(resultados.filter((s) => s === 201).length <= 5);
});
test('cancelar: libera horário; não cancela de outra pessoa', async () => {
  const a = await novoCliente(4), b = await novoCliente(5);
  const ag = (await a.c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '10:00' } })).json;
  assert.equal((await b.c(`/api/appointments/${ag.id}/cancel`, { method: 'POST' })).status, 404);
  assert.equal((await a.c(`/api/appointments/${ag.id}/cancel`, { method: 'POST' })).status, 200);
  assert.ok((await a.c(`/api/slots?date=${amanha}`)).json.includes('10:00'));
  assert.equal((await a.c(`/api/appointments/${ag.id}/cancel`, { method: 'POST' })).status, 400, 'cancelar duas vezes');
});

// ---------- Aprovação ----------
test('admin: aprovar/recusar só vale para pedidos pendentes', async () => {
  const a = await novoCliente(6);
  const ag = (await a.c('/api/appointments', { method: 'POST', body: { service: 'combo', date: amanha, time: '10:00' } })).json;
  assert.equal((await admin(`/api/admin/appointments/${ag.id}/status`, { method: 'POST', body: { status: 'xyz' } })).status, 400);
  const ok = await admin(`/api/admin/appointments/${ag.id}/status`, { method: 'POST', body: { status: 'aprovado', message: 'Até lá!' } });
  assert.equal(ok.status, 200); assert.match(ok.json.whatsapp.link, /^https:\/\/wa\.me\/55\d+\?text=/);
  assert.equal((await admin(`/api/admin/appointments/${ag.id}/status`, { method: 'POST', body: { status: 'recusado' } })).status, 409, 'já decidido');
  await a.c(`/api/appointments/${ag.id}/cancel`, { method: 'POST' });
  const re = await admin(`/api/admin/appointments/${ag.id}/status`, { method: 'POST', body: { status: 'aprovado' } });
  assert.ok(re.status >= 400, 'não pode aprovar um pedido cancelado (status ' + re.status + ')');
});

// ---------- CRUD ----------
test('serviços: criar, validar, editar, excluir, proteger o último ativo', async () => {
  assert.equal((await admin('/api/admin/services', { method: 'POST', body: { nome: 'x', minutos: 5, preco: -1 } })).status, 400);
  const s = await admin('/api/admin/services', { method: 'POST', body: { nome: 'Spa dos pés', minutos: 45, preco: 55.559, icone: '🌿' } });
  assert.equal(s.status, 201); assert.equal(s.json.preco, 55.56);
  assert.equal((await admin(`/api/admin/services/${s.json.id}`, { method: 'PUT', body: { nome: 'Spa', minutos: 30, preco: 40, ativo: false } })).json.ativo, false);
  assert.ok(!(await client()('/api/config')).json.servicos.some((x) => x.id === s.json.id), 'inativo não aparece');
  assert.equal((await admin(`/api/admin/services/${s.json.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await admin('/api/admin/services/nao-existe', { method: 'DELETE' })).status, 404);
});
test('clientes: editar com WhatsApp repetido falha; excluir apaga agendamentos e derruba a sessão', async () => {
  const a = await novoCliente(7), b = await novoCliente(8);
  const lista = (await admin('/api/admin/clients')).json;
  const ca = lista.find((x) => x.name === 'Cliente 7'), cb = lista.find((x) => x.name === 'Cliente 8');
  assert.equal((await admin(`/api/admin/clients/${ca.id}`, { method: 'PUT', body: { name: 'Cliente 7', phone: cb.phone } })).status, 409);
  const ag = (await a.c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '11:00' } })).json;
  assert.equal((await admin(`/api/admin/clients/${ca.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a.c('/api/appointments')).status, 401);
  assert.ok((await b.c(`/api/slots?date=${amanha}`)).json.includes('11:00'), 'horário liberado');
  assert.ok(ag.id);
});
test('configurações: nome e logo', async () => {
  assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { studio: 'x' } })).status, 400);
  assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { studio: 'Studio Teste' } })).status, 200);
  assert.equal((await client()('/api/config')).json.studio, 'Studio Teste');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'POST', body: { dataUrl: 'data:image/png;base64,SGVsbG8gd29ybGQhISEhISEh' } })).status, 400, 'png falso');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'POST', body: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } })).status, 400, 'svg');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
  const up = await admin('/api/admin/settings/logo', { method: 'POST', body: { dataUrl: 'data:image/png;base64,' + png } });
  assert.equal(up.status, 200); assert.ok(up.json.logo);
  const lg = await fetch(BASE + '/logo'); assert.equal(lg.status, 200); assert.equal(lg.headers.get('content-type'), 'image/png');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(BASE + '/logo')).status, 404);
});

// ---------- Robustez e segurança ----------
test('JSON malformado devolve erro em JSON (não HTML/stack)', async () => {
  const r = await client()('/api/login', { method: 'POST', body: '{ nao eh json', raw: true, headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.ok(r.json && r.json.erro, 'esperava {erro}, veio: ' + r.text.slice(0, 80));
  assert.ok(!/at .*node_modules|SyntaxError/.test(r.text), 'não pode vazar stack trace');
});
test('requisição de outra origem (CSRF) é bloqueada', async () => {
  const r = await client()('/api/login', { method: 'POST', body: { phone: '11988887777', password: '123456' }, headers: { Origin: 'https://site-malicioso.example' } });
  assert.equal(r.status, 403);
});
test('endpoint de saúde informa a data no fuso do Brasil', async () => {
  const r = await client()('/api/health');
  assert.equal(r.status, 200);
  const esperado = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  assert.equal(r.json.hoje, esperado);
});
test('produção com credenciais ausentes/padrão: sobe, mas bloqueia tudo e /api/health lista as variáveis', async () => {
  const faltando = await healthDe({ NODE_ENV: 'production', ADMIN_PASS: '', SESSION_SECRET: '' }, PORT + 500);
  assert.equal(faltando.status, 503); assert.equal(faltando.json.etapa, 'configuracao');
  assert.ok(faltando.json.variaveis.some((v) => v.startsWith('ADMIN_PASS')) && faltando.json.variaveis.some((v) => v.startsWith('SESSION_SECRET')));
  assert.equal(faltando.config, 503, 'nenhuma rota funciona com configuração insegura');
  const exemplo = await healthDe({ NODE_ENV: 'production', ADMIN_PASS: 'admin123', SESSION_SECRET: 'troque-este-segredo' }, PORT + 505);
  assert.equal(exemplo.status, 503); assert.equal(exemplo.json.variaveis.length, 2, 'valores de exemplo são recusados');
  const ok = await healthDe({ NODE_ENV: 'production', ADMIN_PASS: 'uma-senha-forte-123', SESSION_SECRET: 'segredo-bem-longo-e-aleatorio-1234' }, PORT + 506);
  assert.equal(ok.status, 200); assert.equal(ok.config, 200);
});
test('dados persistem entre reinicializações', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-qa-persist-'));
  const port = PORT + 600;
  let p = await startServer({}, dir, port);
  const hit = async (u, o) => { const r = await fetch(`http://127.0.0.1:${port}${u}`, o); return r.json(); };
  await fetch(`http://127.0.0.1:${port}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Persistente', phone: '11977776666', password: '123456' }) });
  p.kill(); await sleep(400);
  p = await startServer({}, dir, port);
  const l = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '11977776666', password: '123456' }) });
  p.kill(); fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(l.status, 200); void hit;
});

// ---------- Exclusão em massa de horários ----------
test('agenda: excluir vários horários de uma vez (reservados são preservados)', async () => {
  const dia = iso(addDays(8));
  await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: dia, to: dia, interval: 60, schedule: { [diaSemana(dia)]: [{ start: '09:00', end: '14:00' }] } } });
  const lista = (await admin('/api/admin/slots')).json.filter((s) => s.date === dia);
  assert.equal(lista.length, 6);
  const { c } = await novoCliente(60);
  assert.equal((await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: dia, time: '10:00' } })).status, 201);
  assert.equal((await admin('/api/admin/slots/delete-many', { method: 'POST', body: { ids: [] } })).status, 400);
  assert.equal((await admin('/api/admin/slots/delete-many', { method: 'POST', body: { ids: ['x'] } })).status, 400);
  assert.equal((await client()('/api/admin/slots/delete-many', { method: 'POST', body: { ids: [1] } })).status, 401);
  const r = await admin('/api/admin/slots/delete-many', { method: 'POST', body: { ids: lista.map((s) => s.id) } });
  assert.equal(r.status, 200); assert.equal(r.json.removidos, 5); assert.equal(r.json.reservados, 1);
  const depois = (await admin('/api/admin/slots')).json.filter((s) => s.date === dia);
  assert.deepEqual(depois.map((s) => s.time), ['10:00']);
  assert.equal(depois[0].ocupado, true);
});

// ---------- Diagnóstico de implantação (Vercel) ----------
async function healthDe(extraEnv, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-qa-diag-'));
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_USER: ADMIN.user, ADMIN_PASS: ADMIN.password, SESSION_SECRET: 'segredo-de-teste-bem-longo-0123456789', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', DATABASE_URL: '', POSTGRES_URL: '', POSTGRES_PRISMA_URL: '', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', NODE_ENV: '', VERCEL: '', ...extraEnv }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); return { status: r.status, json: await r.json(), config: (await fetch(`http://127.0.0.1:${port}/api/config`)).status }; } catch { await sleep(150); }
    }
    throw new Error('servidor não subiu');
  } finally { p.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}
test('Vercel sem DATABASE_URL: /api/health explica o problema (e /api/config falha de forma controlada)', async () => {
  const h = await healthDe({ VERCEL: '1' }, PORT + 700);
  assert.equal(h.status, 503); assert.equal(h.json.ok, false); assert.equal(h.json.codigo, 'SEM_DATABASE_URL');
  assert.match(h.json.dica, /DATABASE_URL/); assert.equal(h.config, 500);
  assert.ok(!JSON.stringify(h.json).includes('senha-de-teste'), 'não vaza segredos');
});
test('banco inacessível: /api/health informa código e dica, sem expor a string de conexão', async () => {
  const h = await healthDe({ DATABASE_URL: 'postgresql://usuario:SENHA-SECRETA@127.0.0.1:1/db' }, PORT + 710);
  assert.equal(h.status, 503); assert.equal(h.json.ok, false); assert.match(h.json.codigo, /ECONNREFUSED|ETIMEDOUT|AggregateError/);
  assert.match(h.json.dica, /6543|pooler|conectar/i);
  assert.ok(!JSON.stringify(h.json).includes('SENHA-SECRETA'));
});
test('saúde OK no modo arquivo', async () => {
  const h = await healthDe({}, PORT + 720);
  assert.equal(h.status, 200); assert.equal(h.json.ok, true); assert.equal(h.json.armazenamento, 'arquivo');
});

// ---------- Diagnóstico no modo API do Supabase ----------
const { startMock } = require('./helpers/mock-supabase');
test('Supabase API: funções do banco ausentes -> /api/health manda rodar supabase/schema.sql', async () => {
  const m = await startMock({ key: 'sb_secret_ok' }); m.flags.semFuncoes = true;
  try {
    const h = await healthDe({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: 'sb_secret_ok' }, PORT + 730);
    assert.equal(h.status, 503); assert.equal(h.json.codigo, 'SCHEMA_AUSENTE'); assert.match(h.json.dica, /schema.sql/);
  } finally { await m.close(); }
});
test('Supabase API: chave errada -> dica para usar a chave secreta (e a chave não vaza)', async () => {
  const m = await startMock({ key: 'sb_secret_certa' });
  try {
    const h = await healthDe({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: 'sb_secret_ERRADA_123' }, PORT + 740);
    assert.equal(h.status, 503); assert.equal(h.json.codigo, 'PGRST301'); assert.match(h.json.dica, /SECRETA|secreta/);
    assert.ok(!JSON.stringify(h.json).includes('ERRADA_123'));
  } finally { await m.close(); }
});
test('Supabase API: funcionando -> health ok com armazenamento supabase-api', async () => {
  const m = await startMock({ key: 'sb_secret_ok' });
  try {
    const h = await healthDe({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: 'sb_secret_ok' }, PORT + 750);
    assert.equal(h.status, 200); assert.equal(h.json.armazenamento, 'supabase-api');
  } finally { await m.close(); }
});
test('Supabase API: chave legada (JWT) também vai em Authorization', async () => {
  const m = await startMock({ key: 'eyJhbGciOi.legada.chave' });
  try {
    const h = await healthDe({ SUPABASE_URL: m.url, SUPABASE_SECRET_KEY: 'eyJhbGciOi.legada.chave' }, PORT + 760);
    assert.equal(h.status, 200);
    assert.equal(m.calls.at(-1).headers.authorization, 'Bearer eyJhbGciOi.legada.chave');
  } finally { await m.close(); }
});

// ---------- Textos da página inicial ----------
test('página inicial: padrão público, edição pela admin, limites e restauração', async () => {
  const pub = client();
  const padrao = (await pub('/api/config')).json.textos;
  assert.equal(padrao.botaoPrincipal, 'Agendar agora'); assert.match(padrao.titulo, /cuidados/);
  assert.equal((await pub('/api/admin/landing')).status, 401);
  assert.equal((await pub('/api/admin/landing', { method: 'PUT', body: { valores: {} } })).status, 401);

  const g = await admin('/api/admin/landing');
  assert.equal(g.status, 200); assert.ok(g.json.campos.length >= 20); assert.ok(g.json.grupos.length >= 5); assert.deepEqual(g.json.valores, {});

  const ok = await admin('/api/admin/landing', { method: 'PUT', body: { valores: { titulo: '  Studio *Glaucia* — unhas  perfeitas  ', botaoPrincipal: 'Quero agendar', subtitulo: '' } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.valores, { titulo: 'Studio *Glaucia* — unhas perfeitas', botaoPrincipal: 'Quero agendar' }, 'espaços normalizados; vazio não é guardado');
  const cfg = (await pub('/api/config')).json.textos;
  assert.equal(cfg.titulo, 'Studio *Glaucia* — unhas perfeitas'); assert.equal(cfg.botaoPrincipal, 'Quero agendar');
  assert.equal(cfg.subtitulo, padrao.subtitulo, 'campo não editado mantém o padrão');

  assert.equal((await admin('/api/admin/landing', { method: 'PUT', body: { valores: { naoExiste: 'x' } } })).status, 400);
  assert.equal((await admin('/api/admin/landing', { method: 'PUT', body: { valores: { badge: 'x'.repeat(200) } } })).status, 400);
  assert.equal((await admin('/api/admin/landing', { method: 'PUT', body: { valores: { badge: 123 } } })).status, 400);
  assert.equal((await admin('/api/admin/landing', { method: 'PUT', body: { valores: [] } })).status, 400);
  assert.equal((await pub('/api/config')).json.textos.botaoPrincipal, 'Quero agendar', 'pedido inválido não altera nada');

  // HTML digitado fica como texto (o front usa textContent); quebras de linha viram espaço
  const x = await admin('/api/admin/landing', { method: 'PUT', body: { valores: { badge: '<img src=x onerror=alert(1)>\nlinha 2' } } });
  assert.equal(x.json.valores.badge, '<img src=x onerror=alert(1)> linha 2');

  assert.equal((await admin('/api/admin/landing', { method: 'PUT', body: { valores: {} } })).status, 200);
  assert.equal((await pub('/api/config')).json.textos.botaoPrincipal, 'Agendar agora', 'restaurado');
});

// ---------- App instalável (PWA) ----------
test('PWA: manifesto do site usa o nome atual do estúdio e lista os ícones', async () => {
  const pub = client();
  assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { studio: 'Glaucia Nail Design' } })).status, 200);
  const r = await fetch(BASE + '/manifest.webmanifest');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
  const m = await r.json();
  assert.equal(m.name, 'Glaucia Nail Design'); assert.ok(m.short_name.length <= 12); assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/'); assert.equal(m.scope, '/'); assert.equal(m.lang, 'pt-BR');
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), sizes.join(','));
  for (const i of m.icons) assert.equal((await fetch(BASE + i.src)).status, 200, i.src);
  void pub;
});
test('PWA: o painel admin NÃO é instalável (sem manifesto e sem botão)', async () => {
  assert.equal((await fetch(BASE + '/manifest-admin.webmanifest')).status, 404);
  const painel = await (await fetch(BASE + '/admin.html')).text();
  assert.ok(!/manifest|data-install/.test(painel), 'admin.html não pode oferecer instalação');
});
test('PWA: ícones são PNG válidos com o tamanho declarado', async () => {
  for (const [arq, lado] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const b = Buffer.from(await (await fetch(BASE + '/' + arq)).arrayBuffer());
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], arq + ' não é PNG');
    assert.equal(b.readUInt32BE(16), lado, arq + ' largura'); assert.equal(b.readUInt32BE(20), lado, arq + ' altura');
  }
});
test('PWA: service worker e página offline existem; o service worker não guarda dados da API', async () => {
  const sw = await fetch(BASE + '/sw.js'); assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
  const codigo = await sw.text();
  assert.match(codigo, /addEventListener\('fetch'/); assert.match(codigo, /startsWith\('\/api\/'\)/); assert.match(codigo, /startsWith\('\/admin'\)/);
  assert.equal((await fetch(BASE + '/offline.html')).status, 200);
});
test('PWA: o site aponta para o manifesto e para os ícones', async () => {
  const site = await (await fetch(BASE + '/')).text();
  assert.match(site, /rel="manifest" href="\/manifest\.webmanifest"/); assert.match(site, /apple-touch-icon/); assert.match(site, /data-install/);
});
test('PWA: vercel.json encaminha o manifesto para a função', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const fontes = v.rewrites.map((r) => r.source);
  assert.ok(fontes.includes('/manifest.webmanifest') && !fontes.includes('/manifest-admin.webmanifest'));
  assert.ok(v.headers.some((h) => h.source === '/sw.js'));
});

test('agenda: calendário mensal publica só nos dias escolhidos', async () => {
  const d1 = iso(addDays(40)), d2 = iso(addDays(47));
  const todos = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: '09:00', end: '10:00' }]]));
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { dates: [], interval: 60, schedule: todos } })).status, 400, 'sem dias');
  assert.equal((await admin('/api/admin/slots/bulk', { method: 'POST', body: { dates: ['2026-02-31'], interval: 60, schedule: todos } })).status, 400, 'data inválida');
  const r = await admin('/api/admin/slots/bulk', { method: 'POST', body: { dates: [d1, d2], interval: 60, schedule: todos } });
  assert.equal(r.json.adicionados, 4);
  const dias = new Set((await admin('/api/admin/slots')).json.filter((s) => s.date >= d1 && s.date <= d2).map((s) => s.date));
  assert.deepEqual([...dias].sort(), [d1, d2].sort(), 'dias do meio ficam sem horários');
});

test('avaliações: estrelas públicas, validação, limite e exclusão pelo admin', async () => {
  const c = client();
  assert.equal((await c('/api/reviews', { method: 'POST', body: { estrelas: 6, nome: 'Ana' } })).status, 400, 'nota inválida');
  assert.equal((await c('/api/reviews', { method: 'POST', body: { estrelas: 5, nome: '' } })).status, 400, 'sem nome');
  const a = await c('/api/reviews', { method: 'POST', body: { estrelas: 5, nome: 'Ana', texto: '<b>Amei</b>' } });
  assert.equal(a.status, 201);
  assert.equal((await c('/api/reviews', { method: 'POST', body: { estrelas: 4, nome: 'Bia' } })).status, 201);
  const l = (await c('/api/reviews')).json;
  assert.equal(l.total, 2); assert.equal(l.media, 4.5); assert.equal(l.itens.length, 1, 'só comentários aparecem');
  const adm = (await admin('/api/admin/reviews')).json;
  assert.equal((await admin('/api/admin/reviews/' + adm.itens[0].id, { method: 'DELETE' })).status, 200);
  assert.equal((await c('/api/reviews')).json.total, 1);
  assert.equal((await c('/api/admin/reviews')).status, 401, 'lista admin é restrita');
});

test('avaliações: admin oculta, fecha e desliga a seção', async () => {
  const c = client();
  await c('/api/reviews', { method: 'POST', body: { estrelas: 3, nome: 'Carla', texto: 'ok' } });
  const l = (await admin('/api/admin/reviews')).json;
  const id = l.itens[0].id, antes = l.total;
  assert.equal((await admin('/api/admin/reviews/' + id, { method: 'PATCH', body: { oculto: 'sim' } })).status, 400);
  assert.equal((await admin('/api/admin/reviews/' + id, { method: 'PATCH', body: { oculto: true } })).status, 200);
  const dep = (await admin('/api/admin/reviews')).json;
  assert.equal(dep.total, antes - 1, 'oculta sai da média'); assert.equal(dep.ocultas, 1);
  assert.ok(!(await c('/api/reviews')).json.itens.some((i) => i.nome === 'Carla'), 'oculta não aparece no site');
  assert.equal((await c('/api/admin/reviews/' + id, { method: 'PATCH', body: { oculto: false } })).status, 401, 'só o admin');
  assert.equal((await admin('/api/admin/reviews-config', { method: 'PUT', body: { exibir: true, aberto: false } })).status, 200);
  assert.equal((await c('/api/reviews', { method: 'POST', body: { estrelas: 5, nome: 'Dani' } })).status, 403, 'fechadas');
  await admin('/api/admin/reviews-config', { method: 'PUT', body: { exibir: false, aberto: true } });
  assert.equal((await c('/api/reviews')).json.exibir, false, 'seção desligada');
  await admin('/api/admin/reviews-config', { method: 'PUT', body: { exibir: true, aberto: true } });
});

// ---------- Segurança ----------
test('segurança: cabeçalhos (CSP, HSTS...) no site e na API; vercel.json igual ao servidor; hash do script confere', async () => {
  const security = require('../lib/security');
  const c = client();
  const r = await c('/api/config');
  const esperado = security.headers();
  for (const [k, v] of Object.entries(esperado)) assert.equal(r.headers.get(k.toLowerCase()), v, 'cabeçalho ' + k);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/); assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const pagina = await c('/'); assert.equal(pagina.headers.get('content-security-policy'), csp, 'páginas estáticas também');
  // todo script embutido nas páginas precisa estar liberado pelo hash da CSP
  for (const f of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const h = "'sha256-" + require('node:crypto').createHash('sha256').update(m[1]).digest('base64') + "'";
      assert.ok(csp.includes(h), 'hash do script de ' + f + ' fora da CSP (rode npm run headers)');
    }
    assert.doesNotMatch(html, /\son(click|load|error|change|submit)=/i, f + ' não pode ter manipuladores inline (CSP)');
  }
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers.find((h) => h.source === '/(.*)').headers;
  assert.deepEqual(Object.fromEntries(vj.map((h) => [h.key, h.value])), esperado, 'vercel.json desatualizado: rode npm run headers');
});

test('segurança: cadastro em massa é freado e login do admin trava globalmente após muitas falhas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-sec-')), port = PORT + 777;
  const p = await startServer({ RATE_REGISTER_MAX: '3', ADMIN_MAX_FAILS: '4' }, dir, port);
  try {
    const call = async (url, body, ip) => { const r = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) }); return r.status; };
    let st = [];
    for (let i = 0; i < 4; i++) st.push(await call('/api/register', { name: 'Fulana ' + i, phone: '1190000000' + i, password: 'senha123' }, '9.9.9.9'));
    assert.deepEqual(st, [200, 200, 200, 429], 'o 4º cadastro do mesmo IP é barrado');
    // falhas vindas de IPs diferentes (o freio por IP não pega), mas o freio global sim
    st = [];
    for (let i = 0; i < 5; i++) st.push(await call('/api/admin/login', { user: 'admin', password: 'errada' + i }, '8.8.8.' + i));
    assert.deepEqual(st, [401, 401, 401, 401, 429]);
    // com o travamento ativo, nem a senha certa entra
    assert.equal(await call('/api/admin/login', ADMIN, '7.7.7.7'), 429);
  } finally { p.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('segurança: sessão do admin vale 2 h; cookie é HttpOnly + SameSite; assinatura adulterada é recusada', async () => {
  const c = client();
  const r = await c('/api/admin/login', { method: 'POST', body: ADMIN, headers: { 'X-Forwarded-For': '6.6.6.6' } }); // IP à parte: o teste de força bruta acima bloqueou o 127.0.0.1
  assert.equal(r.status, 200);
  const ck = r.setCookie[0];
  assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Lax/); assert.match(ck, /Max-Age=7200/);
  const falso = client();
  const [corpo] = decodeURIComponent(ck.split(';')[0].split('=')[1]).split('.');
  const forjado = Buffer.from(JSON.stringify({ a: true, exp: Date.now() + 1e7 })).toString('base64url');
  assert.equal((await falso('/api/admin/appointments', { headers: { Cookie: 'sid=' + forjado + '.assinaturaFalsa' } })).status, 401, 'cookie forjado');
  assert.equal((await falso('/api/admin/appointments', { headers: { Cookie: 'sid=' + corpo + '.abc' } })).status, 401, 'assinatura trocada');
  assert.equal((await falso('/api/admin/backup')).status, 401, 'backup é restrito');
  assert.equal((await falso('/api/admin/reviews')).status, 401);
});

test('segurança: origem externa não consegue alterar dados (CSRF) e JSON inválido não vaza detalhes', async () => {
  const c = client();
  const r = await c('/api/register', { method: 'POST', body: { name: 'Mal', phone: '11988887777', password: 'senha123' }, headers: { Origin: 'https://site-malicioso.example' } });
  assert.equal(r.status, 403);
  const j = await c('/api/login', { method: 'POST', raw: true, body: '{quebrado', headers: { 'Content-Type': 'application/json' } });
  assert.equal(j.status, 400); assert.doesNotMatch(j.text, /SyntaxError|at /);
});
