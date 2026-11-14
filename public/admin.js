let status = 'pendente', filterDate = '', apptDays = {}, pubDays = {}, pending = 0, cur = 'home';
const TABS = [['pendente', 'Pendentes'], ['aprovado', 'Aprovados'], ['recusado', 'Recusados'], ['cancelado', 'Cancelados'], ['', 'Todos']];

// ---------- Login ----------
$('eye').onclick = () => {
  const show = $('pass').type === 'password';
  $('pass').type = show ? 'text' : 'password'; $('eye').textContent = show ? 'Ocultar' : 'Mostrar';
};
$('fLogin').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Entrando…'; $('loginMsg').innerHTML = '';
  try { await api('/api/admin/login', 'POST', { user: $('user').value.trim(), password: $('pass').value }); $('pass').value = ''; await init(); }
  catch (err) {
    $('loginMsg').innerHTML = `<div class="msg" role="alert">${esc(err.message)}</div>`;
    const c = document.querySelector('.al-form'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    $('pass').select();
  }
  btn.disabled = false; btn.textContent = 'Entrar no painel';
};
const doLogout = async () => { await api('/api/admin/logout', 'POST'); init(); };
$('logout').onclick = $('logoutM').onclick = doLogout;

// ---------- Navegação (menu lateral no computador, barra inferior no celular) ----------
const NAV = [
  ['home', '🏠', 'Visão geral', 'Resumo do seu dia', 'Início'],
  ['req', '📋', 'Agendamentos', 'Aprove, recuse e acompanhe os pedidos', 'Pedidos'],
  ['agenda', '🗓️', 'Agenda', 'Defina os dias e horários de atendimento', 'Agenda'],
  ['serv', '💅', 'Serviços', 'Cadastre serviços, preços e duração', 'Serviços'],
  ['cli', '👥', 'Clientes', 'Gerencie suas clientes', 'Clientes'],
  ['cfg', '⚙️', 'Configurações', 'Nome, logo e cópia de segurança', 'Ajustes'],
];
function renderNav() {
  const badge = (k) => (k === 'req' && pending ? `<span class="badge">${pending}</span>` : '');
  $('snav').innerHTML = NAV.map(([k, ic, l]) => `<button type="button" class="sn-item ${k === cur ? 'on' : ''}" data-v="${k}" ${k === cur ? 'aria-current="page"' : ''}><span class="ni">${ic}</span><span class="tl">${l}</span>${badge(k)}</button>`).join('');
  $('tabbar').innerHTML = NAV.map(([k, ic, , , s]) => `<button type="button" class="tb-item ${k === cur ? 'on' : ''}" data-v="${k}"><span class="ni">${ic}${badge(k)}</span><span class="tl">${s}</span></button>`).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-v],[data-go]');
  if (b) view(b.dataset.v || b.dataset.go);
});
const loaders = { home: () => loadHome(), req: () => load(), agenda: () => loadSlots(), serv: () => loadServices(), cli: () => loadClients(), cfg: () => loadCfg() };
function view(v) {
  cur = v; const n = NAV.find((x) => x[0] === v);
  NAV.forEach(([k]) => $('v-' + k).classList.toggle('hidden', k !== v));
  $('pgTitle').textContent = n[2];
  $('pgSub').textContent = v === 'home' ? 'Hoje é ' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : n[3];
  $('pgAct').innerHTML = v === 'serv' ? '<button class="btn" id="newServ">+ Novo serviço</button>' : '';
  if (v === 'serv') $('newServ').onclick = () => serviceForm();
  renderNav(); window.scrollTo({ top: 0 });
  loaders[v]();
}
const afterChange = () => loaders[cur]();

// ---------- Filtro de data (Agendamentos) ----------
const fcal = Calendar($('fcal'), { allowPast: true, marks: (iso) => apptDays[iso] || 0, onChange: (iso) => {
  filterDate = iso; $('fbtn').textContent = '📅 ' + fmt(iso); $('fpanel').classList.add('hidden'); load();
} });
$('fbtn').onclick = () => $('fpanel').classList.toggle('hidden');
$('fclear').onclick = () => { filterDate = ''; fcal.setValue(null); $('fbtn').textContent = '📅 Todas as datas'; $('fpanel').classList.add('hidden'); load(); };
document.addEventListener('click', (e) => { if (!e.composedPath().includes($('fpop'))) $('fpanel').classList.add('hidden'); });

// ---------- Agendamentos ----------
async function fetchAll() {
  const all = await api('/api/admin/appointments');
  apptDays = {}; all.forEach((a) => { apptDays[a.date] = (apptDays[a.date] || 0) + 1; }); fcal.refresh();
  pending = all.filter((a) => a.status === 'pendente').length; renderNav();
  return all;
}

