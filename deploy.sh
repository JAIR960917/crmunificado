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

# Cores
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'

log()  { echo -e "${B}[deploy]${N} $*"; }
ok()   { echo -e "${G}[ ok ]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
err()  { echo -e "${R}[err ]${N} $*"; }

cd "$PROJECT_DIR"

MODE="${1:-all}"

# ---------------------------------------------------------------------------
# Migrations (aplica os .sql novos no Postgres do Supabase self-hosted)
# ---------------------------------------------------------------------------
run_migrations() {
  log "Aplicando migrations..."
  local use_docker_fallback=0

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
      docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null
    else
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "$1" >/dev/null
    fi
  }

  db_query() {
    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tAc "$1"
    else
      psql "$SUPABASE_DB_URL" -tAc "$1"
    fi
  }

  db_file() {
    if [ "$use_docker_fallback" -eq 1 ]; then
      docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null < "$1"
    else
      psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$1" >/dev/null
    fi
  }

  local applied_table="public._lovable_migrations"
  db_exec "
    CREATE TABLE IF NOT EXISTS ${applied_table} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );" >/dev/null

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
}

# ---------------------------------------------------------------------------
# Frontend (build + restart do container que serve o app)
# ---------------------------------------------------------------------------
run_frontend() {
  log "Instalando dependências..."
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
    log "Build do frontend (bun)..."
    bun run build
  else
    npm ci
    log "Build do frontend (npm)..."
    npm run build
  fi
  ok "Build concluído em ./dist"

  # Se houver container nginx servindo o app, recarrega
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
  log "Reiniciando serviços supabase..."
  for c in supabase-edge-functions supabase-rest supabase-auth supabase-realtime; do
    if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
      docker restart "$c" >/dev/null && ok "  $c"
    fi
  done
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
