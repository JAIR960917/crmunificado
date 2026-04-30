#!/usr/bin/env bash
# =============================================================================
# Deploy script — CRM My Way (VPS self-hosted)
# =============================================================================
# Atualiza o repositório, sincroniza edge functions com o volume do Supabase
# e reinicia apenas o que for necessário.
#
# Uso:
#   ./deploy.sh                # deploy completo (git pull + functions + frontend)
#   ./deploy.sh --no-pull      # pula git pull (usa código local atual)
#   ./deploy.sh --functions    # apenas sincroniza edge functions e reinicia
#   ./deploy.sh --frontend     # apenas faz build do frontend
# =============================================================================

set -euo pipefail

# ----- Configuração ----------------------------------------------------------
REPO_DIR="/opt/crm"                          # repositório do código
SUPABASE_DIR="/opt/supabase"                 # stack docker-compose do Supabase
FUNCTIONS_SRC="${REPO_DIR}/supabase/functions"
FUNCTIONS_DEST="${SUPABASE_DIR}/volumes/functions"
FRONTEND_DIR="${REPO_DIR}"                   # ajuste se o frontend estiver em subpasta
GIT_BRANCH="main"

# ----- Cores -----------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # no color

log()    { echo -e "${BLUE}▶${NC} $*"; }
ok()     { echo -e "${GREEN}✔${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠${NC} $*"; }
err()    { echo -e "${RED}✖${NC} $*" >&2; }

# ----- Flags -----------------------------------------------------------------
DO_PULL=true
DO_FUNCTIONS=true
DO_FRONTEND=true

for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=false ;;
    --functions)  DO_PULL=false; DO_FUNCTIONS=true; DO_FRONTEND=false ;;
    --frontend)   DO_PULL=false; DO_FUNCTIONS=false; DO_FRONTEND=true ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) err "Argumento desconhecido: $arg"; exit 1 ;;
  esac
done

# ----- Verificações iniciais -------------------------------------------------
if [ ! -d "$REPO_DIR" ]; then
  err "Repositório não encontrado em $REPO_DIR"
  exit 1
fi

if [ ! -d "$SUPABASE_DIR" ]; then
  err "Stack Supabase não encontrado em $SUPABASE_DIR"
  exit 1
fi

cd "$REPO_DIR"

# ----- 1) Git pull -----------------------------------------------------------
if $DO_PULL; then
  log "Atualizando repositório ($REPO_DIR, branch $GIT_BRANCH)..."
  git fetch --quiet origin "$GIT_BRANCH"
  BEFORE=$(git rev-parse HEAD)
  git pull --ff-only origin "$GIT_BRANCH"
  AFTER=$(git rev-parse HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    ok "Repositório já estava atualizado ($AFTER)"
  else
    ok "Atualizado: $BEFORE → $AFTER"
    echo "Arquivos alterados:"
    git diff --name-only "$BEFORE" "$AFTER" | sed 's/^/  - /'
  fi
else
  warn "Pulando git pull (--no-pull)"
fi

# ----- 2) Sincronizar edge functions ----------------------------------------
if $DO_FUNCTIONS; then
  if [ ! -d "$FUNCTIONS_SRC" ]; then
    err "Pasta de functions não existe: $FUNCTIONS_SRC"
    exit 1
  fi

  log "Sincronizando edge functions..."
  log "  origem : $FUNCTIONS_SRC"
  log "  destino: $FUNCTIONS_DEST"

  mkdir -p "$FUNCTIONS_DEST"

  # Usa rsync se disponível (mais inteligente), senão cp -r
  if command -v rsync >/dev/null 2>&1; then
    # --delete remove no destino o que não existe na origem (mantém em sincronia)
    # Excluímos config.toml para preservar overrides locais se houver
    rsync -a --delete \
      --exclude='_shared/node_modules' \
      "$FUNCTIONS_SRC/" "$FUNCTIONS_DEST/"
  else
    cp -r "$FUNCTIONS_SRC/." "$FUNCTIONS_DEST/"
  fi
  ok "Edge functions sincronizadas"

  # Reiniciar container das functions
  log "Reiniciando container supabase-edge-functions..."
  cd "$SUPABASE_DIR"
  docker compose restart functions
  ok "Container functions reiniciado"

  # Verifica se subiu
  sleep 2
  if docker compose ps functions | grep -q "Up"; then
    ok "Container functions está UP"
  else
    err "Container functions NÃO está rodando! Verifique: docker compose logs functions --tail=100"
    exit 1
  fi

  cd "$REPO_DIR"
else
  warn "Pulando sincronização de edge functions"
fi

# ----- 3) Build do frontend --------------------------------------------------
if $DO_FRONTEND; then
  if [ -f "$FRONTEND_DIR/package.json" ]; then
    log "Build do frontend em $FRONTEND_DIR..."
    cd "$FRONTEND_DIR"

    # Detecta o gerenciador de pacotes
    if [ -f "bun.lockb" ] && command -v bun >/dev/null 2>&1; then
      log "Usando bun..."
      bun install --frozen-lockfile
      bun run build
    elif [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
      log "Usando pnpm..."
      pnpm install --frozen-lockfile
      pnpm run build
    elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
      log "Usando yarn..."
      yarn install --frozen-lockfile
      yarn build
    else
      log "Usando npm..."
      npm ci
      npm run build
    fi
    ok "Frontend buildado"

    # Se tiver caddy ou outro servidor servindo /dist, ele já pega automaticamente
    # Caso queira reiniciar caddy, descomente:
    # cd /opt/caddy && docker compose restart caddy
  else
    warn "package.json não encontrado em $FRONTEND_DIR — pulando build"
  fi
else
  warn "Pulando build do frontend"
fi

# ----- Final -----------------------------------------------------------------
echo
ok "Deploy concluído com sucesso!"
echo
echo "Comandos úteis:"
echo "  Logs functions:  cd $SUPABASE_DIR && docker compose logs functions --tail=100 -f"
echo "  Status stack:    cd $SUPABASE_DIR && docker compose ps"
echo "  Re-deploy só fn: $0 --functions"
