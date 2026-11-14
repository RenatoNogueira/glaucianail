const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createStore } = require('./lib/store');
const { createSessions, createLimiter } = require('./lib/session');

// --- .env local (na Vercel as variáveis vêm do painel do projeto) ---
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch {}

const env = process.env;
const PROD = env.NODE_ENV === 'production' || !!env.VERCEL;
const PORT = env.PORT || 3000;
const TZ_NAME = env.TZ_NAME || 'America/Sao_Paulo'; // servidores da Vercel rodam em UTC: o fuso do estúdio é explícito
const ADMIN_USER = env.ADMIN_USER || 'admin';
const STUDIO = env.STUDIO_NAME || 'Studio Manicure & Pedicure';

// Em produção, credenciais fracas/padrão não são aceitas. Em vez de derrubar a função (erro genérico da Vercel),
// o sistema sobe e responde 503 explicando quais variáveis faltam (veja /api/health).
const configErros = [];
if (PROD) {
  const erros = [];
  const exemplos = ['admin123', 'troque-esta-senha', 'troque-este-segredo', 'dev-secret-troque']; // valores públicos (código/.env.example)
  if (!env.ADMIN_PASS || env.ADMIN_PASS.length < 8 || exemplos.includes(env.ADMIN_PASS)) erros.push('ADMIN_PASS (mínimo 8 caracteres e diferente dos exemplos)');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16 || exemplos.includes(env.SESSION_SECRET)) erros.push('SESSION_SECRET (mínimo 16 caracteres e diferente dos exemplos)');
  configErros.push(...erros);
  if (erros.length) console.error('✖ Configuração insegura para produção. Defina: ' + erros.join(' e '));
}
const ADMIN_HASH = bcrypt.hashSync(env.ADMIN_PASS || 'admin123', 10);
if (!PROD && !env.ADMIN_PASS) console.warn('⚠ Usando senha de admin padrão. Defina ADMIN_PASS no .env.');

const { DEFAULT_SERVICES } = require('./lib/defaults');

// --- Armazenamento (arquivo local ou PostgreSQL) ---
const store = createStore({
  defaultServices: DEFAULT_SERVICES,
  dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(__dirname, 'data'),
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || '',
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', // chave SECRETA: só no servidor, nunca no navegador
  requirePg: !!env.VERCEL,
});
const { db, save, LOGO_TYPES } = store;
const nextId = () => ++db.seq;
if (PROD && store.kind === 'arquivo') console.warn('⚠ Produção sem banco configurado (DATABASE_URL ou SUPABASE_URL + SUPABASE_SECRET_KEY): os dados ficarão em arquivo e podem ser perdidos (ex.: na Vercel).');

const getStudio = () => db.settings.studio || STUDIO;
const logoUrl = () => (db.settings.logo && store.logo.exists() ? `/logo?v=${db.settings.logoV}` : null);
function sniffImage(buf) { // confere o conteúdo real do arquivo, não só o que o navegador declarou
  if (buf.length > 12 && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// --- Utilidades ---
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
const digits = (p) => String(p || '').replace(/\D/g, '');
const normPhone = (p) => { const d = digits(p); return d.length <= 11 ? '55' + d : d; }; // assume Brasil se vier sem DDI
const validPhone = (tel) => /^55\d{10,11}$/.test(tel); // 55 + DDD + número
const isDate = (s) => { // rejeita datas que não existem (ex.: 31/02), que o JavaScript "arredondaria"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const tzParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
const todayStr = () => { const p = tzParts(); return `${p.year}-${p.month}-${p.day}`; };
const nowMin = () => { const p = tzParts(); return +p.hour * 60 + +p.minute; };
const fmtDate = (s) => s.split('-').reverse().join('/');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // erros assíncronos -> handler de erro
const ACTIVE = ['pendente', 'aprovado'];
const MAX_ACTIVE_PER_CLIENT = 5;

const isTaken = (date, time) => db.appointments.some((a) => a.date === date && a.time === time && ACTIVE.includes(a.status));
const isFuture = (date, time) => date > todayStr() || (date === todayStr() && toMin(time) > nowMin());

// Horários publicados pelo admin que ainda estão livres
function freeSlots(date) {
  if (!isDate(date)) return [];
  return db.slots.filter((x) => x.date === date && isFuture(x.date, x.time) && !isTaken(x.date, x.time)).map((x) => x.time).sort();
}

function waMessage(a, status, extra) {
  const nome = a.clienteNome.split(' ')[0];
  const quando = `${fmtDate(a.date)} às ${a.time}`;
  if (status === 'aprovado')
    return `Olá, ${nome}! ✅ Seu agendamento de *${a.servicoNome}* em *${quando}* foi *CONFIRMADO* no ${getStudio()}. Te esperamos! 💅${extra ? '\n' + extra : ''}`;
  if (status === 'recusado')
    return `Olá, ${nome}! Infelizmente não conseguimos atender seu pedido de *${a.servicoNome}* em *${quando}*. 😔${extra ? '\n' + extra : ''}\nPode escolher outro horário pelo nosso sistema?`;
  return `Olá, ${nome}! Sobre seu agendamento de ${a.servicoNome} em ${quando}.${extra ? '\n' + extra : ''}`;
}

async function sendWhatsApp(phone, text) {
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_ID: id } = env;
  if (!token || !id) return { enviado: false, motivo: 'API não configurada' };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(6000),
    });
    return r.ok ? { enviado: true } : { enviado: false, motivo: `API respondeu ${r.status}` };
  } catch (e) { return { enviado: false, motivo: e.message }; }
}