const apRow = (a) => `
  <div class="ap">${dateBlock(a.date)}
    <div class="info"><strong>${esc(a.clienteNome)} ${chipSt(a.status)}</strong>
      <span class="small">${esc(a.servicoNome)} · ${a.time} · R$ ${a.preco}<br>📱 +${esc(a.clienteTel)}</span>
      ${a.notes ? `<div class="note">💬 ${esc(a.notes)}</div>` : ''}</div>
    <div class="apbtns">
      ${a.status === 'pendente' ? `<button class="btn ok sm" data-a="${a.id}" data-s="aprovado">Aprovar</button><button class="btn bad sm" data-a="${a.id}" data-s="recusado">Recusar</button>` : ''}
      <a class="btn sec sm" target="_blank" rel="noopener" href="${esc(a.waLink)}" aria-label="Abrir conversa no WhatsApp">WhatsApp</a>
      <button class="btn bad sm" data-del="${a.id}" aria-label="Excluir agendamento">🗑</button>
    </div></div>`;

function wireAp(root, l) {
  root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const a = l.find((x) => x.id == b.dataset.del);
    confirmDelete('Excluir agendamento?', `Agendamento de <strong>${esc(a.clienteNome)}</strong> (${esc(a.servicoNome)}, ${fmt(a.date)} às ${a.time}) será apagado${['pendente', 'aprovado'].includes(a.status) ? ' e o horário voltará a ficar livre' : ''}. A cliente não é avisada.`,
      async () => { await api('/api/admin/appointments/' + a.id, 'DELETE'); afterChange(); });
  }));
  root.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => decide(b.dataset.a, b.dataset.s, l.find((x) => x.id == b.dataset.a))));
}

async function loadHome() {
  const all = await fetchAll(), today = ISO(new Date()), c = (f) => all.filter(f).length;
  const nPend = c((a) => a.status === 'pendente');
  $('stats').innerHTML = `
    <div class="stat ${nPend ? 'hl' : ''}"><small>Aguardando aprovação</small><strong>${nPend}</strong></div>
    <div class="stat"><small>Atendimentos hoje</small><strong>${c((a) => a.date === today && a.status === 'aprovado')}</strong></div>
    <div class="stat"><small>Confirmados (futuros)</small><strong>${c((a) => a.date >= today && a.status === 'aprovado')}</strong></div>
    <div class="stat"><small>Total de pedidos</small><strong>${all.length}</strong></div>`;
  const pend = all.filter((a) => a.status === 'pendente');
  $('homePend').innerHTML = pend.length ? pend.slice(0, 5).map(apRow).join('') + (pend.length > 5 ? `<p class="small" style="margin:10px 0 0">+ ${pend.length - 5} pedidos aguardando…</p>` : '')
    : '<div class="empty"><span class="big">🎉</span>Tudo em dia! Nenhum pedido aguardando.</div>';
  const nx = all.filter((a) => a.status === 'aprovado' && a.date >= today).slice(0, 6);
  $('homeNext').innerHTML = nx.length ? nx.map(apRow).join('') : '<div class="empty"><span class="big">🌸</span>Nenhum atendimento confirmado por enquanto.</div>';
  wireAp($('homePend'), all); wireAp($('homeNext'), all);
}

