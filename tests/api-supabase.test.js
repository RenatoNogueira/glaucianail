// Roda a API inteira no modo "API do Supabase" (SUPABASE_URL + SUPABASE_SECRET_KEY) contra um Supabase falso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startMock } = require('./helpers/mock-supabase');

let mock, app, server, BASE;
before(async () => {
  mock = await startMock({ key: 'sb_secret_teste' });
  Object.assign(process.env, {
    SUPABASE_URL: mock.url, SUPABASE_SECRET_KEY: 'sb_secret_teste', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_nao_usada',
    ADMIN_USER: 'admin', ADMIN_PASS: 'senha-de-teste-123', SESSION_SECRET: 'segredo-de-teste-bem-longo-0123456789',
    WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', DATABASE_URL: '', POSTGRES_URL: '', POSTGRES_PRISMA_URL: '', NODE_ENV: '', RATE_REGISTER_MAX: '100000', ADMIN_MAX_FAILS: '100000',
  });
  delete process.env.VERCEL;
  app = require('../server');
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await mock.close(); });

const iso = (d) => d.toLocaleDateString('sv-SE');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const dow = (d) => new Date(d + 'T12:00:00').getDay();
function client() {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
}
const admin = client();
const amanha = iso(addDays(1));
const novo = async (n) => { const c = client(); const r = await c('/api/register', { method: 'POST', body: { name: `Cliente ${n}`, phone: `119${String(20000000 + n * 211).slice(0, 8)}`, password: 'senha123' } }); assert.equal(r.status, 200, r.text); return c; };

test('saúde: usa a API do Supabase', async () => {
  const r = await client()('/api/health');
  assert.equal(r.status, 200); assert.equal(r.json.armazenamento, 'supabase-api');
});

test('chave nova (sb_secret_...) vai só no cabeçalho apikey, nunca como Bearer', async () => {
  await client()('/api/config');
  const c = mock.calls.at(-1);
  assert.equal(c.headers.apikey, 'sb_secret_teste'); assert.equal(c.headers.authorization, undefined);
});

test('fluxo completo: horários -> agendar -> aprovar -> persiste', async () => {
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'senha-de-teste-123' } })).status, 200);
  const b = await admin('/api/admin/slots/bulk', { method: 'POST', body: { from: amanha, to: amanha, interval: 60, schedule: { [dow(amanha)]: [{ start: '09:00', end: '11:00' }] } } });
  assert.equal(b.json.adicionados, 3);
  const c = await novo(1);
  const ag = await c('/api/appointments', { method: 'POST', body: { service: 'manicure', date: amanha, time: '09:00', notes: 'esmalte nude' } });
  assert.equal(ag.status, 201);
  assert.deepEqual((await client()(`/api/slots?date=${amanha}`)).json, ['10:00', '11:00']);
  assert.equal((await admin(`/api/admin/appointments/${ag.json.id}/status`, { method: 'POST', body: { status: 'aprovado' } })).status, 200);
  const l = (await c('/api/appointments')).json;
  assert.equal(l[0].status, 'aprovado'); assert.equal(l[0].notes, 'esmalte nude'); assert.equal(l[0].preco, 35);
  // o "banco" (mock) realmente guardou nas tabelas
  assert.equal(mock.state.appointments.length, 1); assert.equal(mock.state.appointments[0].status, 'aprovado'); assert.equal(mock.state.slots.length, 3);
});

test('requisição que falha na validação não grava e solta a trava na hora', async () => {
  const antes = mock.state.users.length;
  assert.equal((await client()('/api/register', { method: 'POST', body: { name: 'A', phone: '1', password: '1' } })).status, 400);
  assert.equal(mock.state.users.length, antes);
  assert.equal(mock.state.meta.lock.token, null, 'trava liberada');
  const t0 = Date.now();
  assert.equal((await client()('/api/register', { method: 'POST', body: { name: 'Depois Ok', phone: '11955554444', password: '123456' } })).status, 200);
  assert.ok(Date.now() - t0 < 2000, 'a próxima escrita não esperou a validade da trava');
});

test('simultâneos: 8 pedidos no mesmo horário -> só 1 vence (a trava serializa as escritas)', async () => {
  const cs = []; for (let i = 0; i < 8; i++) cs.push(await novo(50 + i));
  const rs = await Promise.all(cs.map((c) => c('/api/appointments', { method: 'POST', body: { service: 'pedicure', date: amanha, time: '11:00' } })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  assert.equal(mock.state.appointments.filter((a) => a.dia === amanha && a.hora === '11:00').length, 1);
});

test('simultâneos: cadastros diferentes ao mesmo tempo não se atropelam (ids únicos)', async () => {
  const cs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => novo(80 + i)));
  assert.equal(cs.length, 6);
  const ids = mock.state.users.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos: ' + ids);
});

test('trava abandonada (instância que caiu) expira e não bloqueia para sempre', async () => {
  mock.state.meta.lock = { token: 'morto', until: new Date(Date.now() - 1000).toISOString() };
  const r = await client()('/api/register', { method: 'POST', body: { name: 'Depois Da Queda', phone: '11944443333', password: '123456' } });
  assert.equal(r.status, 200);
});

test('trava presa por outra instância: responde 503 amigável em vez de travar', async () => {
  mock.state.meta.lock = { token: 'outro', until: new Date(Date.now() + 60000).toISOString() };
  const t0 = Date.now();
  const r = await client()('/api/register', { method: 'POST', body: { name: 'Espera Longa', phone: '11933332222', password: '123456' } });
  assert.equal(r.status, 503); assert.ok(r.json.erro); assert.ok(Date.now() - t0 < 12000);
  mock.state.meta.lock = { token: null, until: null };
}, { timeout: 20000 });

test('restrição do banco (23505) vira 409, sem derrubar o sistema', async () => {
  // dois cadastros com o mesmo WhatsApp passam pela validação do app só se o primeiro ainda não existir; aqui forçamos pelo banco
  const c1 = await novo(90);
  const dupe = await client()('/api/register', { method: 'POST', body: { name: 'Mesma Pessoa', phone: mock.state.users.at(-1).phone, password: '123456' } });
  assert.equal(dupe.status, 409); assert.ok(c1);
});

test('nome e logo ficam salvos pelas funções do banco', async () => {
  assert.equal((await admin('/api/admin/settings', { method: 'PUT', body: { studio: 'Studio API' } })).status, 200);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'POST', body: { dataUrl: 'data:image/png;base64,' + png } })).status, 200);
  const cfg = (await client()('/api/config')).json;
  assert.equal(cfg.studio, 'Studio API'); assert.ok(cfg.logo);
  const lg = await fetch(BASE + '/logo'); assert.equal(lg.status, 200); assert.equal(lg.headers.get('content-type'), 'image/png');
  assert.equal((await admin('/api/admin/settings/logo', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(BASE + '/logo')).status, 404);
});

test('exclusão em massa de horários e de cliente (cascata) funcionam no modo API', async () => {
  const lista = (await admin('/api/admin/slots')).json.filter((s) => !s.ocupado).map((s) => s.id);
  const r = await admin('/api/admin/slots/delete-many', { method: 'POST', body: { ids: lista } });
  assert.equal(r.status, 200); assert.equal(r.json.removidos, lista.length);
  const cli = (await admin('/api/admin/clients')).json.find((c) => c.name === 'Cliente 1');
  assert.equal((await admin(`/api/admin/clients/${cli.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!mock.state.users.some((u) => u.id === cli.id));
});
