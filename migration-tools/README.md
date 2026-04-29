# Migração Lovable Cloud → Supabase Self-Hosted

Pacote completo para migrar o CRM do Lovable Cloud (origem) para o seu Supabase self-hosted (`api.joonker.com.br`).

## 📋 Visão geral

```
┌─────────────────┐         ┌─────────────────┐
│  Lovable Cloud  │ ──────► │  Self-Hosted    │
│  (origem)       │         │  api.joonker... │
│  ~34k linhas    │         │                 │
│  57 usuários    │         │                 │
│  3 buckets      │         │                 │
└─────────────────┘         └─────────────────┘
```

**Etapas:**
1. Aplicar schema (140 migrations consolidadas)
2. Exportar dados via REST do PostgREST
3. Importar dados no self-hosted
4. Migrar usuários do auth (sem senhas — usuários resetam)
5. Recriar buckets de Storage
6. Trocar o client do app

---

## 🔑 Pré-requisitos na VPS

```bash
# Node.js 18+ (já vem com fetch nativo)
node --version  # deve ser >= 18

# Acesso ao container do Postgres self-hosted
docker exec supabase-db psql -U postgres -c "SELECT 1"

# Pasta de trabalho
mkdir -p /opt/migration && cd /opt/migration
```

## 🔐 Pegar as chaves necessárias

Você precisa de **4 chaves** antes de começar:

### Da origem (Lovable Cloud)
1. **`SOURCE_URL`** = `https://flhycgllttqeczrpmfoc.supabase.co`
2. **`SOURCE_SERVICE_KEY`** = service role do Lovable Cloud
   - No Lovable: **Cloud → Secrets → SUPABASE_SERVICE_ROLE_KEY** (clique pra revelar)

### Do destino (self-hosted)
3. **`TARGET_URL`** = `https://api.joonker.com.br` (ou onde está seu Supabase)
4. **`TARGET_SERVICE_KEY`** = service_role do self-hosted
   - Está no `docker-compose.yml` ou `.env` do seu Supabase self-hosted

---

## 📦 Passo 1: Baixar este pacote para a VPS

Como o repositório do Lovable já está conectado ao seu GitHub, basta clonar:

```bash
cd /opt
git clone https://github.com/SEU_USUARIO/SEU_REPO.git lovable-app
cd lovable-app/migration-tools
ls -lh
```

(Substitua pela URL real do seu repo no GitHub.)

Você deve ver:
```
01_schema.sql                  # 140 migrations consolidadas
02_export_data.mjs             # exporta dados via REST
03_migrate_auth_users.mjs      # migra usuários
README.md                      # este arquivo
```

---

## 🏗️ Passo 2: Aplicar o schema no self-hosted

```bash
cd /opt/lovable-app/migration-tools

# Copia o schema para dentro do container e roda
docker cp 01_schema.sql supabase-db:/tmp/01_schema.sql
docker exec supabase-db psql -U postgres -d postgres -f /tmp/01_schema.sql 2>&1 | tee schema_apply.log

# Confere se as tabelas foram criadas
docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"
```

**Erros esperados (pode ignorar):**
- `extension "..." already exists`
- `function "..." already exists`
- `policy "..." already exists`

**Erros graves (precisam ser tratados):**
- `relation does not exist` em FOREIGN KEY → confira a ordem
- `permission denied` → rode como `postgres` mesmo

Se algum CREATE FUNCTION der erro de role inexistente (ex: `service_role`, `authenticated`, `anon`), garanta que essas roles existem (já vêm no Supabase self-hosted oficial).

---

## 📤 Passo 3: Exportar os dados da origem

```bash
cd /opt/lovable-app/migration-tools

export SOURCE_URL="https://flhycgllttqeczrpmfoc.supabase.co"
export SOURCE_SERVICE_KEY="COLE_A_SERVICE_ROLE_DO_LOVABLE_CLOUD_AQUI"

node 02_export_data.mjs
```