function renderTabs() {
  $('tabs').innerHTML = TABS.map(([v, l]) => `<button class="${v === status ? 'on' : ''}" data-s="${v}">${l}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { status = b.dataset.s; renderTabs(); load(); }));
}

async function load() {
  $('list').innerHTML = skeleton();
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (filterDate) q.set('date', filterDate);
  const [l] = await Promise.all([api('/api/admin/appointments?' + q), fetchAll()]);
  $('list').innerHTML = l.length ? l.map(apRow).join('') : '<div class="empty"><span class="big">🌸</span>Nenhum agendamento aqui.</div>';
  wireAp($('list'), l);
}

function decide(id, s, a) {
  const ok = s === 'aprovado';
  const quick = ok ? ['Chegue 5 min antes', 'Pagamento no local'] : ['Dia lotado', 'Horário indisponível'];
  modal({
    title: ok ? 'Aprovar agendamento' : 'Recusar agendamento',
    html: `<p class="small"><strong>${esc(a.clienteNome)}</strong> · ${esc(a.servicoNome)}<br>${fmt(a.date)} às ${a.time}</p>
      <label for="msgx">Mensagem extra para a cliente (opcional)</label><textarea id="msgx" rows="3" maxlength="300"></textarea>
      <div class="quick">${quick.map((q) => `<button type="button">${q}</button>`).join('')}</div>
      <p class="small" style="margin-top:12px">A cliente receberá o retorno no WhatsApp.</p>`,
    actions: [{ label: 'Voltar', cls: 'sec' }, { label: ok ? 'Confirmar aprovação' : 'Confirmar recusa', cls: ok ? 'ok' : 'bad', onClick: async (close) => {
      try {
        const r = await api(`/api/admin/appointments/${id}/status`, 'POST', { status: s, message: $('msgx').value });
        close(); afterChange();
        if (r.whatsapp.enviado) toast('Mensagem enviada à cliente pelo WhatsApp ✓', 'ok');
        else modal({ title: 'Quase lá!', html: `<p>${ok ? 'Agendamento aprovado' : 'Agendamento recusado'}. Falta só enviar o aviso para <strong>${esc(a.clienteNome)}</strong>; a mensagem já está pronta.</p>`,
          actions: [{ label: 'Depois', cls: 'sec' }, { label: 'Enviar pelo WhatsApp', cls: 'wa', href: r.whatsapp.link, onClick: (c) => setTimeout(c, 100) }] });
      } catch (err) { toast(err.message, 'err'); close(); afterChange(); }
    } }],
  });
  document.querySelectorAll('.quick button').forEach((q) => (q.onclick = () => { $('msgx').value = q.textContent; $('msgx').focus(); }));
}

// ---------- Configurações: nome e logo ----------
async function loadCfg() {
  const s = await api('/api/admin/settings');
  $('cfgName').value = s.studio;
  $('cfgLogo').innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="Logo atual">` : '<span>💅</span><small>Sem logo</small>';
  $('logoDel').hidden = !s.logo;
}
function brandUpdated(r) { applyBrand(r); document.title = 'Admin – ' + r.studio; loadCfg(); }

// Reduz a imagem no navegador (máx. 512 px, mantendo a proporção) antes de enviar
async function prepareLogo(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/png');
  if (url.length > 1.9e6) url = c.toDataURL('image/webp', 0.9);
  return url;
}
$('logoPick').onclick = () => $('logoFile').click();
$('logoFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    brandUpdated(await api('/api/admin/settings/logo', 'POST', { dataUrl: await prepareLogo(f) }));
    toast('Logo atualizada ✓', 'ok');
  } catch (err) { toast(err.message || 'Não foi possível usar esta imagem.', 'err'); }
};
$('logoDel').onclick = () => modal({
  title: 'Remover a logo?', html: '<p class="small">O sistema volta a usar o ícone padrão.</p>',
  actions: [{ label: 'Voltar', cls: 'sec' }, { label: 'Remover', cls: 'bad', onClick: async (close) => { try { brandUpdated(await api('/api/admin/settings/logo', 'DELETE')); toast('Logo removida', 'ok'); } catch (err) { toast(err.message, 'err'); } close(); } }],
});
$('cfgSave').onclick = async () => {
  try { brandUpdated(await api('/api/admin/settings', 'PUT', { studio: $('cfgName').value })); toast('Nome salvo ✓', 'ok'); }
  catch (err) { toast(err.message, 'err'); }
};
$('cfgName').onkeydown = (e) => { if (e.key === 'Enter') $('cfgSave').click(); };

// Confirmação padrão para exclusões
const confirmDelete = (title, html, run) => modal({
  title, html: `<p class="small">${html}</p><p class="small"><strong>Esta ação não pode ser desfeita.</strong></p>`,
  actions: [{ label: 'Voltar', cls: 'sec' }, { label: 'Excluir', cls: 'bad', onClick: async (close) => {
    try { const msg = await run(); toast(typeof msg === 'string' ? msg : 'Excluído com sucesso', 'ok'); } catch (err) { toast(err.message, 'err'); }
    close();
  } }],
});

// ---------- CRUD: Serviços ----------
async function loadServices() {
  $('servList').innerHTML = skeleton(2);
  const l = await api('/api/admin/services');
  $('servList').innerHTML = l.length ? l.map((s) => `
    <div class="ap ${s.ativo ? '' : 'past'}"><span class="tk-ic">${esc(s.icone || '💅')}</span>
      <div class="info"><strong>${esc(s.nome)} ${s.ativo ? '' : '<span class="chipst cancelado">Inativo</span>'}</strong><span class="small">${s.minutos} min · R$ ${Number(s.preco).toFixed(2).replace('.', ',')}</span></div>
      <div class="apbtns"><button class="btn sec sm" data-e="${s.id}">Editar</button><button class="btn bad sm" data-x="${s.id}">Excluir</button></div></div>`).join('')
    : '<div class="empty"><span class="big">💅</span>Nenhum serviço cadastrado.</div>';
  $('servList').querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => serviceForm(l.find((x) => x.id === b.dataset.e))));
  $('servList').querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => {
    const s = l.find((x) => x.id === b.dataset.x);
    confirmDelete('Excluir serviço?', `O serviço <strong>${esc(s.nome)}</strong> deixará de aparecer para as clientes. Agendamentos já feitos continuam no histórico. Para só ocultar, use "Editar" e desmarque "Ativo".`,
      async () => { await api('/api/admin/services/' + s.id, 'DELETE'); loadServices(); });
  }));
}
function serviceForm(s) {
  const novo = !s; s = s || { nome: '', minutos: 60, preco: '', icone: '💅', ativo: true };
  modal({
    title: novo ? 'Novo serviço' : 'Editar serviço',
    html: `<label for="fNome">Nome</label><input id="fNome" maxlength="60" value="${esc(s.nome)}">
      <div class="row2"><div><label for="fMin">Duração (min)</label><input id="fMin" type="number" min="15" max="480" step="5" value="${s.minutos}"></div>
        <div><label for="fPreco">Preço (R$)</label><input id="fPreco" type="number" min="0" step="0.01" value="${s.preco}"></div></div>
      <label for="iconQ">Ícone</label>
      <div class="icon-top"><span class="ic-prev" id="icPrev">${esc(s.icone || '💅')}</span>
        <input id="iconQ" type="search" placeholder="Buscar ícone (ex.: pé, flor, brilho)" autocomplete="off">
        <input id="fIc" maxlength="8" value="${esc(s.icone || '💅')}" aria-label="Ícone escolhido (ou cole outro emoji)" title="Cole outro emoji aqui, se quiser"></div>
      <div class="iconlib" id="iconLib" role="listbox" aria-label="Biblioteca de ícones"></div>
      <label class="chk"><input type="checkbox" id="fAtivo" ${s.ativo ? 'checked' : ''}> Ativo (visível para as clientes)</label>`,
    actions: [{ label: 'Cancelar', cls: 'sec' }, { label: 'Salvar', onClick: async (close) => {
      const body = { nome: $('fNome').value, minutos: $('fMin').value, preco: $('fPreco').value, icone: $('fIc').value, ativo: $('fAtivo').checked };
      try { await api(novo ? '/api/admin/services' : '/api/admin/services/' + s.id, novo ? 'POST' : 'PUT', body); toast('Serviço salvo', 'ok'); close(); loadServices(); }
      catch (err) { toast(err.message, 'err'); }
    } }],
  });
  iconPicker();
}

