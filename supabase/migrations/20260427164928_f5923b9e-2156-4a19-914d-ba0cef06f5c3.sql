-- Revoga EXECUTE público (PUBLIC e anon) de todas as funções SECURITY DEFINER do schema public.
-- Mantém authenticated apenas para funções usadas pela aplicação cliente.
-- Funções administrativas/utilitárias ficam restritas a service_role.

-- 1) Funções usadas pelo cliente autenticado (mantém authenticated)
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_same_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_user_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_profile_names() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_renovacao(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_same_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_user_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_names() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_renovacao(uuid) TO authenticated;

-- 2) Funções administrativas (somente service_role / postgres / triggers internos)
REVOKE ALL ON FUNCTION public.admin_decrypt_license(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_all_leads_cascade() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_ssotica_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_whatsapp_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- admin_decrypt_license e delete_all_leads_cascade já checam has_role(admin) internamente.
-- Precisam ser executáveis pelo cliente autenticado para o admin chamá-las via RPC.
GRANT EXECUTE ON FUNCTION public.admin_decrypt_license(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_all_leads_cascade() TO authenticated;

-- manage_ssotica_cron e manage_whatsapp_cron são chamadas por edge functions (service_role) ou via SQL admin.
-- ssotica_enqueue_sync usa pg_net e só deve rodar via cron/edge.
GRANT EXECUTE ON FUNCTION public.manage_ssotica_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.manage_whatsapp_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) TO service_role;

-- 3) Funções trigger / internas (não devem ser chamáveis por nenhum cliente)
REVOKE ALL ON FUNCTION public._encrypt_ssotica_secrets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at_renovacao_activities() FROM PUBLIC, anon, authenticated;