-- Cobrança no inbox: buscar card pelo telefone (com ou sem gatilho), inclusive em qualquer campo JSON

CREATE OR REPLACE FUNCTION public.normalize_br_phone_digits(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) >= 12 AND left(d, 2) = '55' THEN substring(d from 3)
    ELSE d
  END
  FROM (
    SELECT regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') AS d
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.cobranca_data_phone_digits(p_data jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_br_phone_digits(
    coalesce(
      nullif(trim(p_data->>'telefone'), ''),
      nullif(trim(p_data->>'celular'), ''),
      nullif(trim(p_data->>'whatsapp'), ''),
      nullif(trim(p_data->>'telefone_principal'), ''),
      ''
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.cobranca_data_matches_phone(p_data jsonb, p_last8 text, p_full text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  kv record;
  d text;
  primary_phone text;
BEGIN
  IF p_last8 IS NULL OR length(p_last8) < 8 THEN
    RETURN false;
  END IF;

  primary_phone := public.cobranca_data_phone_digits(p_data);
  IF length(primary_phone) >= 8 THEN
    IF primary_phone = p_full THEN
      RETURN true;
    END IF;
    IF right(primary_phone, 8) = p_last8 THEN
      RETURN true;
    END IF;
  END IF;

  FOR kv IN SELECT key, value FROM jsonb_each_text(coalesce(p_data, '{}'::jsonb)) LOOP
    IF kv.value IS NULL OR kv.value !~ '\d{8,}' THEN
      CONTINUE;
    END IF;
    d := public.normalize_br_phone_digits(kv.value);
    IF length(d) < 8 THEN
      CONTINUE;
    END IF;
    IF d = p_full OR right(d, 8) = p_last8 THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_last8 text;
BEGIN
  v_digits := public.normalize_br_phone_digits(p_phone);
  IF length(v_digits) < 8 THEN
    RETURN;
  END IF;
  v_last8 := right(v_digits, 8);

  RETURN QUERY
  SELECT c.id, c.data, c.status, c.valor, c.company_id
  FROM public.crm_cobrancas c
  WHERE public.cobranca_data_matches_phone(c.data, v_last8, v_digits)
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'financeiro'::app_role)
      OR has_role(auth.uid(), 'gerente'::app_role)
      OR c.assigned_to = auth.uid()
      OR c.created_by = auth.uid()
      OR public.is_same_company(c.assigned_to)
      OR public.is_same_company(c.created_by)
    )
  ORDER BY c.updated_at DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_cobranca_by_phone_system(p_phone text)
RETURNS TABLE (
  id uuid,
  data jsonb,
  status text,
  valor numeric,
  company_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_last8 text;
BEGIN
  v_digits := public.normalize_br_phone_digits(p_phone);
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
  'Inbox: localiza card de cobrança pelo telefone (gatilho ou contato espontâneo).';

COMMENT ON FUNCTION public.find_cobranca_by_phone_system(text) IS
  'Webhook/sistema: vincula conversa WhatsApp ao card de cobrança pelo telefone.';

GRANT EXECUTE ON FUNCTION public.find_cobranca_by_phone(text) TO authenticated;
REVOKE ALL ON FUNCTION public.find_cobranca_by_phone_system(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_cobranca_by_phone_system(text) TO service_role;
