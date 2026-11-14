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
  ('settings', '{"studio": null, "logo": null, "logoV": 0}'),
  ('lock', '{"token": null, "until": null}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO agenda.services (id, nome, minutos, preco, icone, ativo, pos) VALUES
  ('manicure', 'Manicure', 60, 35, '💅', true, 0),
  ('pedicure', 'Pé de curi (Pedicure)', 60, 40, '🦶', true, 1),
  ('combo', 'Manicure + Pedicure', 120, 70, '🌸', true, 2),
  ('esmaltacao', 'Esmaltação em gel', 90, 80, '✨', true, 3)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.agenda_load()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RETURN jsonb_build_object(
    'meta',         COALESCE((SELECT jsonb_object_agg(m.key, m.value) FROM agenda.meta m), '{}'::jsonb),
    'users',        COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM agenda.users u), '[]'::jsonb),
    'services',     COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.pos, s.id) FROM agenda.services s), '[]'::jsonb),
    'slots',        COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM agenda.slots x), '[]'::jsonb),
    'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM agenda.appointments a), '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_load() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_load() TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_lock(p_token text, p_ttl integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
BEGIN
  INSERT INTO agenda.meta (key, value) VALUES ('lock', '{"token": null, "until": null}'::jsonb) ON CONFLICT (key) DO NOTHING;
  UPDATE agenda.meta
     SET value = jsonb_build_object('token', p_token, 'until', now() + make_interval(secs => p_ttl))
   WHERE key = 'lock'
     AND (value->>'token' IS NULL OR (value->>'until')::timestamptz <= now());
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_lock(p_token text, p_ttl integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_lock(p_token text, p_ttl integer) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_unlock(p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
BEGIN
  UPDATE agenda.meta SET value = '{"token": null, "until": null}'::jsonb WHERE key = 'lock' AND value->>'token' = p_token;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_unlock(p_token text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_unlock(p_token text) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_apply(p_token text, p_changes jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE lk jsonb;
BEGIN
  SELECT value INTO lk FROM agenda.meta WHERE key = 'lock' FOR UPDATE;
  IF lk IS NULL OR lk->>'token' IS DISTINCT FROM p_token OR (lk->>'until')::timestamptz <= now() THEN
    RAISE EXCEPTION 'lock_lost' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM agenda.appointments WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'appointments', '[]'::jsonb))::int);
  DELETE FROM agenda.slots        WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'slots',        '[]'::jsonb))::int);
  DELETE FROM agenda.services     WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'services',     '[]'::jsonb)));
  DELETE FROM agenda.users        WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'users',        '[]'::jsonb))::int);

  INSERT INTO agenda.users (id, name, phone, hash)
    SELECT r.id, r.name, r.phone, r.hash
      FROM jsonb_populate_recordset(NULL::agenda.users, COALESCE(p_changes->'upserts'->'users', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, hash = EXCLUDED.hash;

  INSERT INTO agenda.services (id, nome, minutos, preco, icone, ativo, pos)
    SELECT r.id, r.nome, r.minutos, r.preco, r.icone, r.ativo, r.pos
      FROM jsonb_populate_recordset(NULL::agenda.services, COALESCE(p_changes->'upserts'->'services', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, minutos = EXCLUDED.minutos, preco = EXCLUDED.preco,
    icone = EXCLUDED.icone, ativo = EXCLUDED.ativo, pos = EXCLUDED.pos;

  INSERT INTO agenda.slots (id, dia, hora)
    SELECT r.id, r.dia, r.hora
      FROM jsonb_populate_recordset(NULL::agenda.slots, COALESCE(p_changes->'upserts'->'slots', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET dia = EXCLUDED.dia, hora = EXCLUDED.hora;

  INSERT INTO agenda.appointments (id, user_id, cliente_nome, cliente_tel, servico_id, servico_nome, minutos, preco, dia, hora, notes, status, criado_em, atualizado_em)
    SELECT r.id, r.user_id, r.cliente_nome, r.cliente_tel, r.servico_id, r.servico_nome, r.minutos, r.preco, r.dia, r.hora, r.notes, r.status, r.criado_em, r.atualizado_em
      FROM jsonb_populate_recordset(NULL::agenda.appointments, COALESCE(p_changes->'upserts'->'appointments', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, cliente_nome = EXCLUDED.cliente_nome, cliente_tel = EXCLUDED.cliente_tel,
    servico_id = EXCLUDED.servico_id, servico_nome = EXCLUDED.servico_nome, minutos = EXCLUDED.minutos, preco = EXCLUDED.preco,
    dia = EXCLUDED.dia, hora = EXCLUDED.hora, notes = EXCLUDED.notes, status = EXCLUDED.status,
    criado_em = EXCLUDED.criado_em, atualizado_em = EXCLUDED.atualizado_em;

  IF jsonb_typeof(p_changes->'meta') = 'object' THEN
    INSERT INTO agenda.meta (key, value) VALUES
      ('seq', jsonb_build_object('n', (p_changes->'meta'->>'seq')::int)),
      ('settings', p_changes->'meta'->'settings')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;

  UPDATE agenda.meta SET value = '{"token": null, "until": null}'::jsonb WHERE key = 'lock';
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_apply(p_token text, p_changes jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_apply(p_token text, p_changes jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_logo_get()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE r jsonb;
BEGIN
  SELECT jsonb_build_object('mime', a.mime, 'data', a.data) INTO r FROM agenda.assets a WHERE a.name = 'logo';
  RETURN r;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_logo_get() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_logo_get() TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_logo_put(p_mime text, p_data text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
BEGIN
  INSERT INTO agenda.assets (name, mime, data) VALUES ('logo', p_mime, p_data)
  ON CONFLICT (name) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_logo_put(p_mime text, p_data text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_logo_put(p_mime text, p_data text) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_logo_del()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
BEGIN
  DELETE FROM agenda.assets WHERE name = 'logo';
END;
$fn$;

REVOKE ALL ON FUNCTION public.agenda_logo_del() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agenda_logo_del() TO service_role;
