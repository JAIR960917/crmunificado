#!/usr/bin/env bash
# ============================================================================
# Deploy script para CRM self-hosted na VPS
# Uso:
#   ./deploy.sh                 -> deploy completo (migrations + functions + frontend)
#   ./deploy.sh --functions     -> só edge functions
#   ./deploy.sh --migrations    -> só migrations do banco
#   ./deploy.sh --frontend      -> só build + restart do frontend
#   ./deploy.sh --restart       -> restart dos serviços supabase
# ============================================================================

set -euo pipefail

PROJECT_DIR="/opt/crm"
SUPABASE_DIR="${PROJECT_DIR}/supabase"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
DB_USER="${SUPABASE_DB_USER:-postgres}"

# Cores
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'

log()  { echo -e "${B}[deploy]${N} $*"; }
ok()   { echo -e "${G}[ ok ]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
err()  { echo -e "${R}[err ]${N} $*"; }

cd "$PROJECT_DIR"

# Carrega variáveis de ambiente do arquivo .env local da VPS.
# Isso garante que deploy.sh enxergue ANON_KEY/SUPABASE_URL etc. sem precisar export manual.
if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${PROJECT_DIR}/.env"
  set +a
fi

MODE="${1:-all}"

persist_backend_runtime_settings_vps() {
  local app_supabase_url="${SUPABASE_PUBLIC_URL:-${SUPABASE_URL:-}}"
  local app_supabase_anon="${SUPABASE_ANON_KEY:-${ANON_KEY:-}}"

  [ -n "${app_supabase_url}" ] && [ -n "${app_supabase_anon}" ] || return 0
  docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$" || return 1

  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('backend_public_url', '${app_supabase_url}')
ON CONFLICT (setting_key)
DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('backend_anon_key', '${app_supabase_anon}')
ON CONFLICT (setting_key)
DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

DO $$
BEGIN
  IF to_regprocedure('public.manage_ssotica_cron()') IS NOT NULL THEN
    PERFORM public.manage_ssotica_cron();
  END IF;
END $$;
SQL
}

# ---------------------------------------------------------------------------
# Migrations (aplica os .sql novos no Postgres do Supabase self-hosted)
# ---------------------------------------------------------------------------
run_migrations() {
  log "Aplicando migrations..."
  local use_docker_fallback=0

  repair_auth_internal_privileges() {
    log "Reparando privilégios internos do schema auth para o stack self-hosted..."

    db_exec "GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role, supabase_auth_admin;"
    db_exec "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO postgres, supabase_auth_admin;"
    db_exec "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO postgres, supabase_auth_admin;"
    db_exec "GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA auth TO postgres, supabase_auth_admin;"
    db_exec "GRANT EXECUTE ON ALL ROUTINES IN SCHEMA auth TO anon, authenticated, service_role;"
    db_exec "ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres, supabase_auth_admin;"
    db_exec "ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres, supabase_auth_admin;"
    db_exec "ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON ROUTINES TO postgres, supabase_auth_admin;"
    db_exec "ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT EXECUTE ON ROUTINES TO anon, authenticated, service_role;"

    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth'
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO supabase_auth_admin', r.nspname, r.proname, r.args);
  END LOOP;
END $$;
SQL
    else
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth'
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO supabase_auth_admin', r.nspname, r.proname, r.args);
  END LOOP;
END $$;
SQL
    fi

    ok "Privilégios do auth reparados"
  }

  # Por padrão usamos o container do Postgres (mais confiável em self-hosted
  # com Supavisor/pooler na porta 5432). Para forçar conexão direta via psql,
  # exporte USE_PSQL_DIRECT=1 e SUPABASE_DB_URL apontando para o Postgres real.
  if [ "${USE_PSQL_DIRECT:-0}" = "1" ] && command -v psql >/dev/null 2>&1 && [ -n "${SUPABASE_DB_URL:-}" ]; then
    if psql "$SUPABASE_DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
      ok "Conexão direta com o banco OK via SUPABASE_DB_URL"
    else
      warn "SUPABASE_DB_URL inválida; usando fallback via container ${DB_CONTAINER}..."
      use_docker_fallback=1
    fi
  else
    log "Usando container ${DB_CONTAINER} para aplicar migrations (modo padrão self-hosted)"
    use_docker_fallback=1
  fi

  if [ "$use_docker_fallback" -eq 1 ] && ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    err "Container ${DB_CONTAINER} não está rodando. Defina SUPABASE_DB_URL válida ou ajuste SUPABASE_DB_CONTAINER."
    return 1
  fi

  db_exec() {
    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null
    else
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "$1" >/dev/null
    fi
  }

  db_query() {
    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc "$1"
    else
      psql "$SUPABASE_DB_URL" -tAc "$1"
    fi
  }

  db_file() {
    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 >/dev/null < "$1"
    else
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$1" >/dev/null
    fi
  }

  local applied_table="public._lovable_migrations"

  # Persistimos configurações usadas por algumas migrations/functions no banco.
  # Em self-hosted, os crons do pg_net precisam da URL pública da VPS (não da URL
  # interna do Kong dentro do Docker) para chamar as edge functions corretamente.
  local app_supabase_url="${SUPABASE_PUBLIC_URL:-${SUPABASE_URL:-}}"
  local app_supabase_anon="${SUPABASE_ANON_KEY:-${ANON_KEY:-}}"
  if [ -n "${app_supabase_url}" ] && [ -n "${app_supabase_anon}" ]; then
    if ! db_exec "ALTER DATABASE postgres SET \"app.settings.supabase_url\" = '${app_supabase_url}';"; then
      warn "Sem permissão para definir app.settings.supabase_url via ALTER DATABASE (continuando)."
    fi
    if ! db_exec "ALTER DATABASE postgres SET \"app.settings.supabase_anon_key\" = '${app_supabase_anon}';"; then
      warn "Sem permissão para definir app.settings.supabase_anon_key via ALTER DATABASE (continuando)."
    fi

    # Fallback persistente em system_settings para ambientes onde ALTER DATABASE
    # não é permitido ou não sobrevive ao restore. A migration nova lê estes
    # valores antes de usar current_setting(...).
    db_exec "
      CREATE TABLE IF NOT EXISTS public.system_settings (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        setting_key text UNIQUE NOT NULL,
        setting_value text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    " || true
    db_exec "
      INSERT INTO public.system_settings (setting_key, setting_value)
      VALUES ('backend_public_url', '${app_supabase_url}')
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();
    " || warn "Não foi possível gravar backend_public_url em system_settings (continuando)."
    db_exec "
      INSERT INTO public.system_settings (setting_key, setting_value)
      VALUES ('backend_anon_key', '${app_supabase_anon}')
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();
    " || warn "Não foi possível gravar backend_anon_key em system_settings (continuando)."
  fi

  db_exec "
    CREATE TABLE IF NOT EXISTS ${applied_table} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );" >/dev/null

  local legacy_roles_migration="20260404203047_c1d21d17-0fa1-47f1-81ae-0e60edc81ca0.sql"
  local legacy_roles_bootstrapped
  legacy_roles_bootstrapped=$(db_query "
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'app_role'
      )
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'crm_columns')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'crm_leads')
    THEN 1 ELSE 0 END;
  ")
  if [ "${legacy_roles_bootstrapped}" = "1" ]; then
    db_exec "INSERT INTO ${applied_table}(filename) VALUES ('${legacy_roles_migration}') ON CONFLICT (filename) DO NOTHING;"
  fi

  repair_auth_internal_privileges

  local count=0
  for f in "${SUPABASE_DIR}/migrations/"*.sql; do
    [ -e "$f" ] || continue
    local name; name="$(basename "$f")"
    local already
    already=$(db_query "SELECT 1 FROM ${applied_table} WHERE filename = '${name}'")
    if [ "$already" = "1" ]; then
      continue
    fi
    log "  -> $name"
    db_file "$f"
    db_exec "INSERT INTO ${applied_table}(filename) VALUES ('${name}')"
    count=$((count+1))
  done

  if ! db_exec "SELECT public.manage_ssotica_cron();"; then
    warn "Não foi possível reagendar os crons da SSÓtica automaticamente (verifique as configs backend_public_url/backend_anon_key)."
  fi

  ok "Migrations aplicadas: $count"
}