// --- App ---
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás do proxy da Vercel: IP real do cliente e cookies "Secure"
const sessions = createSessions({ secret: env.SESSION_SECRET || 'dev-secret-troque', secure: PROD });
const limiter = createLimiter();
const WINDOW = 15 * 60e3;

app.use((req, res, next) => { // cabeçalhos de segurança básicos
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.json({ limit: '3mb' })); // comporta o envio da logo (já reduzida pelo navegador); a Vercel limita em 4,5 MB
app.use(express.static(path.join(__dirname, 'public')));

app.get('/logo', wrap(async (req, res) => {
  await store.init();
  const l = await store.logo.get();
  if (!l) return res.status(404).end();
  res.set({ 'Content-Type': l.mime, 'Cache-Control': 'public, max-age=31536000, immutable' }).end(l.buffer);
}));

// Proteção CSRF: pedidos que alteram dados só valem se vierem do próprio site
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    const mine = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const extra = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (new URL(origin).host === mine || extra.includes(origin)) return next();
  } catch {}
  res.status(403).json({ erro: 'Origem não permitida.' });
});
// Configuração insegura/incompleta em produção: nada funciona, mas /api/health diz exatamente o que definir
app.use('/api', (req, res, next) => {
  if (!configErros.length) return next();
  if (req.path === '/health') return res.status(503).json({ ok: false, etapa: 'configuracao', variaveis: configErros, dica: 'Defina essas variáveis em Vercel → Settings → Environment Variables (valores fortes, diferentes dos exemplos) e faça Redeploy.' });
  res.status(503).json({ erro: 'Sistema em configuração. Tente novamente em instantes.' });
});