// Biblioteca de ícones (emoji) com busca
const ICON_LIB = [
  ['💅', 'unha manicure esmalte'], ['💄', 'batom maquiagem'], ['💋', 'beijo labios'], ['🦶', 'pe pedicure pé'], ['👣', 'pegadas pes pé'],
  ['🖐️', 'mao mão dedos'], ['✋', 'mao mão'], ['🤲', 'maos mãos hidratacao hidratação'], ['🌸', 'flor cerejeira rosa'], ['🌺', 'flor hibisco'],
  ['🌷', 'flor tulipa'], ['🌹', 'rosa flor'], ['🌼', 'flor margarida'], ['🪷', 'lotus lótus flor spa'], ['🌿', 'folha erva natural spa'],
  ['🍃', 'folha natural'], ['✨', 'brilho gel glitter'], ['💎', 'diamante joia luxo'], ['💍', 'anel joia'], ['👑', 'coroa premium vip'],
  ['🎀', 'laco laço fita decoracao decoração'], ['💖', 'coracao coração brilho'], ['💕', 'coracao coração'], ['💜', 'roxo coracao coração'], ['💙', 'azul coracao coração'],
  ['🤍', 'branco coracao coração french'], ['🧴', 'creme hidratante locao loção'], ['🧼', 'sabao sabão limpeza'], ['🛁', 'banho banheira spa'], ['🚿', 'chuveiro banho'],
  ['🧖', 'spa sauna relaxar'], ['💆', 'massagem relaxar'], ['💇', 'cabelo corte'], ['✂️', 'tesoura corte cutícula'], ['🪞', 'espelho'],
  ['🕯️', 'vela relaxar spa'], ['🫧', 'bolhas espuma'], ['🌙', 'lua noite'], ['☀️', 'sol verao verão'], ['⭐', 'estrela'],
  ['🌟', 'estrela brilho'], ['💫', 'brilho'], ['🔥', 'fogo quente paraffin parafina'], ['🍓', 'morango fruta'], ['🍒', 'cereja fruta'],
  ['🍑', 'pessego pêssego fruta'], ['🍋', 'limao limão fruta'], ['🥥', 'coco'], ['🫐', 'mirtilo fruta'], ['🍇', 'uva fruta'],
  ['🦋', 'borboleta'], ['🐚', 'concha'], ['🎨', 'arte nail art desenho'], ['🖌️', 'pincel pintura'], ['🦢', 'cisne elegante'],
];
function iconPicker() {
  const lib = $('iconLib'), inp = $('fIc'), q = $('iconQ');
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const draw = () => {
    const t = norm(q.value.trim());
    const l = ICON_LIB.filter(([, k]) => !t || norm(k).includes(t));
    lib.innerHTML = l.length ? l.map(([e, k]) => `<button type="button" role="option" class="ico ${inp.value === e ? 'on' : ''}" data-e="${e}" aria-selected="${inp.value === e}" title="${esc(k.split(' ')[0])}">${e}</button>`).join('')
      : '<span class="small" style="padding:8px">Nenhum ícone encontrado. Cole um emoji no campo ao lado.</span>';
  };
  lib.onclick = (e) => { const b = e.target.closest('.ico'); if (!b) return; inp.value = b.dataset.e; $('icPrev').textContent = b.dataset.e; draw(); };
  inp.oninput = () => { $('icPrev').textContent = inp.value || '💅'; draw(); };
  q.oninput = draw;
  q.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
  draw();
}

