-- Lookup indexado de renovações por CPF/telefone (evita timeout no relatório Campanha Copa)

CREATE INDEX IF NOT EXISTS idx_campanha_copa_submissions_palpite
  ON public.campanha_copa_submissions (palpite_brasil, palpite_marrocos);

CREATE INDEX IF NOT EXISTS idx_campanha_copa_submissions_created_at
  ON public.campanha_copa_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_renovacoes_cpf_digits_active
  ON public.crm_renovacoes (public.campanha_copa_renovacao_cpf_digits(data))
  WHERE coalesce(status, '') <> 'excluidos'
    AND ssotica_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_renovacoes_phone_digits_active
  ON public.crm_renovacoes (
    public.normalize_br_mobile_digits(public.cobranca_data_phone_digits(data))
  )
  WHERE coalesce(status, '') <> 'excluidos'
    AND ssotica_company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.campanha_copa_lookup_renovacoes(
  p_cpfs text[] DEFAULT '{}',
  p_phones text[] DEFAULT '{}'
)
RETURNS TABLE (
  id uuid,
  status text,
  data_ultima_compra date,
  ssotica_company_id uuid,
  cpf_digits text,
  phone_digits text,
  updated_at timestamptz
)
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

  RETURN QUERY
  SELECT
    r.id,
    r.status,
    r.data_ultima_compra,
    r.ssotica_company_id,
    public.campanha_copa_renovacao_cpf_digits(r.data) AS cpf_digits,
    public.normalize_br_mobile_digits(public.cobranca_data_phone_digits(r.data)) AS phone_digits,
    r.updated_at
  FROM public.crm_renovacoes r
  WHERE coalesce(r.status, '') <> 'excluidos'
    AND r.ssotica_company_id IS NOT NULL
    AND (
      (
        coalesce(array_length(p_cpfs, 1), 0) > 0
        AND length(public.campanha_copa_renovacao_cpf_digits(r.data)) >= 11
        AND public.campanha_copa_renovacao_cpf_digits(r.data) = ANY(p_cpfs)
      )
      OR (
        coalesce(array_length(p_phones, 1), 0) > 0
        AND length(public.normalize_br_mobile_digits(public.cobranca_data_phone_digits(r.data))) >= 10
        AND public.normalize_br_mobile_digits(public.cobranca_data_phone_digits(r.data)) = ANY(p_phones)
      )
    );
END;
$$;

COMMENT ON FUNCTION public.campanha_copa_lookup_renovacoes(text[], text[]) IS
  'Busca renovações ativas por listas de CPF/telefone normalizados (relatório Campanha Copa).';

REVOKE ALL ON FUNCTION public.campanha_copa_lookup_renovacoes(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campanha_copa_lookup_renovacoes(text[], text[]) TO authenticated;