// Diagnóstico: testa a conexão com o banco e explica a causa provável (sem expor senha/host). Abra /api/health
const dicaBanco = (e) => {
  const m = String(e.message || ''), c = String(e.code || '');
  if (c === 'SEM_DATABASE_URL') return 'Defina SUPABASE_URL e SUPABASE_SECRET_KEY (ou DATABASE_URL) em Settings → Environment Variables da Vercel e faça Redeploy.';
  if (c === 'SCHEMA_AUSENTE' || c === 'PGRST202') return 'As funções do banco ainda não existem. No Supabase → SQL Editor, rode o conteúdo de supabase/schema.sql (uma vez) e recarregue.';
  if (c === 'PGRST301' || c === '401' || c === '403' || /invalid api key|jwt|apikey/i.test(m)) return 'Chave recusada pelo Supabase. Confira SUPABASE_SECRET_KEY (use a chave SECRETA, não a publishable) e se SUPABASE_URL é do mesmo projeto.';
  if (/tenant or user not found/i.test(m)) return 'Usuário/projeto do pooler incorreto. Copie de novo a string em Supabase → Connect → Transaction pooler (usuário no formato postgres.SEU_REF).';
  if (c === '28P01' || /password authentication failed/i.test(m)) return 'Senha do banco incorreta. Confira a senha (caracteres como @ # / ? precisam ser codificados na URL, ex.: @ vira %40).';
  if ((c === 'ENOTFOUND' || c === 'EAI_AGAIN') && env.SUPABASE_URL && !env.DATABASE_URL) return 'Não encontrou o servidor do Supabase. Confira SUPABASE_URL (ex.: https://SEU-REF.supabase.co).';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'Host do banco não encontrado. Use o host do Transaction pooler (aws-0-REGIAO.pooler.supabase.com), não o host direto db.REF.supabase.co.';
  if (c === 'ECONNREFUSED' || c === 'ETIMEDOUT' || /timeout/i.test(m)) return 'Não conseguiu conectar. Use a porta 6543 do Transaction pooler (a conexão direta 5432 é só IPv6 e falha na Vercel) e confira se o projeto Supabase não está pausado.';
  if (/self.signed|certificate/i.test(m)) return 'Problema de certificado SSL. Remova DATABASE_SSL_CA ou use o certificado correto do Supabase.';
  if (c === '42501' || /permission denied/i.test(m)) return 'O usuário do banco não tem permissão para criar o schema. Rode supabase/schema.sql no SQL Editor do Supabase.';
  if (c === 'EROFS' || c === 'EACCES') return 'Tentou gravar em disco (somente leitura na Vercel). Defina DATABASE_URL.';
  return 'Veja os logs da função em Vercel → Deployments → Functions/Logs para o detalhe.';
};
app.get('/api/health', wrap(async (req, res) => {
  const base = { hoje: todayStr(), tz: TZ_NAME, armazenamento: store.kind, vercel: !!env.VERCEL };
  try { await store.init(); res.json({ ok: true, ...base }); }
  catch (e) {
    console.error('Health: falha ao iniciar o banco:', e);
    res.status(503).json({ ok: false, ...base, etapa: 'banco', codigo: e.code || e.name || 'ERRO', dica: dicaBanco(e) });
  }
}));

app.use('/api', sessions.middleware, store.middleware);

const needClient = (req, res, next) => (req.session.userId && db.users.some((u) => u.id === req.session.userId) ? next() : res.status(401).json({ erro: 'Faça login.' }));
const needAdmin = (req, res, next) => (req.session.admin ? next() : res.status(401).json({ erro: 'Acesso restrito.' }));

app.get('/api/config', (req, res) => res.json({ studio: getStudio(), logo: logoUrl(), servicos: db.services.filter((s) => s.ativo) }));

// ----- Cliente -----
app.post('/api/register', wrap(async (req, res) => {
  const { name, phone, password } = req.body || {};
  const nome = String(name || '').trim().replace(/\s+/g, ' ');
  const tel = normPhone(phone);
  if (nome.length < 2 || nome.length > 80) return res.status(400).json({ erro: 'Informe seu nome (2 a 80 caracteres).' });
  if (!validPhone(tel)) return res.status(400).json({ erro: 'Informe um WhatsApp válido com DDD.' });
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) return res.status(400).json({ erro: 'A senha precisa ter de 6 a 72 caracteres.' });
  if (db.users.some((u) => u.phone === tel)) return res.status(409).json({ erro: 'Este WhatsApp já está cadastrado.' });
  const u = { id: nextId(), name: nome, phone: tel, hash: bcrypt.hashSync(password, 10) };
  db.users.push(u);
  await save();
  req.session.userId = u.id; res.saveSession();
  res.json({ id: u.id, name: u.name, phone: u.phone });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { phone, password } = req.body || {};
  const tel = normPhone(phone), key = `c:${req.ip}:${tel}`;
  if (limiter.blocked(key, 8)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  const u = db.users.find((x) => x.phone === tel);
  if (!u || typeof password !== 'string' || !bcrypt.compareSync(password, u.hash)) { limiter.fail(key, WINDOW); return res.status(401).json({ erro: 'WhatsApp ou senha incorretos.' }); }
  limiter.reset(key);
  req.session.userId = u.id; res.saveSession();
  res.json({ id: u.id, name: u.name, phone: u.phone });
}));

app.post('/api/logout', (req, res) => { req.session.userId = null; res.saveSession(); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const u = db.users.find((x) => x.id === req.session.userId);
  res.json({ user: u ? { id: u.id, name: u.name, phone: u.phone } : null, admin: !!req.session.admin });
});

