# Migração de dados para o sistema unificado

Pacote para trazer os dados das suas duas instalações atuais em produção
para a VPS nova do sistema unificado (`crmunificado`):

- **Parte 1** — CRM atual (`crm-my-way`, self-hosted em `api.joonker.com.br`) → VPS nova.
- **Parte 2** — Crediário atual (`consultasjoonker`, Supabase cloud) → VPS nova,
  remapeando empresas (por CNPJ) e usuários (por e-mail) para os registros
  que já existem no sistema unificado.

Faça a **Parte 1 primeiro**, confirme que os números bateram, e só depois
rode a **Parte 2**.

---

## 🔑 Pré-requisitos na VPS nova

```bash
node --version  # >= 18
docker exec supabase-db psql -U postgres -c "SELECT 1"
cd /opt/crm/migration-tools
```

## 🔐 Chaves necessárias

### CRM atual (origem da Parte 1)
- `SOURCE_URL` = `https://api.joonker.com.br`
- `SOURCE_SERVICE_KEY` = `SERVICE_ROLE_KEY` do `.env` da VPS de produção atual

### Crediário atual (origem da Parte 2)
- `SOURCE_URL` = `https://vtiimbbrxsfqgmscqdnl.supabase.co`
- `SOURCE_SERVICE_KEY` = service_role do projeto Supabase cloud do consultasjoonker
  (no painel do Supabase: Project Settings → API → service_role)

### VPS nova (destino das duas partes)
- `TARGET_URL` = `https://api-crmunificado.joonker.com.br`
- `TARGET_SERVICE_KEY` = `SERVICE_ROLE_KEY` do `/opt/crm/.env` da VPS nova

---

## Parte 1 — Dados do CRM (crm-my-way)

### Passo 1: Exportar da produção atual

```bash
cd /opt/crm/migration-tools
export SOURCE_URL="https://api.joonker.com.br"
export SOURCE_SERVICE_KEY="COLE_A_SERVICE_ROLE_DA_VPS_ATUAL"

node 02_export_data.mjs
```

Gera `./data.sql`. Confira o tamanho (`ls -lh data.sql`) e dê uma olhada
rápida no arquivo antes de aplicar.

### Passo 2: Aplicar no destino

```bash
docker cp data.sql supabase-db:/tmp/data.sql
docker exec supabase-db psql -U postgres -d postgres -f /tmp/data.sql 2>&1 | tee data_apply.log

# Confere alguns totais
docker exec supabase-db psql -U postgres -d postgres -c "
  SELECT 'crm_leads' AS t, count(*) FROM public.crm_leads
  UNION ALL SELECT 'crm_renovacoes', count(*) FROM public.crm_renovacoes
  UNION ALL SELECT 'crm_cobrancas', count(*) FROM public.crm_cobrancas
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles
  UNION ALL SELECT 'companies', count(*) FROM public.companies;
"
```

Compare com os totais da produção atual (Studio → Table Editor, ou a mesma
query no `api.joonker.com.br`). Se um número não bater, veja `data_apply.log`
por erros antes de seguir.

### Passo 3: Migrar usuários (auth)

```bash
export SOURCE_URL="https://api.joonker.com.br"
export SOURCE_SERVICE_KEY="..."   # mesma de antes
export TARGET_URL="https://api-crmunificado.joonker.com.br"
export TARGET_SERVICE_KEY="$(grep '^SERVICE_ROLE_KEY=' /opt/crm/.env | cut -d= -f2-)"

node 03_migrate_auth_users.mjs
```

⚠️ Os hashes de senha não são migráveis pela Admin API — cada usuário vai
precisar clicar em "Esqueci minha senha" no sistema novo (ou você define uma
senha temporária e avisa o time).

### Passo 4: Storage (logos, avatars, whatsapp-media)

Poucos arquivos normalmente. Baixe manualmente da origem (Studio → Storage)
e suba nos buckets equivalentes da VPS nova, ou ignore — as URLs antigas
continuam funcionando enquanto a VPS de produção atual existir.

---

## Parte 1B — Conteúdo do CRM quando o destino JÁ TEM empresas/usuários

Use esta parte em vez da Parte 1 acima se a VPS nova **já tem empresas e
usuários cadastrados de forma independente** (por exemplo, porque você já
configurou o Crediário/SSótica nela antes de trazer os dados do CRM). Nesse
caso os UUIDs de `companies`/`profiles` do destino **não coincidem** com os
da produção antiga, e aplicar `data.sql` da Parte 1 direto criaria empresas
e usuários **duplicados**.

`07_migrate_crm_content.mjs` resolve isso casando:
- **empresas** por CNPJ (fallback: nome) — cria a empresa no destino
  (mantendo o mesmo id) se não achar correspondência;
- **usuários** por e-mail — cria o usuário no destino (auth + profile +
  papel, mantendo o mesmo id, **sem senha**) se não achar correspondência.

Depois migra o **conteúdo**: leads, cobranças, renovações (com notas,
atividades, agendamentos e histórico) e conversas de WhatsApp — remapeando
toda referência de empresa/usuário para os ids corretos do destino.

**Não migra** (propositalmente, ver comentário no topo do script para o
motivo de cada um): tabelas de configuração (colunas do Kanban, formulários,
papéis, horário de funcionamento — você já configurou isso manualmente no
sistema novo), checklist/eventos de fluxo de cobrança, auditoria de abertura
de card, e a instância/conexão do WhatsApp (o sistema novo já tem a própria
ativa — as conversas migradas ficam como histórico, sem instância vinculada,
e não é possível responder por elas ali).

