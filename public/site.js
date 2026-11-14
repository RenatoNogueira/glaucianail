const ICONS = { manicure: '💅', pedicure: '🦶', combo: '🌸', esmaltacao: '✨' };
const DIAS_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
let mode = 'login', cfg, me = null, view = 'book', step = 1;
let sel = { service: null, date: null, time: null, notes: '' };
let avail = {}, nextSlots = [];
let T = {}; // textos da página inicial (editáveis no painel)

// Aplica os textos da página inicial. Tudo entra como texto puro (nunca HTML); *palavra* vira destaque.
function applyTexts(t) {
  T = t || {};
  document.querySelectorAll('[data-t]').forEach((el) => {
    const v = T[el.dataset.t]; if (typeof v !== 'string') return;
    if (el.hasAttribute('data-rich')) {
      el.textContent = '';
      v.split(/(\*[^*]+\*)/).filter(Boolean).forEach((p) => {
        if (/^\*[^*]+\*$/.test(p)) { const em = document.createElement('em'); em.textContent = p.slice(1, -1); el.append(em); } else el.append(document.createTextNode(p));
      });
    } else el.textContent = v;
  });
}

const svc = () => cfg.servicos.find((x) => x.id === sel.service);
const rel = (iso) => {
  const t = ISO(new Date()), tm = ISO(new Date(Date.now() + 864e5));
  const d = new Date(iso + 'T12:00:00');
  return iso === t ? 'Hoje' : iso === tm ? 'Amanhã' : `${DIAS[d.getDay()]}, ${iso.slice(8)}/${iso.slice(5, 7)}`;
};
const longDate = (iso) => { const d = new Date(iso + 'T12:00:00'); return `${DIAS_FULL[d.getDay()]}, ${d.getDate()} de ${MESES_FULL[d.getMonth()]}`; };
const phoneFmt = (p) => { const d = String(p || '').replace(/^55/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p; };

// ---------- Auth ----------
function setMode(m) {
  mode = m;
  $('nameBox').classList.toggle('hidden', m === 'login');
  $('authBtn').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
  $('tLogin').classList.toggle('on', m === 'login');
  $('tReg').classList.toggle('on', m === 'reg');
  $('pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('authTitle').textContent = (m === 'login' ? T.authLoginTitulo : T.authCadastroTitulo) || (m === 'login' ? 'Bem-vinda de volta' : 'Crie sua conta');
  $('authMsg').innerHTML = '';
}
// Atalhos da página inicial: levam ao formulário já no modo certo
function focusAuth(m) {
  setMode(m);
  $('authCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $(m === 'reg' ? 'name' : 'phone').focus({ preventScroll: true }), 350);
}
$('ctaStart').onclick = () => focusAuth('reg');
$('ctaLogin').onclick = () => focusAuth('login');

async function loadLanding() {
  $('lpServices').innerHTML = cfg.servicos.map((s) => `
    <div class="lp-svc"><span class="lp-ic">${esc(s.icone || ICONS[s.id] || '💅')}</span>
      <strong>${esc(s.nome)}</strong><span class="small">${s.minutos} min</span><span class="price">R$ ${Number(s.preco).toFixed(2).replace('.', ',')}</span></div>`).join('');
  $('lpFoot').textContent = (T.rodape || '© {ano} {nome} · Agendamento online').split('{ano}').join(new Date().getFullYear()).split('{nome}').join(cfg.studio);
  try {
    const n = await api('/api/next-slots?limit=4');
    $('lpNextSec').hidden = !n.length;
    $('lpNext').innerHTML = n.map((x) => `<button type="button" class="qs" data-d="${x.date}"><small>${rel(x.date)}</small><strong>${x.time}</strong></button>`).join('');
    $('lpNext').querySelectorAll('.qs').forEach((b) => (b.onclick = () => focusAuth('reg')));
  } catch { $('lpNextSec').hidden = true; }
}
$('tLogin').onclick = () => setMode('login');
$('tReg').onclick = () => setMode('reg');
$('eye').onclick = () => {
  const show = $('pass').type === 'password';
  $('pass').type = show ? 'text' : 'password'; $('eye').textContent = show ? 'Ocultar' : 'Mostrar';
};
$('phone').oninput = (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 11);
  e.target.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length > 10 ? 7 : 6)}-${d.slice(d.length > 10 ? 7 : 6)}`
    : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
};
$('fAuth').onsubmit = async (e) => {
  e.preventDefault();
  $('authBtn').disabled = true;
  try {
    await api(mode === 'login' ? '/api/login' : '/api/register', 'POST', { phone: $('phone').value, password: $('pass').value, name: $('name').value });
    $('pass').value = ''; init();
  } catch (err) { $('authMsg').innerHTML = `<div class="msg" role="alert">${esc(err.message)}</div>`; }
  $('authBtn').disabled = false;
};
$('logout').onclick = async () => { await api('/api/logout', 'POST'); resetBooking(); init(); };

// ---------- Navegação ----------
function show(v) {
  view = v;
  $('vBook').classList.toggle('hidden', v !== 'book');
  $('vOk').classList.toggle('hidden', v !== 'ok');
  $('vList').classList.toggle('hidden', v !== 'list');
  $('nBook').classList.toggle('on', v === 'book');
  $('nList').classList.toggle('on', v === 'list' || v === 'ok');
  if (v === 'book') render(); else $('sumbar').classList.add('hidden');
  if (v === 'list') loadList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('nBook').onclick = () => show('book');
$('nList').onclick = () => show('list');

function resetBooking() { sel = { service: null, date: null, time: null, notes: '' }; step = 1; }

// ---------- Assistente de agendamento ----------
function go(n) { step = n; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function render() {
  const NAMES = ['Serviço', 'Data e hora', 'Confirmar'];
  $('wizSteps').innerHTML = NAMES.map((n, i) => `<button type="button" class="ws ${step === i + 1 ? 'cur' : ''} ${step > i + 1 ? 'done' : ''}" data-s="${i + 1}" ${step > i + 1 ? '' : 'disabled'}>
    <b>${step > i + 1 ? '✓' : i + 1}</b><span>${n}</span></button>`).join('<i class="wl"></i>');
  $('wizSteps').querySelectorAll('.done').forEach((b) => (b.onclick = () => go(+b.dataset.s)));
  $('wizBody').className = 'wiz anim';
  void $('wizBody').offsetWidth; // reinicia a animação
  ({ 1: renderService, 2: renderWhen, 3: renderConfirm })[step]();
  renderBar();
}

function renderBar() {
  const s = sel.service && svc();
  $('sumbar').classList.toggle('hidden', view !== 'book');
  if (step === 1) {
    $('sumTxt').innerHTML = s ? `<strong>${esc(s.nome)}</strong>${s.minutos} min · R$ ${s.preco}` : '<span class="small">Escolha um serviço</span>';
    $('bookBtn').textContent = 'Continuar →'; $('bookBtn').disabled = !s;
  } else if (step === 2) {
    $('sumTxt').innerHTML = sel.time ? `<strong>${rel(sel.date)} · ${sel.time}</strong>${esc(s.nome)}` : '<span class="small">Escolha um dia e um horário</span>';
    $('bookBtn').textContent = 'Continuar →'; $('bookBtn').disabled = !sel.time;
  } else if (step === 3) {
    $('sumTxt').innerHTML = `<strong>${esc(s.nome)} · R$ ${s.preco}</strong>${rel(sel.date)} às ${sel.time}`;
    $('bookBtn').textContent = 'Solicitar agendamento'; $('bookBtn').disabled = false;
  }
}

// Passo 1 — serviço (avança sozinho ao tocar)
function renderService() {
  $('wizBody').innerHTML = `<h2 class="wh">O que vamos fazer hoje?</h2><p class="small wsub">Escolha um serviço e toque em Continuar.</p>
    <div class="services">${cfg.servicos.map((s) => `
      <button type="button" class="svc ${sel.service === s.id ? 'on' : ''}" data-id="${s.id}">
        <span class="ic">${s.icone || ICONS[s.id] || '💅'}</span><strong>${esc(s.nome)}</strong><span>${s.minutos} min</span><span class="price">R$ ${s.preco}</span></button>`).join('')}</div>`;
  $('wizBody').querySelectorAll('.svc').forEach((b) => (b.onclick = () => {
    sel.service = b.dataset.id; // só marca a escolha; o avanço é pelo botão "Continuar"
    $('wizBody').querySelectorAll('.svc').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    renderBar();
  }));
}

// Passo 2 — data e hora, sem calendário gigante
async function renderWhen() {
  $('wizBody').innerHTML = `<button class="link back" id="back">← Voltar</button>
    <h2 class="wh">Quando fica melhor?</h2>
    <div id="quick">${skeleton(1)}</div>
    <div class="or"><span>ou escolha outro dia</span></div>
    <div class="strip-row"><div class="strip" id="strip" role="listbox" aria-label="Dias disponíveis"></div>
      <button type="button" class="btn sec sm" id="more">📅 Mais datas</button></div>
    <div id="times"></div>`;
  $('back').onclick = () => go(1);
  try { [avail, nextSlots] = await Promise.all([api('/api/available-days'), api('/api/next-slots?limit=3')]); } catch { avail = {}; nextSlots = []; }
  if (step !== 2) return;
  const dates = Object.keys(avail).sort();
  if (sel.date && !avail[sel.date]) { sel.date = null; sel.time = null; }
  if (!dates.length) {
    $('wizBody').innerHTML = `<button class="link back" id="back">← Voltar</button><div class="empty"><span class="big">🗓️</span>Nenhum horário disponível no momento.<br>Volte em breve para conferir novas datas.</div>`;
    $('back').onclick = () => go(1); renderBar(); return;
  }
  $('quick').innerHTML = `<div class="qlabel">⚡ Próximos horários livres</div><div class="qs-grid">${nextSlots.map((x) => `
    <button type="button" class="qs ${sel.date === x.date && sel.time === x.time ? 'on' : ''}" data-d="${x.date}" data-t="${x.time}"><small>${rel(x.date)}</small><strong>${x.time}</strong></button>`).join('')}</div>`;
  // Só marca o horário (e sincroniza o dia/horário abaixo); o avanço é pelo botão "Continuar"
  $('quick').querySelectorAll('.qs').forEach((b) => (b.onclick = () => pickDate(b.dataset.d, b.dataset.t)));
  renderStrip();
  $('more').hidden = dates.length < 6;
  $('more').onclick = openMoreDates;
  if (sel.date) { loadTimes(); scrollStrip(); }
  renderBar();
}

function renderStrip() {
  $('strip').innerHTML = Object.keys(avail).sort().map((iso) => {
    const d = new Date(iso + 'T12:00:00');
    return `<button type="button" role="option" class="dp ${sel.date === iso ? 'on' : ''}" data-d="${iso}" aria-selected="${sel.date === iso}" aria-label="${longDate(iso)}, ${avail[iso]} horários">
      <small>${DIAS[d.getDay()]}</small><strong>${d.getDate()}</strong><em>${MESES[d.getMonth()]}</em></button>`;
  }).join('');
  $('strip').onclick = (e) => { const b = e.target.closest('.dp'); if (b) pickDate(b.dataset.d); };
}
const scrollStrip = () => $('strip').querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

function markQuick() {
  document.querySelectorAll('#quick .qs').forEach((q) => q.classList.toggle('on', q.dataset.d === sel.date && q.dataset.t === sel.time));
}
function pickDate(iso, time = null) {
  sel.date = iso; sel.time = time;
  $('strip').querySelectorAll('.dp').forEach((b) => { const on = b.dataset.d === iso; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  markQuick(); scrollStrip(); loadTimes(); renderBar();
}

function openMoreDates() {
  const close = modal({ title: 'Escolha uma data', html: '<div id="mcal"></div><p class="small legend"><span class="dot"></span> dias com horários livres</p>', actions: [{ label: 'Fechar', cls: 'sec' }] });
  const c = Calendar($('mcal'), { enabled: (iso) => !!avail[iso], marks: (iso) => avail[iso] || 0, onChange: (iso) => { close(); pickDate(iso); } });
  if (sel.date) { c.setValue(sel.date); c.goTo(sel.date); } else c.goTo(Object.keys(avail).sort()[0]);
}

async function loadTimes() {
  const box = $('times');
  if (!sel.date) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="tlabel">${longDate(sel.date)}</div>${skeleton(1)}`;
  try {
    const s = await api(`/api/slots?date=${sel.date}`);
    if (step !== 2) return;
    if (!s.length) { box.innerHTML = '<div class="empty"><span class="big">🗓️</span>Todos os horários deste dia foram reservados.<br>Escolha outro dia.</div>'; return; }
    const grp = [['☀️ Manhã', (t) => t < '12:00'], ['🌤️ Tarde', (t) => t >= '12:00' && t < '18:00'], ['🌙 Noite', (t) => t >= '18:00']];
    box.innerHTML = `<div class="tlabel">${longDate(sel.date)}</div>` + grp.map(([n, f]) => {
      const l = s.filter(f); return l.length ? `<div class="period">${n}</div><div class="chips">${l.map((t) => `<button type="button" class="chip ${sel.time === t ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>` : '';
    }).join('');
    box.querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
      sel.time = b.dataset.t;
      box.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); markQuick(); renderBar();
    }));
  } catch (err) { box.innerHTML = `<div class="msg">${esc(err.message)}</div>`; }
}