app.get('/api/slots', (req, res) => res.json(freeSlots(req.query.date)));

// Dias que têm ao menos um horário livre -> { '2026-11-12': 5, ... }
app.get('/api/available-days', (req, res) => {
  const out = {};
  for (const x of db.slots) {
    if (!isFuture(x.date, x.time) || isTaken(x.date, x.time)) continue;
    out[x.date] = (out[x.date] || 0) + 1;
  }
  res.json(out);
});

// Sugestões rápidas: o primeiro horário livre e o primeiro de cada um dos próximos dias
app.get('/api/next-slots', (req, res) => {
  const limit = Math.min(6, Math.max(1, +req.query.limit || 3));
  const list = db.slots.filter((x) => isFuture(x.date, x.time) && !isTaken(x.date, x.time)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const seen = new Set(), out = [];
  for (const x of list) {
    if (seen.has(x.date)) continue;
    seen.add(x.date); out.push({ date: x.date, time: x.time });
    if (out.length >= limit) break;
  }
  res.json(out);
});

app.post('/api/appointments', needClient, wrap(async (req, res) => {
  const { service, date, time, notes } = req.body || {};
  const s = db.services.find((x) => x.id === service && x.ativo);
  if (!s) return res.status(400).json({ erro: 'Serviço inválido.' });
  const u = db.users.find((x) => x.id === req.session.userId);
  const ativos = db.appointments.filter((a) => a.userId === u.id && ACTIVE.includes(a.status) && isFuture(a.date, a.time)).length;
  if (ativos >= MAX_ACTIVE_PER_CLIENT) return res.status(429).json({ erro: `Você já tem ${MAX_ACTIVE_PER_CLIENT} pedidos ativos. Aguarde a aprovação ou cancele algum.` });
  if (!freeSlots(date).includes(time)) return res.status(409).json({ erro: 'Horário indisponível. Escolha outro.' });
  const a = {
    id: nextId(), userId: u.id, clienteNome: u.name, clienteTel: u.phone,
    servicoId: s.id, servicoNome: s.nome, minutos: s.minutos, preco: s.preco,
    date, time, notes: String(notes || '').slice(0, 300),
    status: 'pendente', criadoEm: new Date().toISOString(),
  };
  db.appointments.push(a);
  await save();
  res.status(201).json(a);
}));

app.get('/api/appointments', needClient, (req, res) => {
  res.json(db.appointments.filter((a) => a.userId === req.session.userId).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)));
});

app.post('/api/appointments/:id/cancel', needClient, wrap(async (req, res) => {
  const a = db.appointments.find((x) => x.id === +req.params.id && x.userId === req.session.userId);
  if (!a) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (!ACTIVE.includes(a.status)) return res.status(400).json({ erro: 'Este agendamento não pode ser cancelado.' });
  a.status = 'cancelado'; a.atualizadoEm = new Date().toISOString();
  await save();
  res.json(a);
}));

