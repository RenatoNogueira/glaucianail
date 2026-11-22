// Atendimento (concluído / não compareceu) e pagamentos (sinal de 50% ou total) + números do Dashboard.
//
// Onde ficam os dados: em settings.fin = { [idDoAgendamento]: { resultado, resultadoEm, pago, forma, pagoEm } }.
// Assim nada muda na estrutura das tabelas do banco (nenhum SQL novo para rodar no Supabase) e o horário continua
// protegido pelo status do agendamento (pendente/aprovado ocupam o horário; recusado/cancelado liberam).
//
// "Estado" mostrado ao admin = status do agendamento, mas um agendamento APROVADO vira "concluido" ou "nao_compareceu"
// quando a admin registra o desfecho.

const FORMAS = ['pix', 'dinheiro', 'cartao', 'outro'];
const RESULTADOS = ['concluido', 'nao_compareceu'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const finOf = (settings, id) => ((settings && settings.fin) || {})[id] || {};

// Agendamento + dados calculados (estado, quanto foi pago, quanto falta e o tipo de pagamento)
function enrich(a, settings) {
  const f = finOf(settings, a.id);
  const preco = r2(a.preco);
  const pago = Math.min(preco, r2(f.pago));
  const estado = a.status === 'aprovado' && RESULTADOS.includes(f.resultado) ? f.resultado : a.status;
  const pagamento = preco <= 0 || pago >= preco ? 'total' : pago > 0 ? 'sinal' : 'nenhum';
  return { ...a, estado, pago, restante: r2(preco - pago), pagamento, forma: f.forma || null, pagoEm: f.pagoEm || null, resultadoEm: f.resultadoEm || null };
}

// Quanto vale cada tipo de pagamento para um preço
const valorDoTipo = (tipo, preco) => (tipo === 'total' ? r2(preco) : tipo === 'sinal' ? r2(preco / 2) : 0);

// "Pendente de pagamento": atendimento confirmado ou concluído que ainda tem valor em aberto
const pendentePagamento = (e) => (e.estado === 'aprovado' || e.estado === 'concluido') && e.restante > 0;

// ---------- Dashboard ----------
const dayStr = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dayStr(d); };
const PERIODOS = { hoje: 'Hoje', 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', mes: 'Este mês', ano: 'Este ano', tudo: 'Tudo' };

function intervalo(periodo, today) {
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  switch (periodo) {
    case 'hoje': return { from: today, to: today };
    case '7': return { from: addDays(today, -6), to: today };
    case '30': return { from: addDays(today, -29), to: today };
    case 'mes': return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
    case 'ano': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: null, to: null };
  }
}

function buildDashboard(enriched, periodo, today) {
  if (!PERIODOS[periodo]) periodo = '30';
  const { from, to } = intervalo(periodo, today);
  const list = enriched.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const por = (st) => list.filter((e) => e.estado === st);
  const soma = (arr, k) => r2(arr.reduce((s, e) => s + (e[k] || 0), 0));

  const concl = por('concluido'), nao = por('nao_compareceu'), conf = por('aprovado');
  const validos = [...conf, ...concl]; // atendimentos que "valem" (confirmados + concluídos)
  const emAberto = concl.filter((e) => e.restante > 0);
  const kpis = {
    receita: soma(list, 'pago'), // tudo que já entrou (inclui sinais)
    aReceber: soma(emAberto, 'restante'), aReceberQtd: emAberto.length, // concluídos com valor em aberto
    previsto: soma(conf, 'restante'), // o que ainda falta receber dos confirmados (ainda não concluídos)
    total: list.length, pendentes: por('pendente').length, confirmados: conf.length, concluidos: concl.length,
    naoCompareceu: nao.length, cancelados: por('cancelado').length, recusados: por('recusado').length,
    comparecimento: concl.length + nao.length ? Math.round((concl.length / (concl.length + nao.length)) * 100) : null,
    ticketMedio: concl.length ? r2(soma(concl, 'pago') / concl.length) : null,
  };

  const pagamentos = ['total', 'sinal', 'nenhum'].map((t) => {
    const g = validos.filter((e) => e.pagamento === t);
    return { tipo: t, qtd: g.length, valor: soma(g, 'pago') };
  });

  // Série para o gráfico: por dia (períodos curtos) ou por mês (ano / tudo)
  const mensal = periodo === 'ano' || periodo === 'tudo';
  const chave = (d) => (mensal ? d.slice(0, 7) : d);
  const datas = list.map((e) => e.date).sort();
  const ini = from || datas[0], fim = to || datas[datas.length - 1];
  const serie = [];
  if (ini && fim) {
    if (mensal) {
      let [yy, mm] = ini.slice(0, 7).split('-').map(Number); const [ye, me] = fim.slice(0, 7).split('-').map(Number);
      for (let n = 0; n < 60 && (yy < ye || (yy === ye && mm <= me)); n++) { serie.push({ k: `${yy}-${String(mm).padStart(2, '0')}`, receita: 0, atend: 0 }); if (++mm > 12) { mm = 1; yy++; } }
    } else for (let d = ini, n = 0; d <= fim && n < 62; d = addDays(d, 1), n++) serie.push({ k: d, receita: 0, atend: 0 });
    const idx = new Map(serie.map((s) => [s.k, s]));
    for (const e of list) { const s = idx.get(chave(e.date)); if (!s) continue; s.receita = r2(s.receita + e.pago); if (e.estado === 'aprovado' || e.estado === 'concluido') s.atend++; }
  }

  const grupos = (keyFn, nomeFn) => {
    const m = new Map();
    for (const e of validos) { const k = keyFn(e); const g = m.get(k) || { nome: nomeFn(e), qtd: 0, receita: 0 }; g.qtd++; g.receita = r2(g.receita + e.pago); m.set(k, g); }
    return [...m.values()].sort((a, b) => b.receita - a.receita || b.qtd - a.qtd);
  };
  const porServico = grupos((e) => e.servicoNome, (e) => e.servicoNome).slice(0, 6);
  const topClientes = grupos((e) => e.clienteTel, (e) => e.clienteNome).slice(0, 5);
  const diasSemana = [0, 0, 0, 0, 0, 0, 0];
  validos.forEach((e) => { diasSemana[new Date(e.date + 'T12:00:00Z').getUTCDay()]++; });

  return { periodo, rotulo: PERIODOS[periodo], from: ini || null, to: fim || null, kpis, pagamentos, serie, mensal, porServico, topClientes, diasSemana };
}

module.exports = { FORMAS, RESULTADOS, PERIODOS, r2, finOf, enrich, valorDoTipo, pendentePagamento, buildDashboard, intervalo };
