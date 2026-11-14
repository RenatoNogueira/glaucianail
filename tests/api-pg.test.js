// Roda os fluxos principais da API no modo PostgreSQL (produção/Vercel), com pg-mem no lugar do banco real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

// Troca o módulo "pg" pelo Postgres em memória ANTES de carregar o servidor
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: newDb().adapters.createPg() };
Object.assign(process.env, { DATABASE_URL: 'postgres://memoria/teste', ADMIN_USER: 'admin', ADMIN_PASS: 'senha-de-teste-123', SESSION_SECRET: 'segredo-de-teste-bem-longo-0123456789', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', NODE_ENV: '' });
delete process.env.VERCEL;
const app = require('../server');

let server, BASE;
before(async () => { await app.store.init(); await new Promise((r) => (server = app.listen(0, '127.0.0.1', r))); BASE = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

const iso = (d) => d.toLocaleDateString('sv-SE');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
function client() {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
}
const admin = client();
const amanha = iso(addDays(1));
const dow = (d) => new Date(d + 'T12:00:00').getDay();
const novo = async (n) => { const c = client(); const r = await c('/api/register', { method: 'POST', body: { name: `Cliente ${n}`, phone: `119${String(10000000 + n * 137).slice(0, 8)}`, password: 'senha123' } }); assert.equal(r.status, 200, r.text); return c; };

test('saúde: usa PostgreSQL', async () => {
  const r = await client()('/api/health');
  assert.equal(r.json.armazenamento, 'postgres'); assert.equal(r.json.ok, true);
});

test('fluxo completo: horários -> agendar -> aprovar -> persistência entre requisições', async () => {
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'senha-de-teste-123' } })).status, 200);
  const b = await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: amanha, interval: 60, schedule: { [dow(amanha)]: [{ start: '09:00', end: '11:00' }] } } });
  assert.equal(b.json.adicionados, 3);
  const c = await novo(1);
  const ag = await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '09:00' } });
  assert.equal(ag.status, 201);
  assert.deepEqual((await client()(`/api/slots?date=${amanha}`)).json, ['10:00', '11:00']);
  const ok = await admin(`/api/admin/appointments/${ag.json.id}/status`, { method: 'POST', body: { status: 'aprovado' } });
  assert.equal(ok.status, 200);
  assert.equal((await c('/api/appointments')).json[0].status, 'aprovado');
});

test('validação que falha não grava nada (rollback) e não trava o banco', async () => {
  const antes = (await admin('/api/admin/clients')).json.length;
  const r = await client()('/api/register', { method: 'POST', body: { name: 'A', phone: '1', password: '1' } });
  assert.equal(r.status, 400);
  assert.equal((await admin('/api/admin/clients')).json.length, antes);
  assert.equal((await client()('/api/register', { method: 'POST', body: { name: 'Depois Ok', phone: '11955554444', password: '123456' } })).status, 200, 'banco continua livre');
});

test('simultâneos: 8 pedidos no mesmo horário -> só 1 vence', async () => {
  const cs = []; for (let i = 0; i < 8; i++) cs.push(await novo(50 + i));
  const rs = await Promise.all(cs.map((c) => c('/api/appointments', { method: 'POST', body: { service: 'pedicure', date: amanha, time: '11:00' } })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
});

test('logo e nome persistem no banco', async () => {
  assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { studio: 'Studio PG' } })).status, 200);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
  const up = await admin('/api/admin/settings/logo', { method: 'POST', body: { dataUrl: 'data:image/png;base64,' + png } });
  assert.equal(up.status, 200);
  const cfg = (await client()('/api/config')).json;
  assert.equal(cfg.studio, 'Studio PG'); assert.ok(cfg.logo);
  const lg = await fetch(BASE + '/logo'); assert.equal(lg.status, 200); assert.equal(lg.headers.get('content-type'), 'image/png');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(BASE + '/logo')).status, 404);
});

test('backup do admin devolve o banco completo', async () => {
  const r = await admin('/api/admin/backup');
  assert.equal(r.status, 200); assert.ok(r.json.users.length > 0); assert.equal(r.json.version, app.store.SCHEMA_VERSION);
});