// ----- Administrador -----
app.post('/api/admin/login', wrap(async (req, res) => {
  const { user, password } = req.body || {};
  const key = `a:${req.ip}`;
  if (limiter.blocked(key, 8)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (user !== ADMIN_USER || typeof password !== 'string' || !bcrypt.compareSync(password, ADMIN_HASH)) {
    limiter.fail(key, WINDOW);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  limiter.reset(key);
  req.session.admin = true; res.saveSession();
  res.json({ ok: true });
}));

app.post('/api/admin/logout', (req, res) => { req.session.admin = false; res.saveSession(); res.json({ ok: true }); });

app.get('/api/admin/appointments', needAdmin, (req, res) => {
  let list = db.appointments;
  if (req.query.status) list = list.filter((a) => a.status === req.query.status);
  if (req.query.date) list = list.filter((a) => a.date === req.query.date);
  list = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(list.map((a) => ({ ...a, waLink: `https://wa.me/${a.clienteTel}?text=${encodeURIComponent(waMessage(a, a.status))}` })));
});

app.post('/api/admin/appointments/:id/status', needAdmin, wrap(async (req, res) => {
  const { status, message } = req.body || {};
  const a = db.appointments.find((x) => x.id === +req.params.id);
  if (!a) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  if (!['aprovado', 'recusado'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (a.status !== 'pendente') return res.status(409).json({ erro: `Este pedido já está "${a.status}" e não pode mais ser alterado.` });
  if (status === 'aprovado' && db.appointments.some((o) => o.id !== a.id && o.status === 'aprovado' && o.date === a.date && o.time === a.time))
    return res.status(409).json({ erro: 'Já existe outro agendamento aprovado neste horário.' });
  a.status = status; a.atualizadoEm = new Date().toISOString();
  await save(); // grava primeiro: o envio do WhatsApp (rede) não deve segurar a trava do banco
  const text = waMessage(a, status, String(message || '').slice(0, 300));
  const envio = await sendWhatsApp(a.clienteTel, text);
  res.json({ agendamento: a, whatsapp: { ...envio, link: `https://wa.me/${a.clienteTel}?text=${encodeURIComponent(text)}` } });
}));

app.delete('/api/admin/appointments/:id', needAdmin, wrap(async (req, res) => {
  const i = db.appointments.findIndex((x) => x.id === +req.params.id);
  if (i < 0) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
  db.appointments.splice(i, 1); // se estava ativo, o horário volta a ficar livre
  await save();
  res.json({ ok: true });
}));

// ----- Agenda (horários) definida pelo admin -----
app.get('/api/admin/slots', needAdmin, (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : todayStr();
  const list = db.slots.filter((x) => x.date >= from).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((x) => {
    const ap = db.appointments.find((a) => a.date === x.date && a.time === x.time && ACTIVE.includes(a.status));
    return { ...x, ocupado: !!ap, cliente: ap ? ap.clienteNome : null, status: ap ? ap.status : null };
  });
  res.json(list);
});

// schedule: { "1": [{start:"09:00", end:"12:00"}, ...], ... } (chave = dia da semana, 0 = domingo)
app.post('/api/admin/slots/bulk', needAdmin, wrap(async (req, res) => {
  const { from, to, interval, schedule, replace } = req.body || {};
  if (!isDate(from) || !isDate(to) || to < from) return res.status(400).json({ erro: 'Informe um período de datas válido.' });
  if ((new Date(to) - new Date(from)) / 864e5 > 400) return res.status(400).json({ erro: 'O período máximo é de 400 dias.' });
  if (!schedule || typeof schedule !== 'object') return res.status(400).json({ erro: 'Defina os horários de atendimento.' });
  for (const ranges of Object.values(schedule)) {
    if (!Array.isArray(ranges)) return res.status(400).json({ erro: 'Horários inválidos.' });
    for (const r of ranges) if (!r || !isTime(r.start) || !isTime(r.end) || toMin(r.end) < toMin(r.start)) return res.status(400).json({ erro: 'Há uma faixa de horário inválida (o fim deve ser depois do início).' });
  }
  const step = Math.max(15, Math.min(480, +interval || 60));
  const out = [];
  for (let d = new Date(from + 'T12:00:00Z'), last = new Date(to + 'T12:00:00Z'); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    for (const r of schedule[d.getUTCDay()] || []) for (let t = toMin(r.start); t <= toMin(r.end); t += step) out.push({ date, time: toHHMM(t) });
  }
  if (out.length > 800) return res.status(400).json({ erro: 'Muitos horários de uma vez (máx. 800). Reduza o período.' });
  let removed = 0;
  if (replace) { // apaga só os horários livres do período; os reservados são preservados
    const before = db.slots.length;
    db.slots = db.slots.filter((x) => x.date < from || x.date > to || isTaken(x.date, x.time));
    removed = before - db.slots.length;
  }
  const have = new Set(db.slots.map((s) => s.date + ' ' + s.time));
  let added = 0;
  for (const x of out) {
    if (have.has(x.date + ' ' + x.time)) continue;
    have.add(x.date + ' ' + x.time); db.slots.push({ id: nextId(), ...x }); added++;
  }
  await save();
  res.json({ adicionados: added, ignorados: out.length - added, removidos: removed });
}));

app.post('/api/admin/slots/single', needAdmin, wrap(async (req, res) => {
  const { date, time } = req.body || {};
  if (!isDate(date) || !isTime(time)) return res.status(400).json({ erro: 'Data ou horário inválido.' });
  if (db.slots.some((s) => s.date === date && s.time === time)) return res.status(409).json({ erro: 'Esse horário já existe.' });
  db.slots.push({ id: nextId(), date, time });
  await save();
  res.status(201).json({ ok: true });
}));

app.delete('/api/admin/slots/:id', needAdmin, wrap(async (req, res) => {
  const i = db.slots.findIndex((x) => x.id === +req.params.id);
  if (i < 0) return res.status(404).json({ erro: 'Horário não encontrado.' });
  if (isTaken(db.slots[i].date, db.slots[i].time)) return res.status(409).json({ erro: 'Horário já reservado. Recuse ou cancele o agendamento primeiro.' });
  db.slots.splice(i, 1);
  await save();
  res.json({ ok: true });
}));

// Exclusão em massa: remove os horários escolhidos que estiverem livres (os reservados são preservados)
app.post('/api/admin/slots/delete-many', needAdmin, wrap(async (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 3000 || !ids.every(Number.isInteger)) return res.status(400).json({ erro: 'Selecione os horários a excluir.' });
  const alvo = new Set(ids);
  let removidos = 0, reservados = 0;
  db.slots = db.slots.filter((x) => {
    if (!alvo.has(x.id)) return true;
    if (isTaken(x.date, x.time)) { reservados++; return true; }
    removidos++; return false;
  });
  if (removidos) await save();
  res.json({ removidos, reservados });
}));

// Remove todos os horários LIVRES de uma data
app.post('/api/admin/slots/clear-day', needAdmin, wrap(async (req, res) => {
  const { date } = req.body || {};
  if (!isDate(date)) return res.status(400).json({ erro: 'Data inválida.' });
  const before = db.slots.length;
  db.slots = db.slots.filter((x) => x.date !== date || isTaken(x.date, x.time));
  await save();
  res.json({ removidos: before - db.slots.length });
}));

// ----- CRUD: Serviços -----
function readService(b) {
  const nome = String(b.nome || '').trim(), minutos = Math.round(+b.minutos), preco = +b.preco;
  if (nome.length < 2 || nome.length > 60) return { erro: 'Informe o nome do serviço (2 a 60 caracteres).' };
  if (!(minutos >= 15 && minutos <= 480)) return { erro: 'A duração deve ficar entre 15 e 480 minutos.' };
  if (!(preco >= 0 && preco <= 100000)) return { erro: 'Informe um preço válido.' };
  return { v: { nome, minutos, preco: Math.round(preco * 100) / 100, icone: String(b.icone || '💅').trim().slice(0, 8) || '💅', ativo: b.ativo !== false } };
}
app.get('/api/admin/services', needAdmin, (req, res) => res.json(db.services));
app.post('/api/admin/services', needAdmin, wrap(async (req, res) => {
  const r = readService(req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const s = { id: 's' + nextId(), ...r.v };
  db.services.push(s);
  await save();
  res.status(201).json(s);
}));
app.put('/api/admin/services/:id', needAdmin, wrap(async (req, res) => {
  const s = db.services.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  const r = readService(req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  if (!r.v.ativo && s.ativo && db.services.filter((x) => x.ativo).length === 1) return res.status(409).json({ erro: 'Mantenha ao menos um serviço ativo.' });
  Object.assign(s, r.v);
  await save();
  res.json(s);
}));
app.delete('/api/admin/services/:id', needAdmin, wrap(async (req, res) => {
  const i = db.services.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ erro: 'Serviço não encontrado.' });
  if (db.services[i].ativo && db.services.filter((x) => x.ativo).length === 1) return res.status(409).json({ erro: 'Mantenha ao menos um serviço ativo.' });
  db.services.splice(i, 1); // agendamentos antigos guardam uma cópia do nome e do preço
  await save();
  res.json({ ok: true });
}));

// ----- CRUD: Clientes -----
app.get('/api/admin/clients', needAdmin, (req, res) => {
  res.json(db.users.map((u) => {
    const aps = db.appointments.filter((a) => a.userId === u.id);
    return { id: u.id, name: u.name, phone: u.phone, agendamentos: aps.length, ativos: aps.filter((a) => ACTIVE.includes(a.status)).length };
  }).sort((a, b) => a.name.localeCompare(b.name)));
});
app.put('/api/admin/clients/:id', needAdmin, wrap(async (req, res) => {
  const u = db.users.find((x) => x.id === +req.params.id);
  if (!u) return res.status(404).json({ erro: 'Cliente não encontrada.' });
  const name = String((req.body || {}).name || '').trim().replace(/\s+/g, ' '), phone = normPhone((req.body || {}).phone);
  if (name.length < 2 || name.length > 80) return res.status(400).json({ erro: 'Informe o nome (2 a 80 caracteres).' });
  if (!validPhone(phone)) return res.status(400).json({ erro: 'Informe um WhatsApp válido com DDD.' });
  if (db.users.some((x) => x.id !== u.id && x.phone === phone)) return res.status(409).json({ erro: 'Este WhatsApp já pertence a outra cliente.' });
  u.name = name; u.phone = phone;
  db.appointments.filter((a) => a.userId === u.id).forEach((a) => { a.clienteNome = name; a.clienteTel = phone; });
  await save();
  res.json({ id: u.id, name, phone });
}));
app.delete('/api/admin/clients/:id', needAdmin, wrap(async (req, res) => {
  const i = db.users.findIndex((x) => x.id === +req.params.id);
  if (i < 0) return res.status(404).json({ erro: 'Cliente não encontrada.' });
  const id = db.users[i].id;
  db.users.splice(i, 1);
  db.appointments = db.appointments.filter((a) => a.userId !== id); // remove também o histórico dela
  await save();
  res.json({ ok: true });
}));

// ----- Configurações: nome e logo -----
app.get('/api/admin/settings', needAdmin, (req, res) => res.json({ studio: getStudio(), studioCustom: db.settings.studio || '', logo: logoUrl() }));
app.put('/api/admin/settings', needAdmin, wrap(async (req, res) => {
  const nome = String((req.body || {}).studio || '').trim();
  if (nome && (nome.length < 2 || nome.length > 60)) return res.status(400).json({ erro: 'O nome deve ter de 2 a 60 caracteres.' });
  db.settings.studio = nome || null; // vazio = volta ao nome padrão
  await save();
  res.json({ studio: getStudio(), logo: logoUrl() });
}));
app.post('/api/admin/settings/logo', needAdmin, wrap(async (req, res) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).dataUrl || ''));
  if (!m) return res.status(400).json({ erro: 'Envie uma imagem PNG, JPG ou WEBP.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5 * 1024 * 1024) return res.status(413).json({ erro: 'Imagem muito grande (máx. 1,5 MB).' });
  const ext = sniffImage(buf);
  if (!ext) return res.status(400).json({ erro: 'O arquivo não é uma imagem válida.' });
  await store.logo.put(buf, ext);
  db.settings.logo = ext; db.settings.logoV = Date.now();
  await save();
  res.json({ studio: getStudio(), logo: logoUrl() });
}));
app.delete('/api/admin/settings/logo', needAdmin, wrap(async (req, res) => {
  await store.logo.del(); db.settings.logo = null;
  await save();
  res.json({ studio: getStudio(), logo: null });
}));

// ----- Backup manual (download do banco completo) -----
app.get('/api/admin/backup', needAdmin, (req, res) => {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  res.setHeader('Content-Disposition', `attachment; filename="agenda-backup-${stamp}.json"`);
  res.type('application/json').send(JSON.stringify(store.current(), null, 2));
});

// ----- Erros: sempre em JSON, sem vazar detalhes internos -----
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo muito grande.' });
  if (err.code === 'LOCK_TIMEOUT') return res.status(503).json({ erro: 'Muitos pedidos ao mesmo tempo. Tente de novo em instantes.' });
  if (/lock_lost/.test(String(err.message))) return res.status(503).json({ erro: 'A operação demorou demais e foi cancelada. Tente de novo.' });
  if (err.code === '23505') return res.status(409).json({ erro: 'Conflito: este horário ou cadastro acabou de ser ocupado. Atualize e tente de novo.' }); // violação de unicidade no banco
  console.error('Erro:', err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente em instantes.' });
});

module.exports = app;
module.exports.store = store;

if (require.main === module) {
  // Sobe o servidor mesmo que o banco esteja inacessível: /api/health mostra o diagnóstico e as próximas requisições tentam reconectar
  store.init().catch((e) => console.error('✖ Banco indisponível na inicialização:', e.code || e.message));
  app.listen(PORT, () => console.log(`Agenda rodando em http://localhost:${PORT}  (admin: /admin.html) · armazenamento: ${store.kind}`));
}
