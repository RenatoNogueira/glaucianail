const $ = (id) => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmt = (s) => s.split('-').reverse().join('/');
const dateBlock = (s) => `<div class="date-blk"><strong>${s.slice(8)}</strong><small>${MESES[+s.slice(5, 7) - 1]}</small></div>`;
const ISO = (d) => d.toLocaleDateString('sv-SE');
const STATUS_LABEL = { pendente: '⏳ Aguardando', aprovado: '✓ Confirmado', recusado: '✕ Recusado', cancelado: 'Cancelado' };
const chipSt = (s) => `<span class="chipst ${s}">${STATUS_LABEL[s] || s}</span>`;

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  // Sessão expirada (cookie vence em 8h): volta para a tela de login em vez de mostrar erros soltos
  if (r.status === 401 && !/\/(login|register)$/.test(url) && !window.__reloading401) { window.__reloading401 = true; location.reload(); }
  if (!r.ok) throw new Error(r.status === 429 ? (d.erro || 'Muitas tentativas. Aguarde um pouco.') : d.erro || 'Erro inesperado. Tente novamente.');
  return d;
}

function toast(msg, type = '') {
  let box = $('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), 3800);
}

// modal({title, html, actions:[{label, cls, onClick(close)}]}) -> close()
function modal({ title, html = '', actions = [] }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div>${html}</div><div class="acts"></div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  ov.onclick = (e) => e.target === ov && close();
  actions.forEach((a) => {
    const b = document.createElement(a.href ? 'a' : 'button');
    b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    if (a.href) { b.href = a.href; b.target = '_blank'; b.rel = 'noopener'; }
    b.onclick = () => (a.onClick ? a.onClick(close) : close());
    ov.querySelector('.acts').append(b);
  });
  document.body.append(ov);
  (ov.querySelector('textarea,input,.btn:last-child') || ov).focus();
  return close;
}

const skeleton = (n = 3) => '<div class="skel"></div>'.repeat(n);

// ---------- Tema claro / escuro ----------
(function () {
  const root = document.documentElement;
  const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const current = () => root.dataset.theme || (sysDark() ? 'dark' : 'light');
  const bar = document.querySelector('.topbar>div');
  let btn = null;
  if (bar) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'theme'; btn.dataset.themeToggle = ''; }
  const toggles = () => [...document.querySelectorAll('[data-theme-toggle]')];
  const paint = () => {
    const dark = current() === 'dark';
    toggles().forEach((b) => {
      b.title = b.ariaLabel = dark ? 'Mudar para modo claro' : 'Mudar para modo escuro';
      const lab = b.querySelector('.tl'); // botões com rótulo (menu lateral)
      if (lab) { b.querySelector('.ni').textContent = dark ? '☀️' : '🌙'; lab.textContent = dark ? 'Modo claro' : 'Modo escuro'; } else b.textContent = dark ? '☀️' : '🌙';
    });
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#231a27' : '#c2456f';
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    paint();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paint);
  if (bar) { const end = document.createElement('div'); end.className = 'end'; [...bar.children].slice(1).forEach((c) => end.append(c)); end.append(btn); bar.append(end); }
  paint();
})();

// ---------- Identidade (logo e nome da empresa) ----------
// Elementos marcados com data-brand-logo / data-brand-name são preenchidos a partir de { studio, logo }
function applyBrand(c) {
  document.querySelectorAll('[data-brand-name]').forEach((e) => (e.textContent = c.studio));
  document.querySelectorAll('[data-brand-logo]').forEach((e) => {
    e.innerHTML = c.logo ? `<img src="${esc(c.logo)}" alt="Logo ${esc(c.studio)}">` : esc(e.dataset.fallback || '💅');
    e.classList.toggle('has-logo', !!c.logo);
  });
  let ic = document.querySelector('link[rel=icon]');
  if (c.logo) { if (!ic) { ic = document.createElement('link'); ic.rel = 'icon'; document.head.append(ic); } ic.href = c.logo; } else if (ic) ic.href = '/icon-192.png'; // sem logo: volta ao ícone padrão
}