// ---------- CRUD: Clientes ----------
let clients = [];
async function loadClients() {
  $('cliList').innerHTML = skeleton(2);
  clients = await api('/api/admin/clients');
  renderClients();
}
function renderClients() {
  const q = $('cliQ').value.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const l = clients.filter((c) => !q || c.name.toLowerCase().includes(q) || (qd && c.phone.includes(qd)));
  $('cliList').innerHTML = l.length ? l.map((c) => `
    <div class="ap"><span class="tk-ic">👤</span>
      <div class="info"><strong>${esc(c.name)}</strong><span class="small">📱 +${esc(c.phone)} · ${c.agendamentos} agendamento(s)${c.ativos ? `, ${c.ativos} ativo(s)` : ''}</span></div>
      <div class="apbtns"><button class="btn sec sm" data-e="${c.id}">Editar</button><button class="btn bad sm" data-x="${c.id}">Excluir</button></div></div>`).join('')
    : '<div class="empty"><span class="big">🌸</span>Nenhuma cliente encontrada.</div>';
  $('cliList').querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => clientForm(clients.find((x) => x.id == b.dataset.e))));
  $('cliList').querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => {
    const c = clients.find((x) => x.id == b.dataset.x);
    confirmDelete('Excluir cliente?', `<strong>${esc(c.name)}</strong> e todos os seus ${c.agendamentos} agendamento(s) serão removidos${c.ativos ? `, liberando ${c.ativos} horário(s) reservado(s)` : ''}.`,
      async () => { await api('/api/admin/clients/' + c.id, 'DELETE'); loadClients(); });
  }));
}
$('cliQ').oninput = renderClients;
function clientForm(c) {
  modal({
    title: 'Editar cliente',
    html: `<label for="cNome">Nome</label><input id="cNome" value="${esc(c.name)}"><label for="cTel">WhatsApp (com DDD)</label><input id="cTel" inputmode="tel" value="${esc(c.phone)}">`,
    actions: [{ label: 'Cancelar', cls: 'sec' }, { label: 'Salvar', onClick: async (close) => {
      try { await api('/api/admin/clients/' + c.id, 'PUT', { name: $('cNome').value, phone: $('cTel').value }); toast('Cliente atualizada', 'ok'); close(); loadClients(); }
      catch (err) { toast(err.message, 'err'); }
    } }],
  });
}

// ---------- Agenda (horários) ----------
const WD = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']];
const TEMPLATES = {
  comercial: { 1: [['09:00', '12:00'], ['14:00', '18:00']], 2: [['09:00', '12:00'], ['14:00', '18:00']], 3: [['09:00', '12:00'], ['14:00', '18:00']], 4: [['09:00', '12:00'], ['14:00', '18:00']], 5: [['09:00', '12:00'], ['14:00', '18:00']], 6: [['09:00', '13:00']], 0: [] },
  manha: { 1: [['08:00', '12:00']], 2: [['08:00', '12:00']], 3: [['08:00', '12:00']], 4: [['08:00', '12:00']], 5: [['08:00', '12:00']], 6: [['08:00', '12:00']], 0: [] },
  tarde: { 1: [['13:00', '18:00']], 2: [['13:00', '18:00']], 3: [['13:00', '18:00']], 4: [['13:00', '18:00']], 5: [['13:00', '18:00']], 6: [['13:00', '18:00']], 0: [] },
  limpar: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] },
};
const toSched = (t) => Object.fromEntries(Object.entries(t).map(([d, rs]) => [d, rs.map(([start, end]) => ({ start, end }))]));
let sched = toSched(TEMPLATES.comercial);
try { const s = JSON.parse(localStorage.getItem('agendaTpl') || 'null'); if (s && s.sched) { sched = s.sched; $('sInt').value = s.interval || '60'; $('sWeeks').value = s.weeks || '4'; } } catch {}
const saveTpl = () => { try { localStorage.setItem('agendaTpl', JSON.stringify({ sched, interval: $('sInt').value, weeks: $('sWeeks').value })); } catch {} };
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// A semana-modelo é aplicada a partir de hoje, pelo número de semanas escolhido
const range = () => { const t = new Date(), e = new Date(t); e.setDate(t.getDate() + +$('sWeeks').value * 7 - 1); return { from: ISO(t), to: ISO(e) }; };
$('presets').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { sched = toSched(TEMPLATES[b.dataset.t]); renderWeek(); preview(); }));
$('sInt').onchange = $('sWeeks').onchange = () => { preview(); saveTpl(); };

