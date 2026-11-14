// Funções (RPC) para acesso pela API do Supabase com a chave SECRETA (modo SUPABASE_URL + SUPABASE_SECRET_KEY).
// As tabelas ficam no schema privado ("agenda"); a API só enxerga estas funções, liberadas APENAS para o papel
// service_role. Cada função roda em uma transação única no banco (atômica).
// O SQL é gerado em supabase/schema.sql por "npm run schema".

function rpcSql(S) {
  const header = (sig, ret) => `CREATE OR REPLACE FUNCTION public.${sig}\nRETURNS ${ret}\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public\nAS $fn$`;
  const fns = [
    { sig: 'agenda_load()', ret: 'jsonb', body: `
BEGIN
  RETURN jsonb_build_object(
    'meta',         COALESCE((SELECT jsonb_object_agg(m.key, m.value) FROM ${S}.meta m), '{}'::jsonb),
    'users',        COALESCE((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM ${S}.users u), '[]'::jsonb),
    'services',     COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.pos, s.id) FROM ${S}.services s), '[]'::jsonb),
    'slots',        COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM ${S}.slots x), '[]'::jsonb),
    'appointments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM ${S}.appointments a), '[]'::jsonb)
  );
END;` },

    // Trava (lease) de escrita: só um pedido altera os dados por vez, mesmo com várias instâncias da Vercel
    { sig: 'agenda_lock(p_token text, p_ttl integer DEFAULT 10)', ret: 'boolean', body: `
BEGIN
  INSERT INTO ${S}.meta (key, value) VALUES ('lock', '{"token": null, "until": null}'::jsonb) ON CONFLICT (key) DO NOTHING;
  UPDATE ${S}.meta
     SET value = jsonb_build_object('token', p_token, 'until', now() + make_interval(secs => p_ttl))
   WHERE key = 'lock'
     AND (value->>'token' IS NULL OR (value->>'until')::timestamptz <= now());
  RETURN FOUND;
END;` },

    { sig: 'agenda_unlock(p_token text)', ret: 'void', body: `
BEGIN
  UPDATE ${S}.meta SET value = '{"token": null, "until": null}'::jsonb WHERE key = 'lock' AND value->>'token' = p_token;
END;` },

    // Aplica as alterações (remoções + inserções/atualizações + contador/configurações) de uma vez e solta a trava
    { sig: 'agenda_apply(p_token text, p_changes jsonb)', ret: 'void', body: `
DECLARE lk jsonb;
BEGIN
  SELECT value INTO lk FROM ${S}.meta WHERE key = 'lock' FOR UPDATE;
  IF lk IS NULL OR lk->>'token' IS DISTINCT FROM p_token OR (lk->>'until')::timestamptz <= now() THEN
    RAISE EXCEPTION 'lock_lost' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM ${S}.appointments WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'appointments', '[]'::jsonb))::int);
  DELETE FROM ${S}.slots        WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'slots',        '[]'::jsonb))::int);
  DELETE FROM ${S}.services     WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'services',     '[]'::jsonb)));
  DELETE FROM ${S}.users        WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_changes->'deletes'->'users',        '[]'::jsonb))::int);

  INSERT INTO ${S}.users (id, name, phone, hash)
    SELECT r.id, r.name, r.phone, r.hash
      FROM jsonb_populate_recordset(NULL::${S}.users, COALESCE(p_changes->'upserts'->'users', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, hash = EXCLUDED.hash;

  INSERT INTO ${S}.services (id, nome, minutos, preco, icone, ativo, pos)
    SELECT r.id, r.nome, r.minutos, r.preco, r.icone, r.ativo, r.pos
      FROM jsonb_populate_recordset(NULL::${S}.services, COALESCE(p_changes->'upserts'->'services', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, minutos = EXCLUDED.minutos, preco = EXCLUDED.preco,
    icone = EXCLUDED.icone, ativo = EXCLUDED.ativo, pos = EXCLUDED.pos;

  INSERT INTO ${S}.slots (id, dia, hora)
    SELECT r.id, r.dia, r.hora
      FROM jsonb_populate_recordset(NULL::${S}.slots, COALESCE(p_changes->'upserts'->'slots', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET dia = EXCLUDED.dia, hora = EXCLUDED.hora;

  INSERT INTO ${S}.appointments (id, user_id, cliente_nome, cliente_tel, servico_id, servico_nome, minutos, preco, dia, hora, notes, status, criado_em, atualizado_em)
    SELECT r.id, r.user_id, r.cliente_nome, r.cliente_tel, r.servico_id, r.servico_nome, r.minutos, r.preco, r.dia, r.hora, r.notes, r.status, r.criado_em, r.atualizado_em
      FROM jsonb_populate_recordset(NULL::${S}.appointments, COALESCE(p_changes->'upserts'->'appointments', '[]'::jsonb)) r
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, cliente_nome = EXCLUDED.cliente_nome, cliente_tel = EXCLUDED.cliente_tel,
    servico_id = EXCLUDED.servico_id, servico_nome = EXCLUDED.servico_nome, minutos = EXCLUDED.minutos, preco = EXCLUDED.preco,
    dia = EXCLUDED.dia, hora = EXCLUDED.hora, notes = EXCLUDED.notes, status = EXCLUDED.status,
    criado_em = EXCLUDED.criado_em, atualizado_em = EXCLUDED.atualizado_em;

  IF jsonb_typeof(p_changes->'meta') = 'object' THEN
    INSERT INTO ${S}.meta (key, value) VALUES
      ('seq', jsonb_build_object('n', (p_changes->'meta'->>'seq')::int)),
      ('settings', p_changes->'meta'->'settings')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;

  UPDATE ${S}.meta SET value = '{"token": null, "until": null}'::jsonb WHERE key = 'lock';
END;` },

    { sig: 'agenda_logo_get()', ret: 'jsonb', body: `
DECLARE r jsonb;
BEGIN
  SELECT jsonb_build_object('mime', a.mime, 'data', a.data) INTO r FROM ${S}.assets a WHERE a.name = 'logo';
  RETURN r;
END;` },

    { sig: 'agenda_logo_put(p_mime text, p_data text)', ret: 'void', body: `
BEGIN
  INSERT INTO ${S}.assets (name, mime, data) VALUES ('logo', p_mime, p_data)
  ON CONFLICT (name) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data;
END;` },

    { sig: 'agenda_logo_del()', ret: 'void', body: `
BEGIN
  DELETE FROM ${S}.assets WHERE name = 'logo';
END;` },
  ];

  const out = [];
  for (const f of fns) {
    out.push(`${header(f.sig, f.ret)}${f.body}\n$fn$`);
    const i = f.sig.indexOf('(');
    const name = f.sig.slice(0, i);
    const args = f.sig.slice(i).replace(/ DEFAULT [^,)]+/g, ''); // assinatura sem DEFAULT, para GRANT/REVOKE
    out.push(`REVOKE ALL ON FUNCTION public.${name}${args} FROM PUBLIC, anon, authenticated`);
    out.push(`GRANT EXECUTE ON FUNCTION public.${name}${args} TO service_role`);
  }
  return out;
}

module.exports = { rpcSql };
