-- Função auxiliar para exportar dados completos de auth.users e auth.identities para migração
CREATE OR REPLACE FUNCTION public._export_auth_users_full()
RETURNS TABLE(
  instance_id uuid, id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text,
  email_change_token_new text, email_change text,
  is_sso_user boolean, is_anonymous boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT u.instance_id, u.id, u.aud::text, u.role::text, u.email::text,
    u.encrypted_password, u.email_confirmed_at,
    u.raw_app_meta_data, u.raw_user_meta_data,
    u.created_at, u.updated_at,
    coalesce(u.confirmation_token,''), coalesce(u.recovery_token,''),
    coalesce(u.email_change_token_new,''), coalesce(u.email_change,''),
    coalesce(u.is_sso_user,false), coalesce(u.is_anonymous,false)
  FROM auth.users u;
$$;

CREATE OR REPLACE FUNCTION public._export_auth_identities_full()
RETURNS TABLE(
  provider_id text, user_id uuid, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT i.provider_id, i.user_id, i.identity_data, i.provider,
    i.last_sign_in_at, i.created_at, i.updated_at, coalesce(i.email,'')
  FROM auth.identities i;
$$;

REVOKE ALL ON FUNCTION public._export_auth_users_full() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._export_auth_identities_full() FROM PUBLIC, anon, authenticated;