// Passo 3 — confirmação
function renderConfirm() {
  const s = svc();
  $('wizBody').innerHTML = `<button class="link back" id="back">← Voltar</button>
    <h2 class="wh">Confirme seu pedido</h2>
    <div class="ticket">
      <div class="tk-row"><span class="tk-ic">${s.icone || ICONS[s.id] || '💅'}</span><div class="tk-main"><strong>${esc(s.nome)}</strong><span class="small">${s.minutos} min</span></div><b class="tk-price">R$ ${s.preco}</b></div>
      <div class="tk-sep"></div>
      <div class="tk-row"><span class="tk-ic">📅</span><div class="tk-main"><strong class="cap">${longDate(sel.date)}</strong><span class="small">às ${sel.time}</span></div><button class="link" id="chg">Alterar</button></div>
    </div>
    <label for="notes">Observações (opcional)</label>
    <textarea id="notes" rows="2" maxlength="300" placeholder="Ex.: prefiro esmalte nude">${esc(sel.notes)}</textarea>
    <div class="notice">📲 O retorno da aprovação chegará no seu WhatsApp <strong>${esc(phoneFmt(me.phone))}</strong>.</div>
    <div id="bookMsg"></div>`;
  $('back').onclick = () => go(2);
  $('chg').onclick = () => go(2);
  $('notes').oninput = (e) => (sel.notes = e.target.value);
}

