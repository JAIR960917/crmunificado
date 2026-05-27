#!/usr/bin/env bash
# ============================================================================
# Adicionar site estático ao Caddy na mesma VPS do CRM
# ============================================================================
# Uso: rode como root na VPS
#   sudo bash add-static-site.sh selecao.joonker.com.br
#
# Ou edite a variável DOMAIN abaixo e rode direto:
#   sudo bash add-static-site.sh
# ============================================================================

set -euo pipefail

DOMAIN="${1:-selecao.joonker.com.br}"
SITE_DIR="/opt/selecao"
CADDYFILE="/etc/caddy/Caddyfile"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()  { echo -e "${G}[ok ]${N} $*"; }
warn(){ echo -e "${Y}[warn]${N} $*"; }
err() { echo -e "${R}[err ]${N} $*" >&2; }

[ "$EUID" -eq 0 ] || { err "Rode como root (sudo -i)"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Criar diretório do site
# ---------------------------------------------------------------------------
mkdir -p "${SITE_DIR}"
chmod 755 "${SITE_DIR}"
# Garante que o Caddy consiga ler o diretório
chown -R root:root "${SITE_DIR}" 2>/dev/null || true
ok "Diretório criado: ${SITE_DIR}"

# ---------------------------------------------------------------------------
# 2. Criar HTML de placeholder (evita erro 404 antes do upload)
# ---------------------------------------------------------------------------
cat > "${SITE_DIR}/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Em breve</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    text-align: center;
  }
  h1 { font-size: 2.5rem; margin-bottom: 1rem; }
  p  { color: #94a3b8; font-size: 1.1rem; }
</style>
</head>
<body>
  <div>
    <h1>🚀 Em breve</h1>
    <p>O site está sendo configurado. Substitua os arquivos em<br><code>/opt/selecao</code></p>
  </div>
</body>
</html>
EOF
ok "Placeholder index.html criado"

# ---------------------------------------------------------------------------
# 3. Adicionar bloco no Caddyfile (se ainda não existir)
# ---------------------------------------------------------------------------
if grep -qF "${DOMAIN}" "${CADDYFILE}"; then
  warn "Bloco '${DOMAIN}' já existe no Caddyfile — pulando"
else
  cat >> "${CADDYFILE}" <<EOF

${DOMAIN} {
  encode gzip
  root * ${SITE_DIR}
  file_server
  try_files {path} /index.html
}
EOF
  ok "Bloco adicionado ao Caddyfile"
fi

# ---------------------------------------------------------------------------
# 4. Validar e recarregar Caddy
# ---------------------------------------------------------------------------
caddy validate --config "${CADDYFILE}" >/dev/null
systemctl reload caddy
ok "Caddy recarregado — TLS automático ativado"

# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------
echo
echo -e "${G}═══════════════════════════════════════════════════════════════${N}"
echo -e "${G}  ✅ Site ${DOMAIN} configurado${N}"
echo -e "${G}═══════════════════════════════════════════════════════════════${N}"
echo
echo "  Diretório:   ${SITE_DIR}"
echo "  Acesse:      https://${DOMAIN}"
echo
echo -e "${Y}Próximo passo:${N}"
echo "  Suba seus arquivos (HTML, CSS, vídeos, fotos) para:"
echo "    ${SITE_DIR}"
echo
echo "  Upload via SCP (do seu computador):"
echo "    scp -r ./meus-arquivos/* root@SEU_IP:${SITE_DIR}/"
echo
echo "  Ou edite direto na VPS:"
echo "    nano ${SITE_DIR}/index.html"
echo