⚠️ **Faça um backup do banco da VPS nova antes de rodar** — a resolução de
empresas/usuários é aplicada **na hora** (não é só gerar um .sql para
revisar, como o resto do fluxo):

```bash
docker exec supabase-db pg_dump -U postgres -d postgres -Fc -f /tmp/backup_pre_migracao.dump
docker cp supabase-db:/tmp/backup_pre_migracao.dump ./backup_pre_migracao.dump
```

### Passo 1: Rodar o script

```bash
cd /opt/crm/migration-tools
export SOURCE_URL="https://api.joonker.com.br"
export SOURCE_SERVICE_KEY="COLE_A_SERVICE_ROLE_DA_VPS_ATUAL"
export TARGET_URL="https://api-crmunificado.joonker.com.br"
export TARGET_SERVICE_KEY="$(grep '^SERVICE_ROLE_KEY=' /opt/crm/.env | cut -d= -f2-)"

node 07_migrate_crm_content.mjs
```

Leia o resumo no terminal: quantas empresas/usuários já bateram, quantos
foram criados do zero, e se algum falhou. Usuários criados do zero
precisam usar "Esqueci minha senha" no sistema novo.

Abra `./crm_data.sql` e dê uma olhada antes de aplicar.

### Passo 2: Aplicar no destino

```bash
docker cp crm_data.sql supabase-db:/tmp/crm_data.sql
docker exec supabase-db psql -U postgres -d postgres -f /tmp/crm_data.sql 2>&1 | tee crm_data_apply.log

docker exec supabase-db psql -U postgres -d postgres -c "
  SELECT 'crm_leads' AS t, count(*) FROM public.crm_leads
  UNION ALL SELECT 'crm_renovacoes', count(*) FROM public.crm_renovacoes
  UNION ALL SELECT 'crm_cobrancas', count(*) FROM public.crm_cobrancas
  UNION ALL SELECT 'whatsapp_conversations', count(*) FROM public.whatsapp_conversations
  UNION ALL SELECT 'whatsapp_messages', count(*) FROM public.whatsapp_messages;
"
```

Compare com os totais da produção atual antes de considerar concluído.

---

## Parte 2 — Dados do Crediário (consultasjoonker)

Diferente da Parte 1, aqui os IDs de empresa e usuário **não coincidem**
entre os dois bancos — o script `06_migrate_crediario_data.mjs` remapeia:

- `empresas` (origem) → `companies` (destino): casadas por **CNPJ**
  (e por nome, se o CNPJ não bater).
- usuários (origem) → `profiles` (destino): casados por **e-mail**.

Registros cuja empresa ou usuário não for encontrado no destino são
**ignorados** (não quebram a migração) e listados no terminal — confira essa
lista; se faltar alguém, crie a empresa/usuário no sistema novo primeiro e
rode o script de novo.

### Passo 1: Gerar o SQL remapeado

```bash
cd /opt/crm/migration-tools
export SOURCE_URL="https://vtiimbbrxsfqgmscqdnl.supabase.co"
export SOURCE_SERVICE_KEY="COLE_A_SERVICE_ROLE_DO_CONSULTASJOONKER"
export TARGET_URL="https://api-crmunificado.joonker.com.br"
export TARGET_SERVICE_KEY="$(grep '^SERVICE_ROLE_KEY=' /opt/crm/.env | cut -d= -f2-)"

node 06_migrate_crediario_data.mjs
```

Leia o resumo no terminal (quantas empresas/usuários casaram, quais não) e
abra `./crediario_data.sql` para revisar antes de aplicar.

### Passo 2: Aplicar no destino

```bash
docker cp crediario_data.sql supabase-db:/tmp/crediario_data.sql
docker exec supabase-db psql -U postgres -d postgres -f /tmp/crediario_data.sql 2>&1 | tee crediario_apply.log

docker exec supabase-db psql -U postgres -d postgres -c "
  SELECT 'crediario_vendas' AS t, count(*) FROM public.crediario_vendas
  UNION ALL SELECT 'crediario_parcelas', count(*) FROM public.crediario_parcelas
  UNION ALL SELECT 'crediario_contracts', count(*) FROM public.crediario_contracts
  UNION ALL SELECT 'crediario_consultas', count(*) FROM public.crediario_consultas;
"
```

### Passo 3: Credenciais Cora por empresa

`empresa_credenciais` → `crediario_company_credentials` já migra junto (se a
empresa bateu). Confira em **Crediário → Credenciais** no sistema novo se
os certificados de cada loja aparecem certos.

---

## 🆘 Troubleshooting

### "value too long for type character varying(N)"
Algum campo está maior na origem que no schema do destino. Ajuste o limite
na migration correspondente em `supabase/migrations/`.

### "duplicate key value violates unique constraint"
Script rodando 2x. O `ON CONFLICT DO NOTHING` já trata a maioria dos casos;
se precisar refazer do zero uma tabela específica:
```sql
TRUNCATE public.crm_leads CASCADE;
```

### PostgREST não enxerga tabelas/colunas novas
```bash
docker restart supabase-rest
```

### Quero conferir uma empresa/usuário que não bateu na Parte 2
O script imprime a lista completa no terminal. Cadastre a empresa (com o
mesmo CNPJ) ou o usuário (com o mesmo e-mail) no sistema novo e rode o
script de novo — ele é seguro para rodar mais de uma vez.
