-- Expõe o id do lead batido (não só telefone/origem), para permitir excluir
-- diretamente os leads cujo telefone já está em Renovação — um lead não
-- deveria existir na tela de Leads se a pessoa já é cliente ativo em
-- Renovação.
DROP FUNCTION IF EXISTS public.campanha_copa_lookup_leads(text[]);

CREATE OR REPLACE FUNCTION public.campanha_copa_lookup_leads(p_phones text[] DEFAULT '{}')
RETURNS TABLE (lead_id uuid, phone_digits text, origem_campanha text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão (apenas administradores)';
  END IF;

  IF coalesce(array_length(p_phones, 1), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT l.id, d.phone, l.data->>'origem_campanha'
  FROM public.crm_leads l
  CROSS JOIN LATERAL (
    SELECT public.normalize_br_mobile_digits(v.value) AS phone
    FROM (
      SELECT l.data->>'telefone' AS value
      UNION ALL
      SELECT kv.value FROM jsonb_each_text(l.data) kv WHERE kv.key LIKE 'field_%'
    ) v
    WHERE v.value IS NOT NULL AND v.value <> ''
  ) d
  WHERE coalesce(l.status, '') <> 'excluidos'
    AND length(d.phone) >= 10
    AND d.phone = ANY(p_phones);
END;
$$;

COMMENT ON FUNCTION public.campanha_copa_lookup_leads(text[]) IS
  'Retorna leads (id, telefone normalizado, origem) que batem com uma lista de telefones (relatório Campanha Copa).';

REVOKE ALL ON FUNCTION public.campanha_copa_lookup_leads(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campanha_copa_lookup_leads(text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
