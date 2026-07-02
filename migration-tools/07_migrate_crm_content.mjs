#!/usr/bin/env node
/**
 * Migra o CONTEÚDO do CRM (leads, cobranças, renovações — com notas,
 * atividades, agendamentos e histórico — e conversas de WhatsApp) da
 * produção atual (crm-my-way em api.joonker.com.br) para o sistema
 * unificado, que JÁ TEM empresas e usuários cadastrados de forma
 * independente (criados manualmente durante a configuração do Crediário).
 *
 * Diferente de 02_export_data.mjs (que assume banco de destino vazio com
 * os MESMOS UUIDs), este script remapeia:
 *   - companies:  casadas por CNPJ (fallback: nome). Empresa da origem sem
 *                 correspondência no destino é CRIADA (mantendo o mesmo id).
 *   - usuários:   casados por e-mail (profiles.email). Usuário da origem sem
 *                 correspondência é CRIADO no destino (auth.users + profiles
 *                 + user_roles, mantendo o mesmo id) — SEM senha (precisa
 *                 usar "Esqueci minha senha" no sistema novo).
 *
 * NÃO migra (propositalmente):
 *   - Tabelas de configuração já montadas manualmente no sistema novo:
 *     crm_statuses, crm_columns, crm_form_fields, crm_renovacao_*,
 *     crm_cobranca_statuses/status_checklist/column_flow/situacao_mapping,
 *     role_definitions, role_page_permissions, business hours etc.
 *     (o campo `status` dos leads/cobranças/renovações é só um texto-chave,
 *     não uma FK — os registros migrados continuam aparecendo na coluna
 *     certa do Kanban desde que a `key` já exista no sistema novo).
 *   - crm_cobranca_checklist_completions / crm_cobranca_flow_events
 *     (dependem de linhas de crm_cobranca_statuses/checklist que não têm
 *     correspondência garantida no destino).
 *   - lead_card_opens (auditoria de abertura de card, baixo valor).
 *   - whatsapp_instances / whatsapp_instance_assignments (o sistema novo já
 *     tem sua própria instância/conexão ativa — migrar a antiga junto
 *     duplicaria a conexão do WhatsApp).
 *   - manager_companies (vínculo gerente↔loja extra já configurado à parte
 *     no sistema novo).
 *
 * whatsapp_conversations / whatsapp_messages são migradas como HISTÓRICO,
 * com instance_id sempre NULL (não ficam vinculadas a nenhuma instância
 * ativa — servem só para consulta do que já foi conversado).
 *
 * Não escreve as tabelas de conteúdo direto no destino — gera
 * ./crm_data.sql para você revisar e aplicar com psql, no mesmo fluxo do
 * 02_export_data.mjs / 06_migrate_crediario_data.mjs. As tabelas pequenas
 * (companies novas, profiles/user_roles novos) SÃO criadas ao vivo durante
 * a execução, pois profiles.user_id exige que o auth.users já exista.
 *
 * USO NA VPS NOVA:
 *   export SOURCE_URL="https://api.joonker.com.br"
 *   export SOURCE_SERVICE_KEY="<service_role da produção atual>"
 *   export TARGET_URL="https://api-crmunificado.joonker.com.br"
 *   export TARGET_SERVICE_KEY="<SERVICE_ROLE_KEY do .env da VPS nova>"
 *   node 07_migrate_crm_content.mjs
 *
 * Saída: ./crm_data.sql + relatório no terminal.
 */

import fs from 'node:fs';

const SOURCE_URL = process.env.SOURCE_URL;
const SOURCE_KEY = process.env.SOURCE_SERVICE_KEY;
const TARGET_URL = process.env.TARGET_URL;
const TARGET_KEY = process.env.TARGET_SERVICE_KEY;
const PAGE_SIZE = 1000;

if (!SOURCE_URL || !SOURCE_KEY || !TARGET_URL || !TARGET_KEY) {
  console.error('❌ Defina SOURCE_URL, SOURCE_SERVICE_KEY, TARGET_URL e TARGET_SERVICE_KEY.');
  process.exit(1);
}

