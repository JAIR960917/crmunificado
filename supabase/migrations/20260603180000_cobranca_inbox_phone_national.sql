-- Inbox cobrança: busca pelo telefone nacional (sem +55) respeitando RLS do usuário

CREATE OR REPLACE FUNCTION public.normalize_br_phone_digits(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  d := regexp_replace(coalesce(p_raw, ''), '\D', '', 'g');
  WHILE length(d) > 11 AND left(d, 1) = '0' LOOP
    d := substring(d from 2);
  END LOOP;
  WHILE length(d) >= 12 AND left(d, 2) = '55' LOOP
    d := substring(d from 3);
  END LOOP;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_br_mobile_digits(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  d := public.normalize_br_phone_digits(p_raw);
  IF length(d) = 10 AND substring(d from 3 for 1) <> '9' THEN
    d := left(d, 2) || '9' || substring(d from 3);
  END IF;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.br_phones_match(p_a text, p_b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  a text;
  b text;
  variants text[];
  va text;
  vb text;
BEGIN
  variants := ARRAY[
    public.normalize_br_phone_digits(p_a),
    public.normalize_br_mobile_digits(p_a),
    public.normalize_br_phone_digits(p_b),
    public.normalize_br_mobile_digits(p_b)
  ];

  a := public.normalize_br_mobile_digits(p_a);
  b := public.normalize_br_mobile_digits(p_b);
  IF length(a) < 8 OR length(b) < 8 THEN
    RETURN false;
  END IF;
  IF a = b THEN
    RETURN true;
  END IF;
  IF right(a, 8) = right(b, 8) THEN
    RETURN true;
  END IF;
  IF length(a) >= 9 AND length(b) >= 9 AND right(a, 9) = right(b, 9) THEN
    RETURN true;
  END IF;

  FOREACH va IN ARRAY variants LOOP
    FOREACH vb IN ARRAY variants LOOP
      IF length(va) >= 8 AND length(vb) >= 8 AND right(va, 8) = right(vb, 8) THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_view_cobranca_by_id(p_cobranca_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_cobrancas c WHERE c.id = p_cobranca_id
  );
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
  SELECT c.id, c.data, c.status, c.valor, c.company_id
  FROM public.crm_cobrancas c
  WHERE public.cobranca_data_matches_phone(c.data, v_last8, v_digits)
  ORDER BY c.updated_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_cobranca_by_phone(text) IS
  'Inbox: busca card de cobrança pelo telefone nacional (sem +55). Respeita RLS do usuário.';

GRANT EXECUTE ON FUNCTION public.find_cobranca_by_phone(text) TO authenticated;
