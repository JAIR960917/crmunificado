-- =========================================================================
-- SECURITY HARDENING
-- =========================================================================

-- 1) companies: restringir SELECT à empresa do usuário
DROP POLICY IF EXISTS "All authenticated can view companies" ON public.companies;

CREATE POLICY "Scoped company visibility"
ON public.companies
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_my_company(id)
);

-- 2) user_roles: impedir gerentes de gravar role_key arbitrário
DROP POLICY IF EXISTS "Gerentes can update to vendedor only" ON public.user_roles;

CREATE POLICY "Gerentes can update to vendedor only"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'gerente'::app_role)
  AND role = 'vendedor'::app_role
)
WITH CHECK (
  public.has_role(auth.uid(), 'gerente'::app_role)
  AND role = 'vendedor'::app_role
  AND (role_key IS NULL OR role_key = 'vendedor')
);

-- 3) Realtime: bloquear inscrições não autorizadas em canais
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can subscribe to own scoped topics" ON realtime.messages;

-- Bloqueia tudo por padrão. Quem precisa de realtime escuta via REST/polling
-- ou cria políticas específicas por tópico depois.
CREATE POLICY "Block realtime by default for authenticated"
ON realtime.messages
FOR SELECT
TO authenticated
USING (false);

-- 4) Revogar EXECUTE público de funções SECURITY DEFINER administrativas
REVOKE EXECUTE ON FUNCTION public.delete_all_leads_cascade() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_duplicate_leads(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_decrypt_license(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_ssotica_credentials(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_secret(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_secret(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._get_encryption_key() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._export_auth_users_full() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._export_auth_identities_full() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._export_auth_password_hashes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reclassify_cobrancas_by_situacao() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.manage_whatsapp_cron() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.manage_ssotica_cron() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_names() FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_lead_by_phone(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_lead(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.soft_delete_renovacao(uuid) FROM anon;