$('bookBtn').onclick = async () => {
  if (step === 1) return sel.service ? go(2) : undefined;
  if (step === 2) return go(3);
  $('bookBtn').disabled = true;
  try {
    const a = await api('/api/appointments', 'POST', { service: sel.service, date: sel.date, time: sel.time, notes: sel.notes });
    $('vOk').innerHTML = `<div class="check">✓</div><h2>Pedido enviado!</h2>
      <p class="small">Assim que for aprovado, você receberá a confirmação no seu WhatsApp.</p>
      <div class="recap"><strong>${esc(a.servicoNome)}</strong><br>${fmt(a.date)} às ${a.time} · R$ ${a.preco}<br>${chipSt(a.status)}</div><br>
      <button class="btn" id="goList">Ver meus agendamentos</button> <button class="btn sec" id="again">Novo agendamento</button>`;
    resetBooking(); show('ok'); refreshBadge();
    $('goList').onclick = () => show('list'); $('again').onclick = () => show('book');
  } catch (err) {
    toast(err.message, 'err'); sel.time = null; go(2); // horário pode ter sido reservado por outra pessoa
  }
};

// ---------- Meus agendamentos ----------
async function loadList() {
  $('vList').innerHTML = `<h2 style="margin-bottom:8px">Meus agendamentos</h2>${skeleton()}`;
  const l = await api('/api/appointments');
  const today = ISO(new Date());
  const up = l.filter((a) => a.date >= today && ['pendente', 'aprovado'].includes(a.status)).reverse();
  const old = l.filter((a) => !up.includes(a));
  const row = (a, past) => `<div class="ap ${past ? 'past' : ''}">${dateBlock(a.date)}
    <div class="info"><strong>${esc(a.servicoNome)}</strong><span class="small">${a.time} · ${a.minutos} min · R$ ${a.preco}</span></div>
    <div class="act">${chipSt(a.status)}${!past && ['pendente', 'aprovado'].includes(a.status) ? `<button class="link" data-c="${a.id}">Cancelar</button>` : ''}</div></div>`;
  $('vList').innerHTML = `<h2>Meus agendamentos</h2>` + (l.length
    ? (up.length ? `<div class="sec-title">Próximos</div>${up.map((a) => row(a)).join('')}` : '') + (old.length ? `<div class="sec-title">Histórico</div>${old.map((a) => row(a, true)).join('')}` : '')
    : '<div class="empty"><span class="big">💅</span>Você ainda não tem agendamentos.<br><br><button class="btn" id="startBook">Agendar agora</button></div>');
  if ($('startBook')) $('startBook').onclick = () => show('book');
  $('vList').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => modal({
    title: 'Cancelar agendamento?', html: '<p class="small">Essa ação libera o horário para outras clientes.</p>',
    actions: [{ label: 'Manter', cls: 'sec' }, { label: 'Sim, cancelar', cls: 'bad', onClick: async (close) => {
      try { await api(`/api/appointments/${b.dataset.c}/cancel`, 'POST'); toast('Agendamento cancelado', 'ok'); close(); loadList(); refreshBadge(); }
      catch (err) { toast(err.message, 'err'); close(); }
    } }],
  })));
}

