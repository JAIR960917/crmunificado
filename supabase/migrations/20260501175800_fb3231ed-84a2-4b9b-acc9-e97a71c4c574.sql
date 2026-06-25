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
  -- Colunas "legado"/opcionais acessadas via to_jsonb: a presença delas em
  -- auth.users varia entre versões do GoTrue self-hosted. Referência direta
  -- a uma coluna ausente quebraria a CREATE FUNCTION inteira. Só as colunas
  -- básicas (id, email, created_at etc.) são acessadas diretamente.
  SELECT u.instance_id, u.id, u.aud::text, u.role::text, u.email::text,
    u.encrypted_password,
    NULLIF(to_jsonb(u)->>'email_confirmed_at', '')::timestamptz,
    u.raw_app_meta_data, u.raw_user_meta_data,
    u.created_at, u.updated_at,
    coalesce(to_jsonb(u)->>'confirmation_token', ''),
    coalesce(to_jsonb(u)->>'recovery_token', ''),
    coalesce(to_jsonb(u)->>'email_change_token_new', ''),
    coalesce(to_jsonb(u)->>'email_change', ''),
    coalesce((to_jsonb(u)->>'is_sso_user')::boolean, false),
    coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
  FROM auth.users u;
$$;

-- auth.identities não existe em todas as versões do GoTrue self-hosted.
-- Cria a função via SQL dinâmico, só se a tabela existir, para não quebrar
-- esta migration em instalações onde ela está ausente.
DO $do$
BEGIN
  IF to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public._export_auth_identities_full()
      RETURNS TABLE(
        provider_id text, user_id uuid, identity_data jsonb, provider text,
        last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text
      )
      LANGUAGE sql SECURITY DEFINER SET search_path = public, auth
      AS $body$
        SELECT i.provider_id, i.user_id, i.identity_data, i.provider,
          i.last_sign_in_at, i.created_at, i.updated_at,
          coalesce(to_jsonb(i)->>'email', '')
        FROM auth.identities i;
      $body$;
    $sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public._export_auth_identities_full() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$do$;

REVOKE ALL ON FUNCTION public._export_auth_users_full() FROM PUBLIC, anon, authenticated;