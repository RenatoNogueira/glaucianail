// Atendimentos (concluído / não compareceu / cancelado), pagamentos (50% / 100%) e o Dashboard do painel.
// Carregado antes de admin.js; usa funções do admin.js (confirmDelete, afterChange...) só depois que a página já abriu.

const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowLocal = () => { const d = new Date(); return ISO(d) + ' ' + d.toTimeString().slice(0, 5); };
const jaComecou = (a) => a.date + ' ' + a.time <= nowLocal();
const FORMAS = [['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao', 'Cartão'], ['outro', 'Outro']];
const FORMA_L = Object.fromEntries(FORMAS);

// ---------- Etiquetas e botões de cada agendamento ----------
function payChip(a) {
  if (!['pendente', 'aprovado', 'concluido'].includes(a.estado)) return '';
  if (a.pagamento === 'total') return `<span class="chipst pago" title="${esc(FORMA_L[a.forma] || '')}">💰 Pago 100%</span>`;
  if (a.pagamento === 'sinal') return `<span class="chipst sinal">💰 Sinal 50% · falta ${brl(a.restante)}</span>`;
  return a.estado === 'concluido' ? `<span class="chipst devendo">Pagamento pendente · ${brl(a.restante)}</span>` : '<span class="chipst nopay">Sem pagamento</span>';
}

function finButtons(a) {
  const b = [];
  if (a.estado === 'aprovado' && jaComecou(a)) b.push(`<button class="btn ok sm" data-fin="concluido" data-id="${a.id}">✓ Concluir</button><button class="btn sec sm" data-fin="nao_compareceu" data-id="${a.id}">Não compareceu</button>`);
  if (['pendente', 'aprovado', 'concluido'].includes(a.estado)) b.push(`<button class="btn sec sm" data-fin="pagar" data-id="${a.id}">💰 ${a.pagamento === 'total' ? 'Pagamento' : 'Receber'}</button>`);
  if (a.estado === 'aprovado') b.push(`<button class="btn bad sm" data-fin="cancelar" data-id="${a.id}">Cancelar</button>`);
  if (a.estado === 'concluido' || a.estado === 'nao_compareceu') b.push(`<button class="btn sec sm" data-fin="reabrir" data-id="${a.id}">↩ Reabrir</button>`);
  return b.join('');
}

function wireFin(root, list) {
  root.querySelectorAll('[data-fin]').forEach((btn) => (btn.onclick = () => {
    const a = list.find((x) => String(x.id) === btn.dataset.id); if (!a) return;
    const k = btn.dataset.fin;
    if (k === 'pagar') return paymentModal(a);
    if (k === 'cancelar') return cancelModal(a);
    setOutcome(a, k === 'reabrir' ? null : k);
  }));
}

async function setOutcome(a, resultado) {
  try {
    await api(`/api/admin/appointments/${a.id}/outcome`, 'POST', { resultado });
    toast(resultado === 'concluido' ? 'Atendimento concluído ✓' : resultado === 'nao_compareceu' ? 'Marcado como não compareceu' : 'Atendimento reaberto', 'ok');
    afterChange();
    if (resultado === 'concluido' && a.restante > 0) setTimeout(() => toast(`Falta receber ${brl(a.restante)} de ${a.clienteNome.split(' ')[0]}.`), 300);
  } catch (err) { toast(err.message, 'err'); }
}

function cancelModal(a) {
  const close = modal({
    title: 'Cancelar agendamento?',
    html: `<p class="small"><strong>${esc(a.clienteNome)}</strong> · ${esc(a.servicoNome)}<br>${fmt(a.date)} às ${a.time}</p>
      <p class="small">O horário volta a ficar livre para novas clientes.${a.pago > 0 ? ` <strong>Atenção:</strong> já há ${brl(a.pago)} registrado como pago; ajuste em "Receber" se for devolver.` : ''}</p>
      <label for="cmsg">Mensagem para a cliente (opcional)</label><textarea id="cmsg" rows="3" maxlength="300" placeholder="Ex.: Tive um imprevisto, desculpe!"></textarea>`,
    actions: [{ label: 'Voltar', cls: 'sec' }, { label: 'Cancelar agendamento', cls: 'bad', onClick: async () => {
      try {
        const r = await api(`/api/admin/appointments/${a.id}/cancel`, 'POST', { message: $('cmsg').value });
        close(); afterChange(); toast('Agendamento cancelado', 'ok');
        if (r.whatsapp.enviado) toast('Aviso enviado à cliente pelo WhatsApp ✓', 'ok');
        else modal({ title: 'Avise a cliente', html: `<p>O agendamento foi cancelado. Falta só avisar <strong>${esc(a.clienteNome)}</strong>; a mensagem já está pronta.</p>`,
          actions: [{ label: 'Depois', cls: 'sec' }, { label: 'Enviar pelo WhatsApp', cls: 'wa', href: r.whatsapp.link, onClick: (c) => setTimeout(c, 100) }] });
      } catch (err) { toast(err.message, 'err'); }
    } }],
  });
}

