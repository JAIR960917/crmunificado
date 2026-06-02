-- Inbox: buscar card de renovação pelo telefone (mesma lógica da cobrança)

CREATE OR REPLACE FUNCTION public.find_renovacao_by_phone(p_phone text)
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
  SELECT r.id, r.data, r.status, r.valor, r.ssotica_company_id AS company_id
  FROM public.crm_renovacoes r
  WHERE public.cobranca_data_matches_phone(r.data, v_last8, v_digits)
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'gerente'::app_role)
      OR r.assigned_to = auth.uid()
      OR r.created_by = auth.uid()
      OR public.is_same_company(r.assigned_to)
      OR public.is_same_company(r.created_by)
    )
  ORDER BY r.updated_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_renovacao_by_phone(text) IS
  'Inbox: localiza card de renovação pelo telefone do WhatsApp.';

GRANT EXECUTE ON FUNCTION public.find_renovacao_by_phone(text) TO authenticated;
