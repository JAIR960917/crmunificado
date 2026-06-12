-- Login compartilhado do Crediário por loja (empresa do CRM).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS crediario_email text,
  ADD COLUMN IF NOT EXISTS crediario_password text;

COMMENT ON COLUMN public.companies.crediario_email IS
  'E-mail do login único do Crediário desta loja (compartilhado pelos vendedores/gerentes).';
COMMENT ON COLUMN public.companies.crediario_password IS
  'Senha do login do Crediário desta loja. Visível apenas via RPC para o próprio usuário da empresa.';

-- Retorna credenciais do Crediário da empresa do usuário logado (sem expor senhas no SELECT geral).
CREATE OR REPLACE FUNCTION public.get_my_company_crediario_login()
RETURNS TABLE(email text, password text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  cid uuid;
BEGIN
  cid := public.get_my_company_id();
  IF cid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT c.crediario_email, c.crediario_password
    FROM public.companies c
    WHERE c.id = cid
      AND c.crediario_email IS NOT NULL
      AND btrim(c.crediario_email) <> ''
      AND c.crediario_password IS NOT NULL
      AND btrim(c.crediario_password) <> '';
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_company_crediario_login() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_company_crediario_login() TO authenticated;
