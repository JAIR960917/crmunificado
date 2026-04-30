CREATE OR REPLACE FUNCTION public._export_auth_users_temp()
RETURNS TABLE(
  id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT 
    u.id, u.email::text, u.encrypted_password::text, NULLIF(to_jsonb(u)->>'email_confirmed_at', '')::timestamptz,
    u.raw_user_meta_data, u.raw_app_meta_data,
    u.created_at, u.updated_at,
    NULLIF(to_jsonb(u)->>'phone', '')::text,
    NULLIF(to_jsonb(u)->>'phone_confirmed_at', '')::timestamptz,
    NULLIF(to_jsonb(u)->>'last_sign_in_at', '')::timestamptz
  FROM auth.users u
  WHERE public.has_role(auth.uid(), 'admin'::app_role) OR auth.uid() IS NULL;
$$;

REVOKE ALL ON FUNCTION public._export_auth_users_temp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._export_auth_users_temp() TO service_role;