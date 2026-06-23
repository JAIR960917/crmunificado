-- Usado pelo envio de inscrições da Campanha Copa para Leads: antes de criar
-- um card novo, verifica se já existe ALGUM lead (de qualquer origem) com o
-- mesmo telefone, comparando pelos últimos 8 dígitos (cobre diferenças de
-- formatação/DDI entre o campo "telefone" e campos dinâmicos do formulário).
CREATE OR REPLACE FUNCTION public.find_lead_by_phone_suffix(p_phone_suffix text)
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, COALESCE(l.data->>'nome_lead', l.data->>'nome', 'Lead') AS nome
  FROM crm_leads l
  WHERE l.status <> 'excluidos'
    AND length(p_phone_suffix) >= 8
    AND (
      regexp_replace(COALESCE(l.data->>'telefone', ''), '\D', '', 'g') LIKE '%' || p_phone_suffix
      OR EXISTS (
        SELECT 1 FROM jsonb_each_text(l.data) kv
        WHERE kv.key LIKE 'field_%'
          AND regexp_replace(kv.value, '\D', '', 'g') LIKE '%' || p_phone_suffix
      )
    )
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

NOTIFY pgrst, 'reload schema';
