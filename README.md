# CRM MyWay

**Versão: 1.0.2**

Sistema CRM brasileiro com Kanban, automação de WhatsApp e PWA.

## Self-host na VPS (Front + Backend + Postgres)

Este projeto usa **Supabase self-hosted** como backend (Auth/REST/Realtime/Storage/Edge Functions) e **PostgreSQL** como banco.

### Subir tudo via Docker Compose

1. Copie `.env.vps.example` para `.env` e preencha as chaves:
   - `POSTGRES_PASSWORD`
   - `JWT_SECRET`
   - `ANON_KEY`
   - `SERVICE_ROLE_KEY`
   - `SECRET_KEY_BASE`
   - `PG_META_CRYPTO_KEY`
   - Ajuste `SITE_URL` (URL do frontend) e `SUPABASE_PUBLIC_URL` (URL pública do Supabase)
   - Preencha `ADDITIONAL_REDIRECT_URLS` com seus domínios (para redirects do Auth)

2. Suba os serviços:

```bash
docker compose up -d
```

3. Aplique as migrations e sincronize as edge functions (na VPS, seguindo o padrão `/opt/crm` do script):

```bash
./deploy.sh
```

### URLs (padrão)

- **Frontend**: `https://crm.joonker.com.br` (internamente o container escuta em `:8080`)
- **Supabase API**: `https://api.joonker.com.br` (internamente o Kong escuta em `:8000`)
- **Supabase Studio**: acessível via Kong em `/` (protegido por basic auth no `.env`)

### Importante

- O frontend lê `public/runtime-config.js`. No deploy, o `deploy.sh` grava esse arquivo para apontar o app para o Supabase da VPS.
- O client do Supabase (`src/integrations/supabase/client.ts`) já suporta **runtime-config.js**, então você não precisa rebuildar o frontend só para mudar a URL do backend.

### Reverse proxy (TLS)

Configure seu proxy para apontar:
- `crm.joonker.com.br` → `http://127.0.0.1:8080`
- `api.joonker.com.br` → `http://127.0.0.1:8000`

## Changelog

### Próximo: WhatsApp Cloud API (Meta)
- Guia de submissão: [docs/META_APP_REVIEW.md](docs/META_APP_REVIEW.md)
- Painel **WhatsApp → API Meta**, webhook, envio híbrido API Full / Meta
- URLs públicas: `/privacidade`, `/termos`, `/exclusao-dados`

### v1.0.2
- Implementado suporte a múltiplas instâncias WhatsApp
  - Nova tabela `whatsapp_instances` com controle por empresa
  - Campanhas e campanhas de gatilho agora vinculadas a instâncias específicas
  - Gerenciamento de instâncias via API Full (criar, resetar, reiniciar, QR Code, status)
  - Permissões RLS: admins acesso total, gerentes gerenciam instâncias da própria empresa

### v1.0.1
- Configuração inicial do CRM com Kanban, leads, formulários dinâmicos
- Integração WhatsApp via API Full
- Sistema de campanhas e campanhas por gatilho
- Notificações push (PWA)
- Gestão de usuários com roles (admin, vendedor, gerente)