Saída esperada:
```
📦 Exportando dados de https://flhycgllttqeczrpmfoc.supabase.co

  → companies                                9/9 linhas
  → profiles                                 57/57 linhas
  → user_roles                               57/57 linhas
  → crm_leads                                6775/6775 linhas
  → crm_renovacoes                           13449/13449 linhas
  → crm_cobrancas                            1650/1650 linhas
  → ssotica_sync_logs                        9166/9166 linhas
  ...
✅ Concluído. Arquivo: ./data.sql
```

Confira o tamanho:
```bash
ls -lh data.sql
# esperado: ~30-80 MB
```

---

## 📥 Passo 4: Importar os dados no self-hosted

```bash
cd /opt/lovable-app/migration-tools

# Copia para o container e aplica
docker cp data.sql supabase-db:/tmp/data.sql
docker exec supabase-db psql -U postgres -d postgres -f /tmp/data.sql 2>&1 | tee data_apply.log

# Confere os totais
docker exec supabase-db psql -U postgres -d postgres -c "
  SELECT 'crm_leads' AS t, count(*) FROM public.crm_leads
  UNION ALL SELECT 'crm_renovacoes', count(*) FROM public.crm_renovacoes
  UNION ALL SELECT 'crm_cobrancas', count(*) FROM public.crm_cobrancas
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles
  UNION ALL SELECT 'companies', count(*) FROM public.companies;
"
```

Os números devem bater com a origem.

---

## 👥 Passo 5: Migrar usuários do auth

```bash
export SOURCE_URL="https://flhycgllttqeczrpmfoc.supabase.co"
export SOURCE_SERVICE_KEY="..."  # mesma de antes
export TARGET_URL="https://api.joonker.com.br"
export TARGET_SERVICE_KEY="COLE_A_SERVICE_ROLE_DO_SELF_HOSTED_AQUI"

node 03_migrate_auth_users.mjs
```

⚠️ **Importante:** Os hashes de senha NÃO são migráveis via Admin API. Os usuários precisarão clicar em "Esqueci minha senha" no novo sistema. Como alternativa, você pode definir uma senha temporária no script.

---

## 🗂️ Passo 6: Recriar buckets de Storage

Você tem 3 buckets: `logos`, `avatars`, `whatsapp-media`. Crie eles no Studio do self-hosted (`https://api.joonker.com.br`):

1. Acesse **Storage** no painel
2. Clique **New bucket** → marque como **Public**
3. Crie os 3 buckets

Os arquivos antigos (apenas 6 objetos no total) você pode baixar manualmente da origem e fazer upload no destino, ou ignorar (URLs antigas continuarão funcionando enquanto o Lovable Cloud existir).

---

## 🔄 Passo 7: Trocar o client do app

Depois que tudo estiver migrado e validado, me avise no chat para eu atualizar o código:
- `src/integrations/supabase/client.ts` para apontar para `https://api.joonker.com.br`
- `.env` com a nova `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
- Deploy das edge functions no self-hosted

---

## 🆘 Troubleshooting

### "value too long for type character varying(N)"
Algum campo está maior no Cloud que no schema. Verifique e ajuste o limite na migration correspondente.

### "duplicate key value violates unique constraint"
Você está rodando o import 2x. O `ON CONFLICT DO NOTHING` já trata isso na maioria das tabelas; em outras, limpe a tabela antes:
```sql
TRUNCATE public.crm_leads CASCADE;
```

### Schema não aplica por causa de `auth.users`
Algumas FKs apontam para `auth.users`. Garanta que o `auth.users` existe antes de aplicar — o Supabase self-hosted oficial já cria essa tabela na inicialização. Se não tiver, rode primeiro a migration do GoTrue.

### PostgREST não enxerga novas tabelas
```bash
docker exec supabase-rest curl -X POST http://localhost:3000/rpc/pgrst_reload
# ou simplesmente reinicie:
docker restart supabase-rest
```
