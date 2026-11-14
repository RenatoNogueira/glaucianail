// Textos editáveis da página inicial do site. Fonte única: o servidor valida/entrega e o painel admin monta o formulário a partir daqui.
// O que a administradora edita fica em settings.landing (só as chaves alteradas); vazio = volta ao texto padrão abaixo.
//   tipo "linha": uma linha · "texto": parágrafo curto (sem quebras de linha)
//   *palavra* no título vira destaque (itálico colorido). {ano} e {nome} no rodapé são substituídos automaticamente.

const GRUPOS = [
  ['topo', 'Topo da página'],
  ['entrada', 'Cartão de entrada'],
  ['horarios', 'Próximos horários'],
  ['servicos', 'Serviços'],
  ['como', 'Como funciona'],
  ['rodape', 'Rodapé'],
];

const CAMPOS = [
  { key: 'badge', grupo: 'topo', rotulo: 'Selo acima do título', tipo: 'linha', max: 40, padrao: '✨ Agendamento online' },
  { key: 'titulo', grupo: 'topo', rotulo: 'Título principal', tipo: 'linha', max: 120, padrao: 'Unhas e pés *cuidados*, sem complicação.', dica: 'Coloque *asteriscos* em volta de uma palavra para destacá-la.' },
  { key: 'subtitulo', grupo: 'topo', rotulo: 'Texto de apoio', tipo: 'texto', max: 300, padrao: 'Escolha o serviço, o dia e o horário em poucos toques. Você recebe a confirmação direto no seu WhatsApp.' },
  { key: 'vantagem1', grupo: 'topo', rotulo: 'Vantagem 1', tipo: 'linha', max: 80, padrao: 'Agende em menos de 1 minuto' },
  { key: 'vantagem2', grupo: 'topo', rotulo: 'Vantagem 2', tipo: 'linha', max: 80, padrao: 'Confirmação pelo WhatsApp' },
  { key: 'vantagem3', grupo: 'topo', rotulo: 'Vantagem 3', tipo: 'linha', max: 80, padrao: 'Só horários realmente livres' },
  { key: 'botaoPrincipal', grupo: 'topo', rotulo: 'Botão principal', tipo: 'linha', max: 30, padrao: 'Agendar agora' },
  { key: 'botaoSecundario', grupo: 'topo', rotulo: 'Botão secundário', tipo: 'linha', max: 30, padrao: 'Já tenho conta' },

  { key: 'authLoginTitulo', grupo: 'entrada', rotulo: 'Título ao entrar', tipo: 'linha', max: 50, padrao: 'Bem-vinda de volta' },
  { key: 'authCadastroTitulo', grupo: 'entrada', rotulo: 'Título ao criar conta', tipo: 'linha', max: 50, padrao: 'Crie sua conta' },

  { key: 'horariosTitulo', grupo: 'horarios', rotulo: 'Título da seção', tipo: 'linha', max: 60, padrao: 'Próximos horários livres' },
  { key: 'horariosSub', grupo: 'horarios', rotulo: 'Subtítulo', tipo: 'linha', max: 120, padrao: 'Toque em um para começar.' },

  { key: 'servicosTitulo', grupo: 'servicos', rotulo: 'Título da seção', tipo: 'linha', max: 60, padrao: 'Nossos serviços' },
  { key: 'servicosSub', grupo: 'servicos', rotulo: 'Subtítulo', tipo: 'linha', max: 120, padrao: 'Tudo para cuidar das suas mãos e pés.' },

  { key: 'comoTitulo', grupo: 'como', rotulo: 'Título da seção', tipo: 'linha', max: 60, padrao: 'Como funciona' },
  { key: 'passo1Titulo', grupo: 'como', rotulo: 'Passo 1 — título', tipo: 'linha', max: 30, padrao: 'Escolha' },
  { key: 'passo1Desc', grupo: 'como', rotulo: 'Passo 1 — descrição', tipo: 'linha', max: 80, padrao: 'o serviço que você quer fazer.' },
  { key: 'passo2Titulo', grupo: 'como', rotulo: 'Passo 2 — título', tipo: 'linha', max: 30, padrao: 'Selecione' },
  { key: 'passo2Desc', grupo: 'como', rotulo: 'Passo 2 — descrição', tipo: 'linha', max: 80, padrao: 'um dia e um horário disponível.' },
  { key: 'passo3Titulo', grupo: 'como', rotulo: 'Passo 3 — título', tipo: 'linha', max: 30, padrao: 'Receba' },
  { key: 'passo3Desc', grupo: 'como', rotulo: 'Passo 3 — descrição', tipo: 'linha', max: 80, padrao: 'a aprovação no seu WhatsApp.' },

  { key: 'rodape', grupo: 'rodape', rotulo: 'Texto do rodapé', tipo: 'linha', max: 160, padrao: '© {ano} {nome} · Agendamento online', dica: 'Use {ano} e {nome} para inserir o ano atual e o nome do estúdio.' },
];

const POR_CHAVE = Object.fromEntries(CAMPOS.map((c) => [c.key, c]));
const limpar = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); // sem quebras/controles

// Textos efetivos: o que a admin editou, ou o padrão
function mesclar(custom) {
  const c = custom && typeof custom === 'object' ? custom : {};
  return Object.fromEntries(CAMPOS.map((f) => [f.key, typeof c[f.key] === 'string' && limpar(c[f.key]) ? limpar(c[f.key]) : f.padrao]));
}

// Valida o que a admin enviou. Retorna { valores } (só chaves preenchidas) ou { erro }
function validar(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { erro: 'Formato inválido.' };
  const valores = {};
  for (const [k, v] of Object.entries(entrada)) {
    const f = POR_CHAVE[k];
    if (!f) return { erro: `Campo desconhecido: ${k}` };
    if (typeof v !== 'string') return { erro: `"${f.rotulo}" deve ser um texto.` };
    const t = limpar(v);
    if (!t) continue; // vazio = restaurar o padrão
    if (t.length > f.max) return { erro: `"${f.rotulo}" passa de ${f.max} caracteres.` };
    valores[k] = t;
  }
  return { valores };
}

module.exports = { CAMPOS, GRUPOS, mesclar, validar };