function renderWeek() {
  $('week').innerHTML = WD.map(([d, nome]) => {
    const rs = sched[d] || [];
    return `<div class="wrow ${rs.length ? '' : 'off'}" data-d="${d}">
      <label class="sw"><input type="checkbox" data-act="toggle" ${rs.length ? 'checked' : ''}><span class="sw-n">${nome}</span></label>
      <div class="rngs">${rs.length ? rs.map((r, i) => `<span class="rg">
          <input type="time" data-act="time" data-i="${i}" data-k="start" value="${r.start}" aria-label="Início ${nome}"> <i>às</i>
          <input type="time" data-act="time" data-i="${i}" data-k="end" value="${r.end}" aria-label="Fim ${nome}">
          <button type="button" class="x" data-act="rm" data-i="${i}" aria-label="Remover faixa">×</button></span>`).join('')
        : '<span class="small">Fechado</span>'}
        ${rs.length ? '<button type="button" class="link" data-act="add">+ faixa</button>' : ''}</div>
      ${rs.length ? '<button type="button" class="link sm" data-act="copy" title="Copiar estas faixas para todos os dias abertos">Copiar p/ todos</button>' : ''}</div>`;
  }).join('');
  saveTpl();
}
$('week').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.type === 'checkbox' || b.dataset.act === 'time') return;
  const d = b.closest('.wrow').dataset.d, rs = sched[d] = sched[d] || [];
  if (b.dataset.act === 'add') { const last = rs[rs.length - 1]; const s = last ? last.end : '09:00'; rs.push({ start: s, end: hhmm(Math.min(mins(s) + 180, 1439)) }); }
  if (b.dataset.act === 'rm') rs.splice(+b.dataset.i, 1);
  if (b.dataset.act === 'copy') for (const [n] of WD) if (n != d && (sched[n] || []).length) sched[n] = rs.map((r) => ({ ...r }));
  renderWeek(); preview();
});
$('week').addEventListener('change', (e) => {
  const t = e.target, d = t.closest('.wrow').dataset.d, rs = sched[d] = sched[d] || [];
  if (t.dataset.act === 'toggle') {
    if (t.checked) { const ref = Object.values(sched).find((x) => x && x.length); rs.push(...(ref ? ref.slice(0, 1).map((r) => ({ ...r })) : [{ start: '09:00', end: '17:00' }])); } else rs.length = 0;
    renderWeek();
  } else if (t.dataset.act === 'time') { rs[+t.dataset.i][t.dataset.k] = t.value; saveTpl(); }
  preview();
});

function countFor(f, t) {
  const step = +$('sInt').value; let days = 0, total = 0;
  for (let d = new Date(f + 'T12:00:00'), e = new Date(t + 'T12:00:00'); d <= e; d.setDate(d.getDate() + 1)) {
    const rs = sched[d.getDay()] || []; if (!rs.length) continue; days++;
    rs.forEach((r) => { if (r.start && r.end && mins(r.end) >= mins(r.start)) total += Math.floor((mins(r.end) - mins(r.start)) / step) + 1; });
  }
  return { days, total };
}
function preview() {
  const { from, to } = range();
  const { days, total } = countFor(from, to);
  $('sPrev').textContent = total ? `Serão publicados até ${total} horários em ${days} ${days === 1 ? 'dia' : 'dias'} (de ${fmt(from)} a ${fmt(to)}).` : 'Nenhum horário será criado: abra ao menos um dia da semana.';
}

$('fSlots').onsubmit = async (e) => {
  e.preventDefault();
  const { from, to } = range();
  try {
    const r = await api('/api/admin/slots/bulk', 'POST', { from, to, interval: $('sInt').value, schedule: sched, replace: $('sReplace').checked });
    toast(`${r.adicionados} horários adicionados` + (r.ignorados ? ` (${r.ignorados} já existiam)` : '') + (r.removidos ? ` · ${r.removidos} antigos removidos` : ''), 'ok');
    agTab('manage'); loadSlots();
  } catch (err) { toast(err.message, 'err'); }
};

// ----- Agenda: abas Gerenciar / Publicar -----
function agTab(t) {
  $('agManage').classList.toggle('hidden', t !== 'manage'); $('agPublish').classList.toggle('hidden', t !== 'publish');
  $('agTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  if (t === 'publish') $('agBar').classList.add('hidden'); else renderManage();
}
$('agTabs').querySelectorAll('button').forEach((b) => (b.onclick = () => agTab(b.dataset.t)));

// ----- Gerenciar agenda: filtros, seleção e exclusão em massa -----
const ag = { all: [], period: '30', wd: new Set([0, 1, 2, 3, 4, 5, 6]), sel: new Set() };
const PERIODS = [['7', 'Próximos 7 dias'], ['30', 'Próximos 30 dias'], ['all', 'Tudo']];
const WD_SHORT = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];

async function loadSlots() {
  $('slotList').innerHTML = skeleton(2);
  ag.all = await api('/api/admin/slots');
  pubDays = {}; ag.all.forEach((x) => { pubDays[x.date] = (pubDays[x.date] || 0) + 1; });
  renderManage();
}

// Horários que passam pelos filtros atuais
function agVisible() {
  const today = ISO(new Date());
  let limit = null;
  if (ag.period !== 'all') { const e = new Date(); e.setDate(e.getDate() + +ag.period - 1); limit = ISO(e); }
  return ag.all.filter((x) => x.date >= today && (!limit || x.date <= limit) && ag.wd.has(new Date(x.date + 'T12:00:00').getDay()));
}

