#!/usr/bin/env bash
# ============================================================================
# CRM Joonker — Bootstrap completo de VPS Contabo (Ubuntu 22.04 ou 24.04)
# ============================================================================
# O que esse script faz, do zero, em uma VPS recém-resetada:
#   1. Atualiza pacotes e instala dependências (docker, docker compose, caddy, git, node, ufw)
#   2. Abre portas 80, 443 e 22 no UFW
#   3. Clona o repositório do CRM em /opt/crm
#   4. Cria /opt/crm/.env com chaves geradas automaticamente (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, etc.)
#   5. Configura o Caddy para crm.joonker.com.br e api.joonker.com.br (TLS automático)
#   6. Sobe todos os containers do Supabase self-hosted + frontend
#   7. Roda ./deploy.sh para aplicar migrations + edge functions + build do frontend
#   8. Imprime as chaves geradas e os próximos passos (DNS / migração de dados)
#
# USO:
#   curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/bootstrap-vps.sh -o bootstrap.sh
#   chmod +x bootstrap.sh
#   GIT_REPO=https://github.com/SEU_USUARIO/SEU_REPO.git ./bootstrap.sh
#
# Variáveis de ambiente OPCIONAIS (com defaults):
#   GIT_REPO              URL do repositório git (obrigatório se /opt/crm não existir)
#   GIT_BRANCH            Branch (default: main)
#   FRONTEND_DOMAIN       (default: crm.joonker.com.br)
#   API_DOMAIN            (default: api.joonker.com.br)
#   ADMIN_EMAIL           Email para Let's Encrypt (default: admin@joonker.com.br)
#   DASHBOARD_USERNAME    Usuário do Studio (default: admin)
#   DASHBOARD_PASSWORD    Senha do Studio (default: gerada)
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Cores e helpers
# ---------------------------------------------------------------------------
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'
log()  { echo -e "${B}[bootstrap]${N} $*"; }
ok()   { echo -e "${G}[ ok ]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
err()  { echo -e "${R}[err ]${N} $*" >&2; }

[ "$EUID" -eq 0 ] || { err "Rode como root (sudo -i)"; exit 1; }

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------
GIT_REPO="${GIT_REPO:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
PROJECT_DIR="/opt/crm"
FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-crm.joonker.com.br}"
API_DOMAIN="${API_DOMAIN:-api.joonker.com.br}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@joonker.com.br}"
DASHBOARD_USERNAME="${DASHBOARD_USERNAME:-admin}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-$(openssl rand -hex 12)}"

# ---------------------------------------------------------------------------
# Etapa 1 — pacotes do sistema
# ---------------------------------------------------------------------------
log "Atualizando sistema e instalando dependências..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release \
  git ufw openssl jq \
  debian-keyring debian-archive-keyring apt-transport-https

# Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# Caddy
if ! command -v caddy >/dev/null 2>&1; then
  log "Instalando Caddy..."
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
  systemctl enable --now caddy
fi
ok "Caddy $(caddy version | awk '{print $1}')"

# Node 20 (para scripts de migração)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  log "Instalando Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v)"

# ---------------------------------------------------------------------------
# Etapa 2 — Firewall
# ---------------------------------------------------------------------------
log "Configurando firewall (UFW)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ok "UFW liberado: 22, 80, 443"
warn "ATENÇÃO Contabo: também libere 80 e 443 no Cloud Firewall externo (painel my.contabo.com)"

# ---------------------------------------------------------------------------
# Etapa 3 — Clonar repo
# ---------------------------------------------------------------------------
if [ ! -d "$PROJECT_DIR/.git" ]; then
  if [ -z "$GIT_REPO" ]; then
    err "GIT_REPO não definido. Exemplo:"
    err "  GIT_REPO=https://github.com/SEU_USUARIO/SEU_REPO.git ./bootstrap.sh"
    exit 1
  fi
  log "Clonando $GIT_REPO em $PROJECT_DIR..."
  git clone --branch "$GIT_BRANCH" "$GIT_REPO" "$PROJECT_DIR"
else
  log "Atualizando repo em $PROJECT_DIR..."
  cd "$PROJECT_DIR"
  git fetch origin
  git checkout "$GIT_BRANCH"
  git pull --ff-only origin "$GIT_BRANCH"
fi
cd "$PROJECT_DIR"
ok "Repo em $PROJECT_DIR"

# ---------------------------------------------------------------------------
# Etapa 4 — Gerar .env (apenas se não existir)
# ---------------------------------------------------------------------------
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Gerando $ENV_FILE com chaves novas..."

  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  SECRET_KEY_BASE="$(openssl rand -hex 32)"
  PG_META_CRYPTO_KEY="$(openssl rand -hex 32)"

  # Gera ANON_KEY e SERVICE_ROLE_KEY (HS256 JWTs)
  gen_jwt() {
    local role="$1"
    local now=$(date +%s)
    local exp=$((now + 60*60*24*365*10)) # 10 anos
    local header='{"alg":"HS256","typ":"JWT"}'
    local payload="{\"role\":\"$role\",\"iss\":\"supabase\",\"iat\":$now,\"exp\":$exp}"
    local b64h b64p sig
    b64h=$(echo -n "$header"  | openssl base64 -A | tr '+/' '-_' | tr -d '=')
    b64p=$(echo -n "$payload" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
    sig=$(echo -n "$b64h.$b64p" | openssl dgst -binary -sha256 -hmac "$JWT_SECRET" \
           | openssl base64 -A | tr '+/' '-_' | tr -d '=')
    echo "$b64h.$b64p.$sig"
  }
  ANON_KEY="$(gen_jwt anon)"
  SERVICE_ROLE_KEY="$(gen_jwt service_role)"

  cat > "$ENV_FILE" <<EOF
# Gerado por bootstrap-vps.sh em $(date -Iseconds)
# Guarde este arquivo com cuidado!

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=postgres

JWT_SECRET=${JWT_SECRET}
JWT_EXP=3600

ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}