# ---------------------------------------------------------------------------
# Edge functions (copia para o container e reinicia o edge-runtime)
# ---------------------------------------------------------------------------
run_functions() {
  log "Sincronizando edge functions..."
  local container="supabase-edge-functions"

  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    err "Container ${container} não está rodando."
    return 1
  fi

  # /home/deno/functions é o diretório padrão usado pela imagem oficial
  docker cp "${SUPABASE_DIR}/functions/." "${container}:/home/deno/functions/"
  ok "Functions copiadas"

  log "Reiniciando ${container}..."
  docker restart "${container}" >/dev/null
  ok "Edge functions reiniciadas"

  if persist_backend_runtime_settings_vps; then
    ok "Configs da SSÓtica e crons reaplicados no banco"
  else
    warn "Não foi possível reaplicar configs/crons da SSÓtica automaticamente no banco"
  fi
}

# ---------------------------------------------------------------------------
# Frontend (build + restart do container que serve o app)
# ---------------------------------------------------------------------------
run_frontend() {
  local runtime_config_path="${PROJECT_DIR}/public/runtime-config.js"
  # Por padrão o frontend aponta para o backend self-hosted desta VPS,
  # usando SUPABASE_PUBLIC_URL/ANON_KEY do .env. Para forçar Lovable Cloud
  # ou outro backend, defina FRONTEND_SUPABASE_URL/FRONTEND_SUPABASE_PUBLISHABLE_KEY no .env.
  local frontend_backend_url="${FRONTEND_SUPABASE_URL:-${SUPABASE_PUBLIC_URL:-${SUPABASE_URL:-}}}"
  local frontend_publishable_key="${FRONTEND_SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-${ANON_KEY:-}}}"

  if [ -z "$frontend_backend_url" ] || [ -z "$frontend_publishable_key" ]; then
    err "Defina SUPABASE_PUBLIC_URL e ANON_KEY (ou FRONTEND_SUPABASE_URL/FRONTEND_SUPABASE_PUBLISHABLE_KEY) no .env antes do build do frontend."
    return 1
  fi

  log "Gravando config runtime do frontend para ${frontend_backend_url}..."
  cat > "$runtime_config_path" <<EOF
window.__CRM_RUNTIME_CONFIG__ = {
  supabaseUrl: "${frontend_backend_url}",
  supabasePublishableKey: "${frontend_publishable_key}"
};
EOF

  # Preferimos rebuild via docker compose: garante que dist/ + nginx.conf + runtime-config.js
  # estejam consistentes dentro da imagem do container crm-frontend.
  if [ "${FRONTEND_BUILD_MODE:-docker}" = "docker" ] && command -v docker >/dev/null 2>&1; then
    log "Rebuild do frontend via docker compose (modo docker)..."
    docker compose build crm-frontend
    docker compose up -d --force-recreate crm-frontend
    ok "Frontend rebuildado e reiniciado via docker compose"
    return 0
  fi

  log "Instalando dependências (modo local)..."
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
    log "Build do frontend (bun)..."
    bun run build
  elif command -v npm >/dev/null 2>&1; then
    npm ci
    log "Build do frontend (npm)..."
    npm run build
  else
    err "Nem bun/npm/docker disponíveis para build do frontend."
    return 1
  fi
  ok "Build concluído em ./dist"

  if docker ps --format '{{.Names}}' | grep -q "^crm-frontend$"; then
    log "Restart do container crm-frontend..."
    docker restart crm-frontend >/dev/null
    ok "Frontend reiniciado"
  else
    warn "Nenhum container 'crm-frontend' encontrado — pulei restart."
  fi
}

# ---------------------------------------------------------------------------
# Restart geral (auth, rest, edge, realtime)
# ---------------------------------------------------------------------------
run_restart() {
  log "Recriando serviços supabase para reaplicar variáveis do .env..."
  docker compose up -d --force-recreate \
    supabase-kong \
    supabase-auth \
    supabase-rest \
    supabase-realtime \
    supabase-storage \
    supabase-meta \
    supabase-edge-functions \
    supabase-studio
  ok "Serviços do backend recriados com as credenciais atuais do .env"
}

case "$MODE" in
  --functions)   run_functions ;;
  --migrations)  run_migrations ;;
  --frontend)    run_frontend ;;
  --restart)     run_restart ;;
  all|"")
    run_migrations
    run_functions
    run_frontend
    ;;
  *)
    err "Modo desconhecido: $MODE"
    echo "Uso: $0 [--functions|--migrations|--frontend|--restart]"
    exit 1
    ;;
esac

ok "Deploy finalizado."
