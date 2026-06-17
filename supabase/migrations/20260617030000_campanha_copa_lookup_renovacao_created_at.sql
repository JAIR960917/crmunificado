-- ============================================================
-- Adiciona created_at (data de criacao do registro de renovacao) ao lookup
-- usado pelo relatorio da Campanha Copa.
--
-- Problema: o relatorio classificava "ja era cliente" vs "nunca tinha
-- comprado" usando o status ATUAL de renovacao (sim/nao), avaliado no
-- momento em que o relatorio e gerado. Como um prospect que compra apos a
-- campanha passa a ter um registro em crm_renovacoes (status "sim") assim
-- que o sync roda, ele "desaparecia" da contagem de prospects convertidos
-- mesmo sendo exatamente o caso que deveria ser contado ali.
--
-- Com created_at do registro de renovacao, o frontend pode comparar com a
-- data de inscricao na campanha: se a renovacao foi criada DEPOIS da
-- inscricao, o cliente nao existia antes (prospect que converteu). Se foi
-- criada ANTES, ja era cliente.
-- ============================================================

DROP FUNCTION IF EXISTS public.campanha_copa_lookup_renovacoes(text[], text[]);

CREATE FUNCTION public.campanha_copa_lookup_renovacoes(
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
  updated_at timestamptz,
  created_at timestamptz
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
    r.updated_at,
    r.created_at
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
