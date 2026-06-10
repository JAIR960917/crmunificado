#!/usr/bin/env bash
# ============================================================================
# Mescla conversas WhatsApp duplicadas (gatilho enviado + resposta em thread nova).
#
# Uso na VPS:
#   ./scripts/merge-whatsapp-duplicates.sh           # simula (dry-run)
#   ./scripts/merge-whatsapp-duplicates.sh --apply   # aplica mesclagem
#
# Requer: migration 20260611140000_merge_whatsapp_duplicate_conversations.sql
# ============================================================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/crm}"
DB_CONTAINER="${SUPABASE_DB_CONTAINER:-supabase-db}"
DB_USER="${SUPABASE_DB_USER:-postgres}"

G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; R='\033[0;31m'; N='\033[0m'
log() { echo -e "${B}[merge-whatsapp]${N} $*"; }
ok()  { echo -e "${G}[ ok ]${N} $*"; }
warn(){ echo -e "${Y}[warn]${N} $*"; }
err() { echo -e "${R}[err ]${N} $*"; }

APPLY=false
if [ "${1:-}" = "--apply" ]; then
  APPLY=true
fi

cd "$PROJECT_DIR"

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  err "Container ${DB_CONTAINER} não está rodando."
  exit 1
fi

if ! docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_proc WHERE proname = 'merge_duplicate_whatsapp_conversations'" | grep -q 1; then
  err "Função merge_duplicate_whatsapp_conversations não encontrada."
  err "Rode antes: ./deploy.sh --migrations"
  exit 1
fi

DRY_SQL="true"
if [ "$APPLY" = true ]; then
  DRY_SQL="false"
  warn "Modo APPLY — conversas duplicadas serão mescladas de verdade."
else
  log "Modo dry-run (simulação). Use --apply para mesclar."
fi

log "Buscando pares duplicados..."

OUTPUT=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -P pager=off <<SQL
\x off
SELECT
  iteration,
  keeper_contact,
  duplicate_contact,
  keeper_wa_id,
  duplicate_wa_id,
  messages_moved,
  applied
FROM public.merge_duplicate_whatsapp_conversations(${DRY_SQL}::boolean, 50);
SQL
)

echo "$OUTPUT"

PAIR_COUNT=$(echo "$OUTPUT" | grep -E '^\s+[0-9]+\s+\|' | wc -l | tr -d ' ' || true)

if [ "${PAIR_COUNT:-0}" = "0" ]; then
  ok "Nenhum par duplicado encontrado para mesclar."
  exit 0
fi

if [ "$APPLY" = true ]; then
  ok "Mesclagem concluída: ${PAIR_COUNT} par(es) processado(s)."
else
  ok "Simulação concluída: ${PAIR_COUNT} par(es) seriam mesclados."
  echo ""
  echo "Para aplicar: ./scripts/merge-whatsapp-duplicates.sh --apply"
fi