function renderManage() {
  $('agPeriod').innerHTML = PERIODS.map(([v, l]) => `<button type="button" class="chip ${ag.period === v ? 'on' : ''}" data-p="${v}">${l}</button>`).join('');
  $('agWd').innerHTML = WD_SHORT.map(([n, l]) => `<button type="button" class="chip ${ag.wd.has(n) ? 'on' : ''}" data-n="${n}" aria-pressed="${ag.wd.has(n)}">${l}</button>`).join('');

  const vis = agVisible(), free = vis.filter((x) => !x.ocupado), freeIds = new Set(free.map((x) => x.id));
  for (const id of [...ag.sel]) if (!freeIds.has(id)) ag.sel.delete(id); // seleção só vale para o que está visível e livre

  // horários distintos (09:00, 10:00...) para selecionar em todos os dias de uma vez
  const times = [...new Set(free.map((x) => x.time))].sort();
  $('agTimes').innerHTML = times.length ? times.map((t) => {
    const ofT = free.filter((x) => x.time === t), all = ofT.every((x) => ag.sel.has(x.id));
    return `<button type="button" class="chip ${all ? 'on' : ''}" data-t="${t}">${t}<small> ×${ofT.length}</small></button>`;
  }).join('') : '<span class="small">—</span>';

  const dias = new Set(vis.map((x) => x.date)).size;
  $('agSummary').textContent = vis.length ? `${free.length} livres · ${vis.length - free.length} reservados · ${dias} ${dias === 1 ? 'dia' : 'dias'}` : 'Nenhum horário neste filtro';
  $('agSelAll').textContent = free.length && ag.sel.size === free.length ? 'Desmarcar todos' : 'Selecionar todos os livres';
  $('agSelAll').disabled = !free.length;

  if (!vis.length) {
    $('slotList').innerHTML = ag.all.length
      ? '<div class="empty"><span class="big">🔎</span>Nenhum horário com esses filtros.<br>Mude o período ou os dias da semana.</div>'
      : '<div class="empty"><span class="big">🗓️</span>Nenhum horário publicado ainda.<br><br><button type="button" class="btn" id="goPub">➕ Publicar horários</button></div>';
    if ($('goPub')) $('goPub').onclick = () => agTab('publish');
  } else {
    const byDay = {};
    vis.forEach((x) => (byDay[x.date] = byDay[x.date] || []).push(x));
    $('slotList').innerHTML = Object.entries(byDay).map(([d, xs]) => {
      const dt = new Date(d + 'T12:00:00'), fr = xs.filter((x) => !x.ocupado), nSel = fr.filter((x) => ag.sel.has(x.id)).length;
      return `<div class="ag-day">
        <div class="ag-dayh">
          <label class="ag-check" title="Selecionar os horários livres deste dia"><input type="checkbox" data-day="${d}" ${fr.length ? '' : 'disabled'} ${fr.length && nSel === fr.length ? 'checked' : ''} aria-label="Selecionar o dia ${fmt(d)}"><span></span></label>
          ${dateBlock(d)}
          <div class="info"><strong>${DIAS[dt.getDay()]}, ${fmt(d)}</strong><span class="small">${fr.length} livres${xs.length - fr.length ? ` · ${xs.length - fr.length} reservados` : ''}</span></div>
          <button type="button" class="btn sec sm" data-edit="${d}">Editar</button>
        </div>
        <div class="chips ag-chips">${xs.map((x) => x.ocupado
          ? `<span class="chip busy" title="${esc(x.cliente)} (${x.status})">${x.time} · ${esc(x.cliente.split(' ')[0])}</span>`
          : `<button type="button" class="chip pick ${ag.sel.has(x.id) ? 'on' : ''}" data-id="${x.id}" aria-pressed="${ag.sel.has(x.id)}">${x.time}</button>`).join('')}</div>
      </div>`;
    }).join('');
    $('slotList').querySelectorAll('input[data-day]').forEach((cb) => {
      const fr = (byDay[cb.dataset.day] || []).filter((x) => !x.ocupado), n = fr.filter((x) => ag.sel.has(x.id)).length;
      cb.indeterminate = n > 0 && n < fr.length;
    });
  }
  renderBar();
}

function renderBar() {
  const n = ag.sel.size;
  $('agBar').classList.toggle('hidden', !n || !$('agPublish').classList.contains('hidden'));
  $('agBarTxt').textContent = `${n} ${n === 1 ? 'horário selecionado' : 'horários selecionados'}`;
}