function onlyDigits(s) { return String(s ?? '').replace(/\D/g, ''); }
function normName(s) { return String(s ?? '').trim().toLowerCase(); }
function normEmail(s) { return String(s ?? '').trim().toLowerCase(); }

async function restSelect(baseUrl, key, table, columns = '*') {
  const out = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const res = await fetch(`${baseUrl}/rest/v1/${table}?select=${columns}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${table}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function restInsert(baseUrl, key, table, row) {
  const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insertStmt(table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => sqlEscape(row[c]));
  // ON CONFLICT DO NOTHING sem alvo (em vez de "ON CONFLICT (id)") absorve
  // qualquer violação de unicidade, não só duplicata de id — necessário
  // porque crm_renovacoes/crm_cobrancas têm UNIQUE ligada ao SSótica
  // (ssotica_cliente_id+company_id / ssotica_parcela_id), e o destino já
  // pode ter criado essas mesmas linhas via sincronização automática
  // independente da migração.
  return `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')}) ON CONFLICT DO NOTHING;`;
}

// Colunas GERADAS (GENERATED ALWAYS AS ... STORED) — não podem ser inseridas.
const GENERATED_COLUMNS = {
  crm_renovacoes: new Set(['telefone_digits']),
  crm_appointments: new Set(['telefone_digits']),
};

async function main() {
  console.log(`📦 Origem (produção atual):  ${SOURCE_URL}`);
  console.log(`📦 Destino (sistema unificado): ${TARGET_URL}\n`);

  // ========================================================================
  // 1) Empresas: casa por CNPJ/nome; cria no destino (mesmo id) se não bater
  // ========================================================================
  console.log('🏢 Resolvendo empresas...');
  const srcCompanies = await restSelect(SOURCE_URL, SOURCE_KEY, 'companies', '*');
  const tgtCompaniesForMatch = await restSelect(TARGET_URL, TARGET_KEY, 'companies', 'id,name,cnpj');

  const tgtByCnpj = new Map();
  const tgtByName = new Map();
  for (const c of tgtCompaniesForMatch) {
    if (c.cnpj) tgtByCnpj.set(onlyDigits(c.cnpj), c.id);
    tgtByName.set(normName(c.name), c.id);
  }

  const companyMap = new Map(); // company.id (origem) -> company.id (destino)
  const companiesCriadas = [];
  const companiesFalharam = [];
  for (const c of srcCompanies) {
    const byCnpj = c.cnpj ? tgtByCnpj.get(onlyDigits(c.cnpj)) : undefined;
    const byName = tgtByName.get(normName(c.name));
    const match = byCnpj || byName;
    if (match) {
      companyMap.set(c.id, match);
      continue;
    }
    try {
      await restInsert(TARGET_URL, TARGET_KEY, 'companies', c);
      companyMap.set(c.id, c.id);
      companiesCriadas.push(c.name);
    } catch (e) {
      companiesFalharam.push({ name: c.name, error: e.message });
    }
  }
  console.log(`   ${companyMap.size}/${srcCompanies.length} empresas resolvidas.`);
  if (companiesCriadas.length) {
    console.log(`   ➕ Criadas no destino (sem correspondência por CNPJ/nome): ${companiesCriadas.join(', ')}`);
  }
  if (companiesFalharam.length) {
    console.log(`   ⚠️  Falharam ao criar (registros dessas empresas serão ignorados):`);
    for (const f of companiesFalharam) console.log(`      - ${f.name}: ${f.error}`);
  }

  // ========================================================================
  // 2) Usuários: casa por e-mail; cria no destino (auth + profile + role,
  //    mesmo id) se não bater
  // ========================================================================
  console.log('\n👤 Resolvendo usuários...');
  const srcProfiles = await restSelect(SOURCE_URL, SOURCE_KEY, 'profiles', '*');
  const srcRoles = await restSelect(SOURCE_URL, SOURCE_KEY, 'user_roles', '*');
  const tgtProfiles = await restSelect(TARGET_URL, TARGET_KEY, 'profiles', 'user_id,email');
  const tgtRoleDefs = await restSelect(TARGET_URL, TARGET_KEY, 'role_definitions', 'key');
  const tgtRoles = await restSelect(TARGET_URL, TARGET_KEY, 'user_roles', 'user_id,role');

  const tgtByEmail = new Map();
  for (const p of tgtProfiles) tgtByEmail.set(normEmail(p.email), p.user_id);
  const tgtRoleKeys = new Set(tgtRoleDefs.map((r) => r.key));

  const fallbackAdminUserId = tgtRoles.find((r) => r.role === 'admin')?.user_id || null;
  if (!fallbackAdminUserId) {
    console.error('❌ Não encontrei nenhum usuário admin no destino — necessário como fallback. Abortando.');
    process.exit(1);
  }

  const srcRoleByUser = new Map();
  for (const r of srcRoles) srcRoleByUser.set(r.user_id, r);

  const userMap = new Map(); // user_id (origem) -> user_id (destino)
  const usuariosCriados = [];
  const usuariosFalharam = [];
  for (const p of srcProfiles) {
    const match = tgtByEmail.get(normEmail(p.email));
    if (match) {
      userMap.set(p.user_id, match);
      continue;
    }
    // Usuário novo — cria no destino preservando o mesmo id (sem senha).
    try {
      const createRes = await fetch(`${TARGET_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: TARGET_KEY, Authorization: `Bearer ${TARGET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.user_id, email: p.email, email_confirm: true }),
      });
      if (!createRes.ok) {
        const txt = await createRes.text();
        if (!/already|exists|registered/i.test(txt)) throw new Error(`auth: ${createRes.status} ${txt}`);
        // já existe no auth mas sem profile — segue e cria só o profile/role
      }

      const companyIdDestino = p.company_id ? (companyMap.get(p.company_id) ?? null) : null;
      await restInsert(TARGET_URL, TARGET_KEY, 'profiles', {
        id: p.id,
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        company_id: companyIdDestino,
        phone: p.phone ?? null,
      });

      const srcRole = srcRoleByUser.get(p.user_id);
      if (srcRole) {
        const roleKey = srcRole.role_key && tgtRoleKeys.has(srcRole.role_key) ? srcRole.role_key : null;
        await restInsert(TARGET_URL, TARGET_KEY, 'user_roles', {
          user_id: p.user_id,
          role: srcRole.role,
          role_key: roleKey,
        });
      }

      userMap.set(p.user_id, p.user_id);
      usuariosCriados.push(p.email);
    } catch (e) {
      usuariosFalharam.push({ email: p.email, error: e.message });
    }
  }
  console.log(`   ${userMap.size}/${srcProfiles.length} usuários resolvidos.`);
  if (usuariosCriados.length) {
    console.log(`   ➕ Criados no destino (sem correspondência por e-mail, SEM senha — precisam de "Esqueci minha senha"):`);
    for (const e of usuariosCriados) console.log(`      - ${e}`);
  }
  if (usuariosFalharam.length) {
    console.log(`   ⚠️  Falharam ao criar (referências a esses usuários usarão o admin como responsável):`);
    for (const f of usuariosFalharam) console.log(`      - ${f.email}: ${f.error}`);
  }

  function mapUser(id, { required = false } = {}) {
    if (!id) return required ? fallbackAdminUserId : null;
    return userMap.get(id) ?? (required ? fallbackAdminUserId : null);
  }
  function mapCompany(id) {
    if (!id) return null;
    return companyMap.get(id) ?? null;
  }

  // ========================================================================
  // 3) Conteúdo: leads, cobranças, renovações (+ notas/atividades/agenda/
  //    histórico) e conversas de WhatsApp (sem instância)
  // ========================================================================
  const out = fs.createWriteStream('./crm_data.sql');
  out.write(`-- Dump de conteúdo do CRM gerado em ${new Date().toISOString()}\n`);
  out.write(`-- Origem: ${SOURCE_URL}\n\n`);
  out.write(`SET session_replication_role = 'replica';\n`);

  function remapRow(row, table, { userCols = [], requiredUserCols = [], companyCols = [], forceNull = [], idCols = {} } = {}) {
    const r = { ...row };
    const skip = GENERATED_COLUMNS[table];
    if (skip) for (const c of skip) delete r[c];
    for (const col of userCols) {
      if (!(col in r) || r[col] == null) continue;
      r[col] = mapUser(r[col], { required: false });
    }
    for (const col of requiredUserCols) {
      if (!(col in r)) continue;
      r[col] = mapUser(r[col], { required: true });
    }
    for (const col of companyCols) {
      if (!(col in r) || r[col] == null) continue;
      r[col] = mapCompany(r[col]);
    }
    for (const [col, map] of Object.entries(idCols)) {
      if (!(col in r) || r[col] == null) continue;
      r[col] = map.get(r[col]) ?? null;
    }
    for (const col of forceNull) {
      if (col in r) r[col] = null;
    }
    return r;
  }

  async function dump(srcTable, targetTable, opts) {
    process.stdout.write(`  → ${srcTable.padEnd(30)} → ${targetTable.padEnd(30)}`);
    const rows = await restSelect(SOURCE_URL, SOURCE_KEY, srcTable, '*');
    out.write(`\n-- ============ ${srcTable} → ${targetTable} ============\n`);
    out.write(`BEGIN;\n`);
    for (const row of rows) {
      const mapped = remapRow(row, targetTable, opts);
      out.write(insertStmt(targetTable, mapped) + '\n');
    }
    out.write(`COMMIT;\n`);
    console.log(`${rows.length} linhas`);
    return rows.length;
  }

  async function safe(label, fn) {
    try {
      await fn();
    } catch (e) {
      console.log(`  ⚠️  ${label}: ${e.message} — pulando esta tabela`);
    }
  }

  console.log('\n📄 Gerando crm_data.sql...\n');

  // Leads
  await safe('crm_leads', () => dump('crm_leads', 'crm_leads', {
    userCols: ['assigned_to', 'created_by', 'excluded_by', 'previous_assigned_before_exclude'],
  }));
  await safe('crm_lead_notes', () => dump('crm_lead_notes', 'crm_lead_notes', { requiredUserCols: ['user_id'] }));
  await safe('lead_activities', () => dump('lead_activities', 'lead_activities', { requiredUserCols: ['created_by'] }));

  // ------------------------------------------------------------------------
  // Renovações — crm_renovacoes tem UNIQUE(ssotica_cliente_id, ssotica_company_id)
  // e o sistema unificado JÁ cria essas linhas sozinho via sync automático da
  // SSótica. Para não colidir (e não perder notas/atividades/agendamentos
  // ligados), pré-checa o que já existe no destino: se a renovação da origem
  // corresponde a uma que já existe lá, NÃO insere de novo — só redireciona
  // renovacao_id dos registros dependentes para o id que já existe no destino.
  // ------------------------------------------------------------------------
  console.log('  → crm_renovacoes: checando o que já existe no destino via SSótica...');
  const renovacaoIdRemap = new Map(); // id (origem) -> id a usar no destino
  let renovacoesInseridas = 0, renovacoesRedirecionadas = 0;
  await safe('crm_renovacoes', async () => {
    const tgtExisting = await restSelect(TARGET_URL, TARGET_KEY, 'crm_renovacoes', 'id,ssotica_cliente_id,ssotica_company_id');
    const existingByKey = new Map();
    for (const t of tgtExisting) {
      if (t.ssotica_cliente_id != null && t.ssotica_company_id) {
        existingByKey.set(`${t.ssotica_cliente_id}|${t.ssotica_company_id}`, t.id);
      }
    }
    const rows = await restSelect(SOURCE_URL, SOURCE_KEY, 'crm_renovacoes', '*');
    out.write(`\n-- ============ crm_renovacoes → crm_renovacoes ============\n`);
    out.write(`BEGIN;\n`);
    for (const row of rows) {
      const mapped = remapRow(row, 'crm_renovacoes', {
        userCols: ['assigned_to', 'created_by', 'excluded_by', 'previous_assigned_before_exclude'],
        companyCols: ['ssotica_company_id'],
      });
      const key = mapped.ssotica_cliente_id != null && mapped.ssotica_company_id
        ? `${mapped.ssotica_cliente_id}|${mapped.ssotica_company_id}`
        : null;
      const existingTargetId = key ? existingByKey.get(key) : undefined;
      if (existingTargetId) {
        renovacaoIdRemap.set(row.id, existingTargetId);
        renovacoesRedirecionadas++;
        continue; // já existe no destino (auto-sync) — não insere de novo
      }
      renovacaoIdRemap.set(row.id, row.id);
      // Registra já aqui (não só o que veio do destino) — evita que duas
      // linhas da PRÓPRIA origem com o mesmo cliente+empresa colidam entre
      // si sem serem percebidas pelo redirect.
      if (key) existingByKey.set(key, row.id);
      out.write(insertStmt('crm_renovacoes', mapped) + '\n');
      renovacoesInseridas++;
    }
    out.write(`COMMIT;\n`);
    console.log(`     ${renovacoesInseridas} inseridas, ${renovacoesRedirecionadas} já existiam no destino (redirecionadas)`);
  });
  await safe('crm_renovacao_notes', () => dump('crm_renovacao_notes', 'crm_renovacao_notes', {
    requiredUserCols: ['user_id'],
    idCols: { renovacao_id: renovacaoIdRemap },
  }));
  await safe('renovacao_activities', () => dump('renovacao_activities', 'renovacao_activities', {
    requiredUserCols: ['created_by'],
    idCols: { renovacao_id: renovacaoIdRemap },
  }));

  // Agendamentos (ligados a leads e/ou renovações — usa o remap acima)
  await safe('crm_appointments', () => dump('crm_appointments', 'crm_appointments', {
    requiredUserCols: ['scheduled_by'],
    userCols: ['consulta_paga_por', 'deleted_by', 'returned_by'],
    idCols: { renovacao_id: renovacaoIdRemap },
  }));
  await safe('crm_appointment_history', () => dump('crm_appointment_history', 'crm_appointment_history', {
    requiredUserCols: ['user_id'],
  }));

  // ------------------------------------------------------------------------
  // Cobranças — crm_cobrancas tem TRÊS índices únicos parciais ligados à
  // SSótica (qualquer um pode colidir com o que o sync automático já criou):
  //   - uq_crm_cobrancas_ssotica_parcela:   (ssotica_parcela_id)
  //   - crm_cobrancas_one_per_client_idx:   (ssotica_company_id, ssotica_cliente_id)
  //   - crm_cobrancas_one_per_titulo_idx:   (ssotica_company_id, ssotica_titulo_id)
  // Se QUALQUER uma bater com uma linha já existente no destino, redireciona
  // em vez de inserir (mesma lógica do bloco de renovações acima).
  // ------------------------------------------------------------------------
  console.log('  → crm_cobrancas: checando o que já existe no destino via SSótica...');
  const cobrancaIdRemap = new Map();
  let cobrancasInseridas = 0, cobrancasRedirecionadas = 0;
  await safe('crm_cobrancas', async () => {
    const tgtExisting = await restSelect(TARGET_URL, TARGET_KEY, 'crm_cobrancas', 'id,ssotica_parcela_id,ssotica_company_id,ssotica_cliente_id,ssotica_titulo_id');
    const existingByAnyKey = new Map();
    for (const t of tgtExisting) {
      if (t.ssotica_parcela_id != null) existingByAnyKey.set(`parcela|${t.ssotica_parcela_id}`, t.id);
      if (t.ssotica_company_id && t.ssotica_cliente_id != null) existingByAnyKey.set(`cliente|${t.ssotica_company_id}|${t.ssotica_cliente_id}`, t.id);
      if (t.ssotica_company_id && t.ssotica_titulo_id != null) existingByAnyKey.set(`titulo|${t.ssotica_company_id}|${t.ssotica_titulo_id}`, t.id);
    }
    const rows = await restSelect(SOURCE_URL, SOURCE_KEY, 'crm_cobrancas', '*');
    out.write(`\n-- ============ crm_cobrancas → crm_cobrancas ============\n`);
    out.write(`BEGIN;\n`);
    for (const row of rows) {
      const mapped = remapRow(row, 'crm_cobrancas', {
        userCols: ['assigned_to', 'created_by'],
        companyCols: ['company_id', 'ssotica_company_id'],
      });
      const candidateKeys = [
        mapped.ssotica_parcela_id != null ? `parcela|${mapped.ssotica_parcela_id}` : null,
        mapped.ssotica_company_id && mapped.ssotica_cliente_id != null ? `cliente|${mapped.ssotica_company_id}|${mapped.ssotica_cliente_id}` : null,
        mapped.ssotica_company_id && mapped.ssotica_titulo_id != null ? `titulo|${mapped.ssotica_company_id}|${mapped.ssotica_titulo_id}` : null,
      ].filter(Boolean);
      const existingTargetId = candidateKeys.map((k) => existingByAnyKey.get(k)).find(Boolean);
      if (existingTargetId) {
        cobrancaIdRemap.set(row.id, existingTargetId);
        cobrancasRedirecionadas++;
        continue;
      }
      cobrancaIdRemap.set(row.id, row.id);
      // Registra já aqui — evita colisão entre duas linhas da própria
      // origem com a mesma chave (parcela/cliente/título) não percebida.
      for (const k of candidateKeys) existingByAnyKey.set(k, row.id);
      out.write(insertStmt('crm_cobrancas', mapped) + '\n');
      cobrancasInseridas++;
    }
    out.write(`COMMIT;\n`);
    console.log(`     ${cobrancasInseridas} inseridas, ${cobrancasRedirecionadas} já existiam no destino (redirecionadas)`);
  });
  await safe('crm_cobranca_notes', () => dump('crm_cobranca_notes', 'crm_cobranca_notes', {
    requiredUserCols: ['user_id'],
    idCols: { cobranca_id: cobrancaIdRemap },
  }));
  await safe('cobranca_activities', () => dump('cobranca_activities', 'cobranca_activities', {
    requiredUserCols: ['created_by'],
    idCols: { cobranca_id: cobrancaIdRemap },
  }));

  // Transições entre módulos (renovação ↔ cobrança) — sem FK real (ids
  // polimórficos), mas redireciona quando possível para manter coerência.
  await safe('crm_module_transition_logs', () => dump('crm_module_transition_logs', 'crm_module_transition_logs', {
    userCols: ['triggered_by'],
    companyCols: ['company_id'],
  }));

  // WhatsApp — histórico, sem instância ativa
  await safe('whatsapp_conversations', () => dump('whatsapp_conversations', 'whatsapp_conversations', {
    userCols: ['assigned_to'],
    companyCols: ['routed_to_company_id'],
    forceNull: ['instance_id'],
  }));
  await safe('whatsapp_messages', () => dump('whatsapp_messages', 'whatsapp_messages', {
    userCols: ['sent_by'],
  }));

  out.write(`\nSET session_replication_role = 'origin';\n`);
  out.end();

  console.log(`\n✅ Concluído. Arquivo: ./crm_data.sql`);
  console.log(`\nRevise o arquivo antes de aplicar. Para aplicar no destino:`);
  console.log(`   docker cp crm_data.sql supabase-db:/tmp/crm_data.sql`);
  console.log(`   docker exec supabase-db psql -U postgres -d postgres -f /tmp/crm_data.sql 2>&1 | tee crm_data_apply.log`);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