// ---------- Instalar como app (PWA) ----------
// Elementos com [data-install] aparecem no celular (e no computador quando o navegador oferece a instalação).
// Android/Chrome/Edge: abre a janela de instalação. iPhone/iPad e casos sem janela automática: passo a passo.
(function () {
  const ua = navigator.userAgent;
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  // Navegadores embutidos (WhatsApp, Instagram, Facebook...) não conseguem instalar: é preciso abrir no Chrome/Safari
  const emApp = /; wv\)|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok/i.test(ua);
  let evento = null;
  const atualizar = () => { const mostrar = !instalado() && (!!evento || ios || android); document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = !mostrar)); };

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evento = e; atualizar(); });
  window.addEventListener('appinstalled', () => { evento = null; atualizar(); toast('App instalado! Procure o ícone na tela inicial ✓', 'ok'); });

  const ajuda = (titulo, passos, nota) => modal({
    title: titulo,
    html: `<ol class="small" style="padding-left:20px;line-height:1.9;margin:0">${passos.map((p) => `<li>${p}</li>`).join('')}</ol>${nota ? `<p class="small" style="margin-top:12px">${nota}</p>` : ''}`,
    actions: [{ label: 'Entendi' }],
  });

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-install]')) return;
    if (emApp) return ajuda('Abra no navegador', ['Toque nos <strong>três pontinhos ⋮</strong> (ou no ícone de compartilhar) aqui no canto.', 'Escolha <strong>Abrir no Chrome</strong> (ou <strong>Abrir no Safari</strong>).', 'Depois toque em <strong>Instalar</strong> de novo.'], 'Dentro do WhatsApp/Instagram não é possível instalar o app.');
    if (evento) {
      evento.prompt();
      const r = await evento.userChoice.catch(() => ({}));
      evento = null; atualizar();
      if (r.outcome === 'dismissed') toast('Sem problemas! Você pode instalar depois pelo menu do navegador (⋮ → Instalar app).');
      else if (r.outcome === 'accepted') toast('Instalando… o ícone aparece na tela inicial em instantes ✓', 'ok');
      return;
    }
    if (ios) return ajuda('Instalar no iPhone / iPad', ['Toque no botão <strong>Compartilhar</strong> (o quadrado com a seta ⬆︎).', 'Role e escolha <strong>Adicionar à Tela de Início</strong>.', 'Toque em <strong>Adicionar</strong>. O ícone aparece na sua tela.'], 'No iPhone é preciso usar o <strong>Safari</strong>.');
    ajuda('Instalar no Android', ['Toque nos <strong>três pontinhos ⋮</strong> do Chrome (canto superior direito).', 'Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).', 'Confirme em <strong>Instalar</strong>. O ícone aparece na tela inicial.'], 'Não apareceu o ícone? Em <em>Configurações do celular → Apps → Chrome → Permissões</em>, ative <strong>Criar atalhos na tela inicial</strong> (alguns aparelhos pedem isso).');
  });
  atualizar();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();

// ---------- Calendário ----------
// Calendar(el, { mode:'single'|'range', enabled(iso), marks(iso)->n, allowPast, onChange(value) })
// single: value = 'YYYY-MM-DD'|null   range: value = { from, to }
const MESES_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function Calendar(el, o = {}) {
  const range = o.mode === 'range';
  const enabled = o.enabled || (() => true);
  const marks = o.marks || (() => 0);
  let view = new Date(); view.setDate(1); view.setHours(12);
  let value = range ? { from: null, to: null } : null;
  let focusIso = null;
  const pad = (n) => String(n).padStart(2, '0');

  function render() {
    const today = ISO(new Date());
    const y = view.getFullYear(), m = view.getMonth();
    const cur = `${y}-${pad(m + 1)}`;
    const lead = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    let cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= n; d++) {
      const iso = `${cur}-${pad(d)}`;
      const off = (!o.allowPast && iso < today) || !enabled(iso);
      const mk = marks(iso);
      let cls = 'cd';
      if (iso === today) cls += ' today';
      if (mk) cls += ' mk';
      if (range) {
        if (iso === value.from || iso === value.to) cls += ' sel';
        if (value.from && value.to && iso > value.from && iso < value.to) cls += ' rng';
        if (value.from && value.to && iso === value.from) cls += ' rs';
        if (value.from && value.to && iso === value.to) cls += ' re';
      } else if (iso === value) cls += ' sel';
      cells += `<button type="button" class="${cls}" data-iso="${iso}" ${off ? 'disabled' : ''} aria-label="${d} de ${MESES_FULL[m]}${mk ? ', ' + mk + ' horários' : ''}" aria-pressed="${cls.includes('sel')}">${d}</button>`;
    }
    const minCur = o.allowPast ? '' : today.slice(0, 7);
    el.classList.add('cal');
    el.innerHTML = `<div class="cal-h">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="Mês anterior" ${cur <= minCur ? 'disabled' : ''}>‹</button>
      <strong>${MESES_FULL[m]} ${y}</strong>
      <button type="button" class="cal-nav" data-nav="1" aria-label="Próximo mês">›</button></div>
      <div class="cal-w">${DIAS.map((d) => `<span>${d.slice(0, 3)}</span>`).join('')}</div>
      <div class="cal-g">${cells}</div>`;
    if (focusIso) { el.querySelector(`[data-iso="${focusIso}"]`)?.focus(); focusIso = null; }
  }

  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { view.setMonth(view.getMonth() + +nav.dataset.nav); render(); return; }
    const b = e.target.closest('[data-iso]');
    if (!b || b.disabled) return;
    const iso = b.dataset.iso;
    if (range) {
      const { from, to } = value;
      value = !from || to ? { from: iso, to: null } : iso < from ? { from: iso, to: null } : { from, to: iso };
    } else value = iso;
    focusIso = iso; render();
    o.onChange && o.onChange(value);
  });

  render();
  return {
    get value() { return value; },
    setValue(v) { value = v === undefined ? (range ? { from: null, to: null } : null) : v; render(); },
    refresh: render,
    goTo(iso) { view = new Date(iso + 'T12:00:00'); view.setDate(1); render(); },
  };
}
