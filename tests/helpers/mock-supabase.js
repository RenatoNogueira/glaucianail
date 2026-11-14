// "Supabase falso" para testes: emula as funções RPC de supabase/schema.sql (agenda_load, agenda_lock, agenda_apply...)
// em memória, com a mesma semântica (trava com validade, aplicação atômica, restrições de unicidade).
// Valida o protocolo e a lógica do adaptador; NÃO valida o SQL em si (isso só um Postgres real faz).
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function novoEstado() {
  return {
    meta: { seq: { n: 0 }, version: 1, settings: { studio: null, logo: null, logoV: 0 }, lock: { token: null, until: null } },
    users: [], slots: [], appointments: [], logo: null,
    services: [
      { id: 'manicure', nome: 'Manicure', minutos: 60, preco: 35, icone: '💅', ativo: true, pos: 0 },
      { id: 'pedicure', nome: 'Pé de curi (Pedicure)', minutos: 60, preco: 40, icone: '🦶', ativo: true, pos: 1 },
    ],
  };
}

function startMock({ key = 'sb_secret_teste' } = {}) {
  const state = novoEstado();
  const calls = []; // { fn, headers }
  const flags = { semFuncoes: false, latencia: [2, 8] };

  const erro = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code, message, details: null, hint: null })); };
  const ok = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body === undefined || body === null ? 'null' : JSON.stringify(body)); };

  const handlers = {
    agenda_load: () => JSON.parse(JSON.stringify({
      meta: state.meta,
      users: state.users.map((u) => ({ ...u })),
      services: [...state.services].sort((a, b) => a.pos - b.pos || a.id.localeCompare(b.id)),
      slots: [...state.slots].sort((a, b) => a.id - b.id),
      appointments: [...state.appointments].sort((a, b) => a.id - b.id),
    })),
    agenda_lock: ({ p_token, p_ttl = 10 }) => {
      const lk = state.meta.lock;
      if (lk.token === null || new Date(lk.until).getTime() <= Date.now()) { state.meta.lock = { token: p_token, until: new Date(Date.now() + p_ttl * 1000).toISOString() }; return true; }
      return false;
    },
    agenda_unlock: ({ p_token }) => { if (state.meta.lock.token === p_token) state.meta.lock = { token: null, until: null }; return null; },
    agenda_apply: ({ p_token, p_changes: ch }) => {
      const lk = state.meta.lock;
      if (lk.token !== p_token || new Date(lk.until).getTime() <= Date.now()) throw Object.assign(new Error('lock_lost'), { code: 'P0001' });
      // aplica numa cópia e só confirma se todas as restrições passarem (atomicidade)
      const t = JSON.parse(JSON.stringify({ users: state.users, services: state.services, slots: state.slots, appointments: state.appointments }));
      const del = (tab, ids) => { t[tab] = t[tab].filter((r) => !(ids || []).includes(r.id)); };
      del('appointments', ch.deletes && ch.deletes.appointments); del('slots', ch.deletes && ch.deletes.slots);
      del('services', ch.deletes && ch.deletes.services); del('users', ch.deletes && ch.deletes.users);
      const up = (tab, rows, extra) => { for (const row of rows || []) { const i = t[tab].findIndex((r) => r.id === row.id); const novo = { ...(i >= 0 ? t[tab][i] : extra || {}), ...row }; if (i >= 0) t[tab][i] = novo; else t[tab].push(novo); } };
      up('users', ch.upserts && ch.upserts.users, { created_at: new Date().toISOString() });
      up('services', ch.upserts && ch.upserts.services); up('slots', ch.upserts && ch.upserts.slots); up('appointments', ch.upserts && ch.upserts.appointments);
      const dup = (arr, f) => new Set(arr.map(f)).size !== arr.length;
      if (dup(t.users, (u) => u.phone)) throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_key"'), { code: '23505' });
      if (dup(t.slots, (s) => s.dia + ' ' + s.hora)) throw Object.assign(new Error('duplicate key value violates unique constraint "slots_dia_hora_key"'), { code: '23505' });
      if (dup(t.appointments.filter((a) => ['pendente', 'aprovado'].includes(a.status)), (a) => a.dia + ' ' + a.hora)) throw Object.assign(new Error('duplicate key value violates unique constraint "appointments_slot_ativo_uk"'), { code: '23505' });
      if (t.appointments.some((a) => !t.users.some((u) => u.id === a.user_id))) throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
      Object.assign(state, t);
      if (ch.meta) { state.meta.seq = { n: ch.meta.seq }; state.meta.settings = ch.meta.settings; }
      state.meta.lock = { token: null, until: null };
      return null;
    },
    agenda_logo_get: () => (state.logo ? { mime: state.logo.mime, data: state.logo.data } : null),
    agenda_logo_put: ({ p_mime, p_data }) => { state.logo = { mime: p_mime, data: p_data }; return null; },
    agenda_logo_del: () => { state.logo = null; return null; },
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url);
        if (!m) return erro(res, 404, '404', 'rota desconhecida');
        calls.push({ fn: m[1], headers: req.headers });
        if (req.headers.apikey !== key) return erro(res, 401, 'PGRST301', 'Invalid API key');
        if (flags.semFuncoes || !handlers[m[1]]) return erro(res, 404, 'PGRST202', `Could not find the function public.${m[1]} in the schema cache`);
        await sleep(flags.latencia[0] + Math.random() * (flags.latencia[1] - flags.latencia[0])); // latência de rede: expõe corridas
        const out = handlers[m[1]](raw ? JSON.parse(raw) : {});
        ok(res, out);
      } catch (e) { erro(res, e.code === 'P0001' ? 400 : 409, e.code || '500', e.message); }
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, key, state, calls, flags,
    reset: () => Object.assign(state, novoEstado()), close: () => new Promise((r) => server.close(r)),
  })));
}

module.exports = { startMock };