// Interações (delegadas)
$('agPeriod').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { ag.period = b.dataset.p; renderManage(); } };
$('agWd').onclick = (e) => {
  const b = e.target.closest('[data-n]'); if (!b) return;
  const n = +b.dataset.n; ag.wd.has(n) ? ag.wd.delete(n) : ag.wd.add(n); renderManage();
};
$('agTimes').onclick = (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  const ofT = agVisible().filter((x) => !x.ocupado && x.time === b.dataset.t), all = ofT.every((x) => ag.sel.has(x.id));
  ofT.forEach((x) => (all ? ag.sel.delete(x.id) : ag.sel.add(x.id))); renderManage();
};
$('agSelAll').onclick = () => {
  const free = agVisible().filter((x) => !x.ocupado);
  if (free.length && ag.sel.size === free.length) ag.sel.clear(); else free.forEach((x) => ag.sel.add(x.id));
  renderManage();
};
$('slotList').onclick = (e) => {
  const ed = e.target.closest('[data-edit]'); if (ed) return openDay(ed.dataset.edit);
  const chip = e.target.closest('.chip.pick'); if (chip) { const id = +chip.dataset.id; ag.sel.has(id) ? ag.sel.delete(id) : ag.sel.add(id); renderManage(); }
};
$('slotList').onchange = (e) => {
  const cb = e.target.closest('input[data-day]'); if (!cb) return;
  const fr = agVisible().filter((x) => !x.ocupado && x.date === cb.dataset.day);
  fr.forEach((x) => (cb.checked ? ag.sel.add(x.id) : ag.sel.delete(x.id))); renderManage();
};
$('agBarClear').onclick = () => { ag.sel.clear(); renderManage(); };
$('agBarDel').onclick = () => {
  const ids = [...ag.sel], n = ids.length;
  confirmDelete('Excluir horários selecionados?', `<strong>${n}</strong> ${n === 1 ? 'horário livre será removido' : 'horários livres serão removidos'} da agenda e deixarão de aparecer para as clientes. Horários reservados nunca são apagados.`, async () => {
    const r = await api('/api/admin/slots/delete-many', 'POST', { ids });
    ag.sel.clear(); await loadSlots();
    return `${r.removidos} ${r.removidos === 1 ? 'horário excluído' : 'horários excluídos'}` + (r.reservados ? ` · ${r.reservados} reservado(s) mantido(s)` : '');
  });
};

function openDay(date) {
  const dt = new Date(date + 'T12:00:00');
  modal({ title: `${DIAS[dt.getDay()]}, ${fmt(date)}`, html: '<div id="dayBody"></div>', actions: [{ label: 'Concluir', cls: '' }] });
  renderDay(date);
}
async function renderDay(date) {
  const l = (await api('/api/admin/slots')).filter((x) => x.date === date);
  const body = $('dayBody'); if (!body) return;
  body.innerHTML = `<div class="chips">${l.length ? l.map((x) => x.ocupado
      ? `<span class="chip busy" title="${esc(x.cliente)}">${x.time} · ${esc(x.cliente.split(' ')[0])}</span>`
      : `<span class="chip free">${x.time}<button type="button" class="x" data-id="${x.id}" aria-label="Remover ${x.time}">×</button></span>`).join('')
      : '<span class="small">Nenhum horário neste dia.</span>'}</div>
    <label for="dTime">Adicionar um horário</label>
    <div class="row"><input type="time" id="dTime" value="09:00"><button type="button" class="btn sm" id="dAdd">Adicionar</button></div>
    <label>Gerar uma faixa de horários</label>
    <div class="row2"><input type="time" id="dS" value="09:00" aria-label="Início"><input type="time" id="dE" value="12:00" aria-label="Fim">
      <select id="dI" aria-label="Intervalo"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sec sm" id="dGen">Gerar faixa</button><button type="button" class="btn bad sm" id="dClr">Limpar livres do dia</button></div>`;
  const done = (msg) => { if (msg) toast(msg, 'ok'); renderDay(date); loadSlots(); };
  const fail = (err) => toast(err.message, 'err');
  body.querySelectorAll('.x').forEach((b) => (b.onclick = () => api('/api/admin/slots/' + b.dataset.id, 'DELETE').then(() => done()).catch(fail)));
  $('dAdd').onclick = () => api('/api/admin/slots/single', 'POST', { date, time: $('dTime').value }).then(() => done()).catch(fail);
  $('dGen').onclick = () => api('/api/admin/slots/bulk', 'POST', { from: date, to: date, interval: $('dI').value, schedule: { [new Date(date + 'T12:00:00').getDay()]: [{ start: $('dS').value, end: $('dE').value }] } })
    .then((r) => done(`${r.adicionados} horários adicionados`)).catch(fail);
  $('dClr').onclick = () => api('/api/admin/slots/clear-day', 'POST', { date }).then((r) => done(`${r.removidos} horários removidos`)).catch(fail);
}

async function init() {
  const [me, c] = await Promise.all([api('/api/me'), api('/api/config')]);
  applyBrand(c); document.title = 'Admin – ' + c.studio;
  $('login').classList.toggle('hidden', me.admin);
  $('shell').classList.toggle('hidden', !me.admin);
  if (me.admin) { renderTabs(); renderWeek(); preview(); view(cur); }
}
init();
