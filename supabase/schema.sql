-- ============================================================================
-- Agenda Manicure & Pé de Curi — estrutura do banco (PostgreSQL / Supabase)
-- Gerado por "npm run schema" a partir de lib/schema.js. Pode rodar mais de uma vez (idempotente).
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Obs.: o app também cria isso sozinho no primeiro acesso; rodar manualmente é opcional.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS agenda;

CREATE TABLE IF NOT EXISTS agenda.meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS agenda.users (
  id         integer PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,
  hash       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agenda.services (
  id      text PRIMARY KEY,
  nome    text NOT NULL,
  minutos integer NOT NULL CHECK (minutos BETWEEN 15 AND 480),
  preco   numeric(10,2) NOT NULL CHECK (preco >= 0),
  icone   text NOT NULL DEFAULT '💅',
  ativo   boolean NOT NULL DEFAULT true,
  pos     integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agenda.slots (
  id   integer PRIMARY KEY,
  dia  text NOT NULL,
  hora text NOT NULL,
  UNIQUE (dia, hora)
);

CREATE TABLE IF NOT EXISTS agenda.appointments (
  id            integer PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES agenda.users (id) ON DELETE CASCADE,
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
);

CREATE INDEX IF NOT EXISTS appointments_user_idx ON agenda.appointments (user_id);

CREATE INDEX IF NOT EXISTS appointments_dia_idx ON agenda.appointments (dia, hora);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_ativo_uk ON agenda.appointments (dia, hora) WHERE status IN ('pendente','aprovado');

CREATE TABLE IF NOT EXISTS agenda.assets (
  name text PRIMARY KEY,
  mime text NOT NULL,
  data text NOT NULL
);

ALTER TABLE agenda.users DROP CONSTRAINT IF EXISTS users_name_ck;

ALTER TABLE agenda.users ADD CONSTRAINT users_name_ck CHECK (name ~ '^.{2,80}$');

ALTER TABLE agenda.users DROP CONSTRAINT IF EXISTS users_phone_ck;

ALTER TABLE agenda.users ADD CONSTRAINT users_phone_ck CHECK (phone ~ '^55[0-9]{10,11}$');

ALTER TABLE agenda.services DROP CONSTRAINT IF EXISTS services_nome_ck;

ALTER TABLE agenda.services ADD CONSTRAINT services_nome_ck CHECK (nome ~ '^.{2,60}$');

ALTER TABLE agenda.slots DROP CONSTRAINT IF EXISTS slots_dia_ck;

ALTER TABLE agenda.slots ADD CONSTRAINT slots_dia_ck CHECK (dia ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE agenda.slots DROP CONSTRAINT IF EXISTS slots_hora_ck;

ALTER TABLE agenda.slots ADD CONSTRAINT slots_hora_ck CHECK (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE agenda.appointments DROP CONSTRAINT IF EXISTS appointments_dia_ck;

ALTER TABLE agenda.appointments ADD CONSTRAINT appointments_dia_ck CHECK (dia ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE agenda.appointments DROP CONSTRAINT IF EXISTS appointments_hora_ck;

ALTER TABLE agenda.appointments ADD CONSTRAINT appointments_hora_ck CHECK (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE agenda.meta ENABLE ROW LEVEL SECURITY;

ALTER TABLE agenda.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE agenda.services ENABLE ROW LEVEL SECURITY;

ALTER TABLE agenda.slots ENABLE ROW LEVEL SECURITY;

ALTER TABLE agenda.appointments ENABLE ROW LEVEL SECURITY;

ALTER TABLE agenda.assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA agenda FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA agenda FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA agenda FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA agenda FROM authenticated';
  END IF;
END
$$;

INSERT INTO agenda.meta (key, value) VALUES
  ('seq', '{"n": 0}'),
  ('version', '1'),
  ('settings', '{"studio": null, "logo": null, "logoV": 0}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO agenda.services (id, nome, minutos, preco, icone, ativo, pos) VALUES
  ('manicure', 'Manicure', 60, 35, '💅', true, 0),
  ('pedicure', 'Pé de curi (Pedicure)', 60, 40, '🦶', true, 1),
  ('combo', 'Manicure + Pedicure', 120, 70, '🌸', true, 2),
  ('esmaltacao', 'Esmaltação em gel', 90, 80, '✨', true, 3)
ON CONFLICT (id) DO NOTHING;