// ---------- Pagamento: sem pagamento / sinal 50% / total 100% ----------
function paymentModal(a) {
  let tipo = a.pagamento, forma = a.forma || 'pix';
  const metade = Math.round((a.preco / 2) * 100) / 100;
  const opts = [['nenhum', 'Sem pagamento', 'Nada recebido ainda'], ['sinal', 'Sinal de 50%', brl(metade)], ['total', 'Pagamento total (100%)', brl(a.preco)]];
  const close = modal({
    title: 'Pagamento',
    html: `<p class="small"><strong>${esc(a.clienteNome)}</strong> · ${esc(a.servicoNome)} · ${fmt(a.date)} às ${a.time}<br>Valor do serviço: <strong>${brl(a.preco)}</strong></p>
      <div class="payopts" id="payOpts" role="radiogroup" aria-label="Quanto foi pago">${opts.map(([v, t, s]) => `<button type="button" role="radio" class="payopt ${v === tipo ? 'on' : ''}" data-tipo="${v}" aria-checked="${v === tipo}"><strong>${t}</strong><span>${s}</span></button>`).join('')}</div>
      <div id="payForma"><label for="fForma">Forma de pagamento</label><select id="fForma">${FORMAS.map(([v, l]) => `<option value="${v}" ${v === forma ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="small" id="payInfo" style="margin-top:10px"></p>`,
    actions: [{ label: 'Voltar', cls: 'sec' }, { label: 'Salvar pagamento', cls: 'ok', onClick: async () => {
      try {
        await api(`/api/admin/appointments/${a.id}/payment`, 'POST', { tipo, forma: $('fForma').value });
        close(); afterChange();
        toast(tipo === 'total' ? 'Pagamento de 100% registrado ✓' : tipo === 'sinal' ? 'Sinal de 50% registrado ✓' : 'Pagamento removido', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    } }],
  });
  const paint = () => {
    $('payOpts').querySelectorAll('.payopt').forEach((b) => { const on = b.dataset.tipo === tipo; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    $('payForma').style.display = tipo === 'nenhum' ? 'none' : '';
    const v = tipo === 'total' ? a.preco : tipo === 'sinal' ? metade : 0;
    $('payInfo').textContent = tipo === 'nenhum' ? 'O pagamento registrado será removido.' : `Falta receber: ${brl(Math.max(0, a.preco - v))}`;
  };
  $('payOpts').onclick = (e) => { const b = e.target.closest('.payopt'); if (b) { tipo = b.dataset.tipo; paint(); } };
  paint();
}

// ---------- Dashboard ----------
const DASH = { p: '30' };
try { const s = localStorage.getItem('dashPeriodo'); if (s) DASH.p = s; } catch {}
const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['ano', 'Este ano'], ['tudo', 'Tudo']];
const DIA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function barChart(d) {
  const s = d.serie;
  if (!s.length) return '<div class="empty"><span class="big">📊</span>Sem dados neste período.</div>';
  const W = 640, H = 190, pl = 8, pr = 8, pt = 14, pb = 26, max = Math.max(1, ...s.map((x) => x.receita));
  const bw = (W - pl - pr) / s.length, gap = Math.min(6, bw * 0.25);
  const lbl = (k) => (d.mensal ? `${k.slice(5)}/${k.slice(2, 4)}` : k.slice(8) + '/' + k.slice(5, 7));
  const every = Math.ceil(s.length / 8);
  const bars = s.map((x, i) => {
    const h = x.receita > 0 ? Math.max(3, (x.receita / max) * (H - pt - pb)) : 0, xx = pl + i * bw + gap / 2, y = H - pb - h;
    return `<g><title>${lbl(x.k)} · ${brl(x.receita)} · ${x.atend} atendimento(s)</title><rect class="bar" x="${xx.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`
      + (i % every === 0 ? `<text class="axis" x="${(xx + (bw - gap) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${lbl(x.k)}</text>` : '') + '</g>';
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="barchart" role="img" aria-label="Receita ${d.mensal ? 'por mês' : 'por dia'}"><line class="grid" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>
    <text class="axis max" x="${W - pr}" y="10" text-anchor="end">máx. ${brl(max)}</text>${bars}</svg>`;
}

function donut(d) {
  const g = Object.fromEntries(d.pagamentos.map((p) => [p.tipo, p]));
  const tot = d.pagamentos.reduce((s, p) => s + p.qtd, 0);
  const cores = { total: 'var(--ok)', sinal: 'var(--gold)', nenhum: 'var(--line)' };
  let acc = 0; const seg = tot ? ['total', 'sinal', 'nenhum'].map((t) => { const a = acc; acc += (g[t].qtd / tot) * 100; return `${cores[t]} ${a.toFixed(2)}% ${acc.toFixed(2)}%`; }).join(',') : 'var(--line) 0 100%';
  const leg = [['total', 'Pago 100%'], ['sinal', 'Sinal 50%'], ['nenhum', 'Sem pagamento']].map(([t, l]) => `<li><i style="background:${cores[t]}"></i><span>${l}</span><b>${g[t].qtd}</b><small>${brl(g[t].valor)}</small></li>`).join('');
  return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${seg})" role="img" aria-label="Pagamentos"><div><strong>${tot}</strong><small>atend.</small></div></div><ul class="legend">${leg}</ul></div>`;
}

function statusBar(k) {
  const itens = [['concluidos', 'Concluídos', 'var(--ok)'], ['confirmados', 'Confirmados', 'var(--rose)'], ['pendentes', 'Aguardando', 'var(--gold)'], ['naoCompareceu', 'Não compareceu', '#8b5cf6'], ['cancelados', 'Cancelados', 'var(--muted)'], ['recusados', 'Recusados', 'var(--err)']];
  const tot = itens.reduce((s, [key]) => s + k[key], 0);
  if (!tot) return '<div class="empty"><span class="big">🌸</span>Nenhum agendamento neste período.</div>';
  return `<div class="stack" role="img" aria-label="Distribuição dos agendamentos">${itens.filter(([key]) => k[key]).map(([key, l, c]) => `<span style="width:${(k[key] / tot) * 100}%;background:${c}" title="${l}: ${k[key]}"></span>`).join('')}</div>
    <ul class="legend two">${itens.map(([key, l, c]) => `<li><i style="background:${c}"></i><span>${l}</span><b>${k[key]}</b></li>`).join('')}</ul>`;
}

const hbars = (rows, fmtV) => (rows.length ? `<ul class="hbars">${rows.map((r) => { const m = Math.max(1, ...rows.map((x) => x.v)); return `<li><span class="hb-n">${esc(r.n)}</span><i><b style="width:${Math.max(4, (r.v / m) * 100)}%"></b></i><span class="hb-v">${fmtV(r)}</span></li>`; }).join('')}</ul>` : '<div class="empty"><span class="big">🌸</span>Sem dados.</div>');

function renderDash(d) {
  const k = d.kpis, ok = (v, f) => (v === null ? '—' : f(v));
  $('dashRange').textContent = d.from ? `${d.rotulo}: ${fmt(d.from)} a ${fmt(d.to)} · por data do atendimento` : 'Sem atendimentos ainda';
  $('dashPer').innerHTML = PERIODOS.map(([v, l]) => `<button type="button" class="chip ${DASH.p === v ? 'on' : ''}" data-p="${v}">${l}</button>`).join('');
  $('stats').innerHTML = `
    <div class="stat money"><small>💰 Recebido</small><strong>${brl(k.receita)}</strong><em>inclui sinais de 50%</em></div>
    <div class="stat ${k.aReceber ? 'warn' : ''}"><small>🧾 A receber (concluídos)</small><strong>${brl(k.aReceber)}</strong><em>${k.aReceberQtd} atendimento(s) com pagamento pendente</em></div>
    <div class="stat"><small>📌 Previsto (confirmados)</small><strong>${brl(k.previsto)}</strong><em>ainda falta receber</em></div>
    <div class="stat ${k.pendentes ? 'hl' : ''}"><small>⏳ Aguardando aprovação</small><strong>${k.pendentes}</strong></div>
    <div class="stat"><small>✅ Concluídos</small><strong>${k.concluidos}</strong></div>
    <div class="stat"><small>🚫 Não compareceu</small><strong>${k.naoCompareceu}</strong><em>comparecimento: ${ok(k.comparecimento, (v) => v + '%')}</em></div>
    <div class="stat"><small>✕ Cancelados</small><strong>${k.cancelados}</strong><em>${k.recusados} recusado(s)</em></div>
    <div class="stat"><small>🎟️ Ticket médio</small><strong>${ok(k.ticketMedio, brl)}</strong><em>por atendimento concluído</em></div>`;
  $('dashRev').innerHTML = barChart(d);
  $('dashPay').innerHTML = donut(d);
  $('dashStatus').innerHTML = statusBar(k);
  $('dashSvc').innerHTML = hbars(d.porServico.map((x) => ({ n: x.nome, v: x.qtd, r: x.receita })), (r) => `${r.v}× · ${brl(r.r)}`);
  const mx = Math.max(1, ...d.diasSemana);
  $('dashDow').innerHTML = d.diasSemana.some((n) => n) ? `<div class="dow">${d.diasSemana.map((n, i) => `<div title="${DIA_CURTO[i]}: ${n}"><i style="height:${Math.max(4, (n / mx) * 100)}%"></i><b>${n}</b><span>${DIA_CURTO[i]}</span></div>`).join('')}</div>` : '<div class="empty"><span class="big">🌸</span>Sem dados.</div>';
  $('dashCli').innerHTML = hbars(d.topClientes.map((x) => ({ n: x.nome, v: x.receita || x.qtd, q: x.qtd, r: x.receita })), (r) => `${r.q}× · ${brl(r.r)}`);
}

$('dashPer').onclick = (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  DASH.p = b.dataset.p; try { localStorage.setItem('dashPeriodo', DASH.p); } catch {}
  loadDash();
};
async function loadDash() { renderDash(await api('/api/admin/dashboard?periodo=' + encodeURIComponent(DASH.p))); }