async function refreshBadge() {
  const l = await api('/api/appointments').catch(() => []);
  const n = l.filter((a) => a.status === 'pendente').length;
  $('badge').textContent = n; $('badge').classList.toggle('hidden', !n);
}

async function init() {
  cfg = cfg || (await api('/api/config'));
  applyBrand(cfg);
  applyTexts(cfg.textos); setMode(mode);
  document.title = cfg.studio + ' – Agendamento';
  const r = await api('/api/me');
  me = r.user;
  $('auth').classList.toggle('hidden', !!me);
  $('app').classList.toggle('hidden', !me);
  $('logout').hidden = !me;
  $('sumbar').classList.add('hidden');
  $('who').textContent = me ? 'Olá, ' + me.name.split(' ')[0] : '';
  if (me) { show('book'); refreshBadge(); } else loadLanding();
}
// Se o servidor/banco estiver indisponível, mostra uma mensagem amigável em vez de uma página em branco
function initOuErro() {
  init().catch(() => {
    document.querySelector('main').innerHTML = '<div class="card empty" style="margin-top:40px"><span class="big">🛠️</span><strong>Sistema temporariamente indisponível</strong><br>Não foi possível carregar os dados agora. Tente novamente em instantes.<br><br><button class="btn" id="retry">Tentar novamente</button></div>';
    document.getElementById('retry').onclick = () => location.reload();
  });
}
initOuErro();
