-- ==========================================================
-- M-8: Desacoplar chave de criptografia SSótica do jwt_secret
-- ==========================================================
-- Estratégia: calcular o valor atual da chave derivada em tempo de execução
-- da migration e persistir como setting independente. Todos os tokens enc:
-- existentes continuam válidos porque o VALOR da chave não muda, apenas
-- o LUGAR onde ela é armazenada. Rotações futuras de jwt_secret não afetarão
-- mais as integrações SSótica.
-- ==========================================================

DO $$
DECLARE
  _current_key text;
  _db          text;
BEGIN
  -- Calcula exatamente o mesmo valor que _get_encryption_key() retorna hoje
  _current_key := encode(
    extensions.digest(
      'ssotica_token_key_' || coalesce(current_setting('app.settings.jwt_secret', true), 'fallback_salt'),
      'sha256'
    ),
    'hex'
  );

  _db := current_database();

  -- Persiste como setting de banco independente
  EXECUTE format(
    'ALTER DATABASE %I SET "app.settings.ssotica_encryption_key" TO %L',
    _db,
    _current_key
  );
END;
$$;

-- Atualiza a função para usar o novo setting independente.
-- Mantém fallback para a derivação antiga caso o setting ainda não esteja
-- visível na sessão atual (ex.: primeiros requests após deploy sem reload).
CREATE OR REPLACE FUNCTION public._get_encryption_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.settings.ssotica_encryption_key', true), ''),
    encode(
      extensions.digest(
        'ssotica_token_key_' || coalesce(current_setting('app.settings.jwt_secret', true), 'fallback_salt'),
        'sha256'
      ),
      'hex'
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public._get_encryption_key() FROM PUBLIC, anon, authenticated;
