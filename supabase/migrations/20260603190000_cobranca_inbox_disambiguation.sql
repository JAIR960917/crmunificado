-- Inbox cobrança: desambiguação quando vários cards compartilham o mesmo telefone

CREATE OR REPLACE FUNCTION public.normalize_person_name(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(regexp_replace(
    translate(coalesce(p_raw, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
    '\s+', ' ', 'g'
  )));
$$;

CREATE OR REPLACE FUNCTION public.cobranca_name_matches_hint(p_data jsonb, p_hint text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n text;
  h text;
  n_first text;
  h_first text;
BEGIN
  IF p_hint IS NULL OR trim(p_hint) = '' THEN
    RETURN false;
  END IF;

  n := public.normalize_person_name(p_data->>'nome');
  h := public.normalize_person_name(p_hint);
  IF n = '' OR h = '' THEN
    RETURN false;
  END IF;
  IF n = h THEN
    RETURN true;
  END IF;
  IF n LIKE '%' || h || '%' OR h LIKE '%' || n || '%' THEN
    RETURN true;
  END IF;

  n_first := split_part(n, ' ', 1);
  h_first := split_part(h, ' ', 1);
  IF length(n_first) >= 3 AND n_first = h_first THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.cobranca_data_exact_phone_match(p_data jsonb, p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    length(public.normalize_br_mobile_digits(p_phone)) >= 10
    AND public.normalize_br_mobile_digits(public.cobranca_data_phone_digits(p_data))
      = public.normalize_br_mobile_digits(p_phone);
$$;

CREATE OR REPLACE FUNCTION public.find_cobrancas_by_phone(
  p_phone text,
  p_contact_name text DEFAULT NULL,
  p_prefer_card_id uuid DEFAULT NULL,
  p_name_hint text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  data jsonb,
  status text,
  valor numeric,
  company_id uuid,
  match_score integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_last8 text;
BEGIN
  v_digits := public.normalize_br_mobile_digits(p_phone);
  IF length(v_digits) < 8 THEN
    RETURN;
  END IF;
  v_last8 := right(v_digits, 8);

  RETURN QUERY
  SELECT
    c.id,
    c.data,
    c.status,
    c.valor,
    c.company_id,
    (
      CASE WHEN p_prefer_card_id IS NOT NULL AND c.id = p_prefer_card_id THEN 1000 ELSE 0 END
      + CASE WHEN public.cobranca_data_exact_phone_match(c.data, v_digits) THEN 200 ELSE 0 END
      + CASE WHEN public.cobranca_name_matches_hint(c.data, p_name_hint) THEN 150 ELSE 0 END
      + CASE WHEN public.cobranca_name_matches_hint(c.data, p_contact_name) THEN 100 ELSE 0 END
      + CASE WHEN nullif(trim(c.data->>'gatilho_enviado_em'), '') IS NOT NULL THEN 25 ELSE 0 END
      + CASE WHEN public.cobranca_data_matches_phone(c.data, v_last8, v_digits) THEN 10 ELSE 0 END
    )::integer AS match_score
  FROM public.crm_cobrancas c
  WHERE public.cobranca_data_matches_phone(c.data, v_last8, v_digits)
  ORDER BY
    match_score DESC,
    nullif(trim(c.data->>'gatilho_enviado_em'), '')::timestamptz DESC NULLS LAST,
    c.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_cobranca_by_phone(p_phone text)
RETURNS TABLE (
  id uuid,
  data jsonb,
  status text,
  valor numeric,
  company_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.data, r.status, r.valor, r.company_id
  FROM public.find_cobrancas_by_phone(p_phone) r
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_cobrancas_by_phone(text, text, uuid, text) IS
  'Inbox: lista cards de cobrança pelo telefone com score (nome, vínculo, telefone exato).';

GRANT EXECUTE ON FUNCTION public.find_cobrancas_by_phone(text, text, uuid, text) TO authenticated;