SECRET_KEY_BASE=${SECRET_KEY_BASE}
PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}

SITE_URL=https://${FRONTEND_DOMAIN}
SUPABASE_PUBLIC_URL=https://${API_DOMAIN}
SUPABASE_URL=https://${API_DOMAIN}
ADDITIONAL_REDIRECT_URLS=https://${FRONTEND_DOMAIN},https://${API_DOMAIN}

DASHBOARD_USERNAME=${DASHBOARD_USERNAME}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}

KONG_HTTP_PORT=8000
FRONTEND_PORT=8080
STORAGE_FILE_SIZE_LIMIT=52428800

# Frontend reads these to build runtime-config.js
FRONTEND_SUPABASE_URL=https://${API_DOMAIN}
FRONTEND_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}

# Edge functions
FUNCTIONS_VERIFY_JWT=true
EOF
  chmod 600 "$ENV_FILE"
  ok ".env gerado em $ENV_FILE (modo 600)"
else
  warn ".env já existe — preservando. Apague manualmente para regenerar."
fi

# Carrega .env para uso abaixo
set -a; . "$ENV_FILE"; set +a

# ---------------------------------------------------------------------------
# Etapa 5 — Caddyfile
# ---------------------------------------------------------------------------
log "Configurando Caddy..."
cat > /etc/caddy/Caddyfile <<EOF
{
  email ${ADMIN_EMAIL}
}

${FRONTEND_DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:${FRONTEND_PORT}
}

${API_DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:${KONG_HTTP_PORT}
}
EOF

caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy
ok "Caddy configurado para ${FRONTEND_DOMAIN} e ${API_DOMAIN}"

# ---------------------------------------------------------------------------
# Etapa 6 — Subir Supabase + Frontend via docker compose
# ---------------------------------------------------------------------------
log "Subindo containers (pode demorar alguns minutos no primeiro pull)..."
cd "$PROJECT_DIR"
docker compose pull
docker compose up -d --build

log "Aguardando Postgres ficar saudável..."
for i in $(seq 1 60); do
  if docker exec supabase-db pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ok "Postgres pronto"
    break
  fi
  sleep 2
  [ "$i" -eq 60 ] && { err "Postgres não ficou pronto"; exit 1; }
done

# ---------------------------------------------------------------------------
# Etapa 7 — Aplicar migrations + edge functions + frontend
# ---------------------------------------------------------------------------
log "Rodando deploy.sh (migrations + edge functions + frontend)..."
chmod +x ./deploy.sh
./deploy.sh
ok "Deploy concluído"

# ---------------------------------------------------------------------------
# Resumo final
# ---------------------------------------------------------------------------
echo
echo -e "${G}═══════════════════════════════════════════════════════════════${N}"
echo -e "${G}  ✅ Bootstrap concluído${N}"
echo -e "${G}═══════════════════════════════════════════════════════════════${N}"
echo
echo "  Frontend:    https://${FRONTEND_DOMAIN}"
echo "  API:         https://${API_DOMAIN}"
echo "  Studio:      https://${API_DOMAIN}  (basic auth)"
echo "    user:      ${DASHBOARD_USERNAME}"
echo "    pass:      ${DASHBOARD_PASSWORD}"
echo
echo "  Chaves no /opt/crm/.env (modo 600). Para ver:"
echo "    grep -E 'ANON_KEY|SERVICE_ROLE_KEY' /opt/crm/.env"
echo
echo -e "${Y}Próximos passos:${N}"
echo "  1. Confirmar DNS: ${FRONTEND_DOMAIN} e ${API_DOMAIN} → IP desta VPS"
echo "  2. Liberar portas 80/443 no Cloud Firewall da Contabo (painel)"
echo "  3. Migrar dados do Lovable Cloud:"
echo "       cd ${PROJECT_DIR}/migration-tools"
echo "       export SOURCE_URL='https://flhycgllttqeczrpmfoc.supabase.co'"
echo "       export SOURCE_SERVICE_KEY='<service_role do Lovable Cloud>'"
echo "       node 02_export_data.mjs"
echo "       docker cp data.sql supabase-db:/tmp/data.sql"
echo "       docker exec supabase-db psql -U postgres -d postgres -f /tmp/data.sql"
echo "  4. Migrar usuários:"
echo "       export TARGET_URL='https://${API_DOMAIN}'"
echo "       export TARGET_SERVICE_KEY=\$(grep '^SERVICE_ROLE_KEY=' ${PROJECT_DIR}/.env | cut -d= -f2)"
echo "       node 03_migrate_auth_users.mjs"
echo "  5. Configurar secrets das edge functions (APIFULL_API_KEY, VAPID_*, etc.)"
echo "       no Studio: https://${API_DOMAIN} → Project Settings → Edge Functions"
echo
