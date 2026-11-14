// Estrutura do banco PostgreSQL (Supabase). Fonte única: o app executa isto sozinho no primeiro acesso e o
// arquivo supabase/schema.sql (para rodar à mão no SQL Editor) é gerado a partir daqui:  npm run schema
//
// Modelo:
//   users         clientes (WhatsApp único)
//   services      catálogo de serviços (preço/duração/ícone, ativo)
//   slots         horários publicados pela admin (dia + hora, únicos)
//   appointments  pedidos de agendamento (guarda cópia do nome/preço do serviço = histórico)
//   meta          contador de ids, versão do esquema e configurações (nome/logo do estúdio)
//   assets        arquivo da logo
// Datas/horas ficam como texto 'YYYY-MM-DD' / 'HH:MM' (o app inteiro trabalha assim), protegidas por CHECK.

const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

// Validações de formato (regex). Entram como ALTER TABLE "optional" apenas porque o Postgres em memória usado nos
// testes (pg-mem) não possui o operador ~; no Postgres/Supabase de verdade elas são aplicadas normalmente.
const DIA = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'";
const HORA = "'^([01][0-9]|2[0-3]):[0-5][0-9]$'";
const FORMATOS = [
  ['users', 'users_name_ck', "name ~ '^.{2,80}$'"],
  ['users', 'users_phone_ck', "phone ~ '^55[0-9]{10,11}$'"],
  ['services', 'services_nome_ck', "nome ~ '^.{2,60}$'"],
  ['slots', 'slots_dia_ck', `dia ~ ${DIA}`],
  ['slots', 'slots_hora_ck', `hora ~ ${HORA}`],
  ['appointments', 'appointments_dia_ck', `dia ~ ${DIA}`],
  ['appointments', 'appointments_hora_ck', `hora ~ ${HORA}`],
];

function ddl(schema) {
  if (!SCHEMA_RE.test(schema)) throw new Error('Nome de schema inválido: ' + schema);
  const S = schema;
  return [
    { sql: `CREATE SCHEMA IF NOT EXISTS ${S}` },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
)` },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.users (
  id         integer PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,
  hash       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)` },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.services (
  id      text PRIMARY KEY,
  nome    text NOT NULL,
  minutos integer NOT NULL CHECK (minutos BETWEEN 15 AND 480),
  preco   numeric(10,2) NOT NULL CHECK (preco >= 0),
  icone   text NOT NULL DEFAULT '💅',
  ativo   boolean NOT NULL DEFAULT true,
  pos     integer NOT NULL DEFAULT 0
)` },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.slots (
  id   integer PRIMARY KEY,
  dia  text NOT NULL,
  hora text NOT NULL,
  UNIQUE (dia, hora)
)` },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.appointments (
  id            integer PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES ${S}.users (id) ON DELETE CASCADE,
  cliente_nome  text NOT NULL,
  cliente_tel   text NOT NULL,
  servico_id    text,
  servico_nome  text NOT NULL,
  minutos       integer NOT NULL,
  preco         numeric(10,2) NOT NULL,
  dia           text NOT NULL,
  hora          text NOT NULL,
  notes         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado','cancelado')),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz
)` },

    { sql: `CREATE INDEX IF NOT EXISTS appointments_user_idx ON ${S}.appointments (user_id)` },
    { sql: `CREATE INDEX IF NOT EXISTS appointments_dia_idx ON ${S}.appointments (dia, hora)` },
    // Garantia no próprio banco: um horário nunca tem dois pedidos ativos (pendente/aprovado)
    { sql: `CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_ativo_uk ON ${S}.appointments (dia, hora) WHERE status IN ('pendente','aprovado')`, optional: true },

    { sql: `CREATE TABLE IF NOT EXISTS ${S}.assets (
  name text PRIMARY KEY,
  mime text NOT NULL,
  data text NOT NULL
)` },

    // Validações de formato (idempotentes: remove e recria)
    ...FORMATOS.flatMap(([t, nome, cond]) => [
      { sql: `ALTER TABLE ${S}.${t} DROP CONSTRAINT IF EXISTS ${nome}`, optional: true },
      { sql: `ALTER TABLE ${S}.${t} ADD CONSTRAINT ${nome} CHECK (${cond})`, optional: true },
    ]),

    // Segurança (Supabase): RLS ligado e SEM políticas => anon/authenticated não leem nem gravam.
    // O app conecta pelo papel "postgres" (pooler), que ignora o RLS.
    ...['meta', 'users', 'services', 'slots', 'appointments', 'assets'].map((t) => ({ sql: `ALTER TABLE ${S}.${t} ENABLE ROW LEVEL SECURITY`, optional: true })),
    { sql: `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA ${S} FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA ${S} FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM authenticated';
  END IF;
END
$$`, optional: true },
  ];
}

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// Dados iniciais (serviços padrão e contadores). Idempotente.
function seedSql(schema, services, version) {
  const rows = services.map((s, i) => `  (${[s.id, s.nome, s.minutos, s.preco, s.icone, s.ativo !== false, i].map(lit).join(', ')})`).join(',\n');
  return [
    `INSERT INTO ${schema}.meta (key, value) VALUES\n  ('seq', '{"n": 0}'),\n  ('version', '${version}'),\n  ('settings', '{"studio": null, "logo": null, "logoV": 0}')\nON CONFLICT (key) DO NOTHING`,
    `INSERT INTO ${schema}.services (id, nome, minutos, preco, icone, ativo, pos) VALUES\n${rows}\nON CONFLICT (id) DO NOTHING`,
  ];
}

// Texto completo do arquivo SQL para o SQL Editor do Supabase
function fullSql(schema, services, version) {
  const head = `-- ============================================================================
-- Agenda Manicure & Pé de Curi — estrutura do banco (PostgreSQL / Supabase)
-- Gerado por "npm run schema" a partir de lib/schema.js. Pode rodar mais de uma vez (idempotente).
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Obs.: o app também cria isso sozinho no primeiro acesso; rodar manualmente é opcional.
-- ============================================================================\n\n`;
  return head + [...ddl(schema).map((s) => s.sql), ...seedSql(schema, services, version)].map((s) => s + ';').join('\n\n') + '\n';
}

module.exports = { ddl, seedSql, fullSql, SCHEMA_RE };
