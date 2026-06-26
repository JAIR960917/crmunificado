#!/usr/bin/env node
/**
 * Migra os dados do Crediário (app separado "consultasjoonker", Supabase
 * cloud) para as tabelas crediario_* do sistema unificado.
 *
 * Diferente de 02_export_data.mjs, este script PRECISA remapear IDs porque
 * os dois sistemas tinham bancos próprios:
 *   - empresas (origem) → companies (destino), casadas por CNPJ (fallback: nome)
 *   - profiles.user_id (origem) → profiles.user_id (destino), casados por e-mail
 *
 * Não escreve nada no destino diretamente — gera um arquivo
 * ./crediario_data.sql para você revisar e aplicar com psql, igual ao
 * fluxo de 02_export_data.mjs / data.sql.
 *
 * USO NA VPS NOVA:
 *   export SOURCE_URL="https://vtiimbbrxsfqgmscqdnl.supabase.co"
 *   export SOURCE_SERVICE_KEY="<service_role do consultasjoonker>"
 *   export TARGET_URL="https://api-crmunificado.joonker.com.br"
 *   export TARGET_SERVICE_KEY="<SERVICE_ROLE_KEY do .env da VPS nova>"
 *   node 06_migrate_crediario_data.mjs
 *
 * Saída: ./crediario_data.sql + relatório no terminal de empresas/usuários
 * que não bateram (revise antes de aplicar).
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

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}
function normName(s) {
  return String(s ?? '').trim().toLowerCase();
}
function normEmail(s) {
  return String(s ?? '').trim().toLowerCase();
}

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
  return `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')}) ON CONFLICT (id) DO NOTHING;`;
}

async function main() {
  console.log(`📦 Lendo origem (Crediário): ${SOURCE_URL}`);
  console.log(`📦 Lendo destino (unificado): ${TARGET_URL}\n`);

  // ---------- 1) Mapear empresas → companies (por CNPJ, fallback nome) ----------
  const srcEmpresas = await restSelect(SOURCE_URL, SOURCE_KEY, 'empresas', 'id,nome,cnpj,cidade');
  const tgtCompanies = await restSelect(TARGET_URL, TARGET_KEY, 'companies', 'id,name,cnpj');

  const tgtByCnpj = new Map();
  const tgtByName = new Map();
  for (const c of tgtCompanies) {
    if (c.cnpj) tgtByCnpj.set(onlyDigits(c.cnpj), c.id);
    tgtByName.set(normName(c.name), c.id);
  }

  const companyMap = new Map(); // empresa.id (origem) -> company.id (destino)
  const companiesNaoBatidas = [];
  for (const e of srcEmpresas) {
    const byCnpj = e.cnpj ? tgtByCnpj.get(onlyDigits(e.cnpj)) : undefined;
    const byName = tgtByName.get(normName(e.nome));
    const match = byCnpj || byName;
    if (match) {
      companyMap.set(e.id, match);
    } else {
      companiesNaoBatidas.push(e);
    }
  }

  console.log(`🏢 Empresas: ${companyMap.size}/${srcEmpresas.length} casadas com companies do destino.`);
  if (companiesNaoBatidas.length) {
    console.log(`   ⚠️  Não bateram (registros dessas empresas serão IGNORADOS):`);
    for (const e of companiesNaoBatidas) console.log(`      - ${e.nome} (cnpj: ${e.cnpj || '—'})`);
  }

  // ---------- 2) Mapear profiles (usuários) por e-mail ----------
  const srcProfiles = await restSelect(SOURCE_URL, SOURCE_KEY, 'profiles', 'user_id,email,full_name');
  const tgtProfiles = await restSelect(TARGET_URL, TARGET_KEY, 'profiles', 'user_id,email');

  const tgtByEmail = new Map();
  for (const p of tgtProfiles) tgtByEmail.set(normEmail(p.email), p.user_id);

  const userMap = new Map(); // user_id (origem) -> user_id (destino)
  const usuariosNaoBatidos = [];
  for (const p of srcProfiles) {
    const match = tgtByEmail.get(normEmail(p.email));
    if (match) userMap.set(p.user_id, match);
    else usuariosNaoBatidos.push(p);
  }

  console.log(`\n👤 Usuários: ${userMap.size}/${srcProfiles.length} casados por e-mail com profiles do destino.`);
  if (usuariosNaoBatidos.length) {
    console.log(`   ⚠️  Não bateram (registros desses usuários serão IGNORADOS):`);
    for (const p of usuariosNaoBatidos) console.log(`      - ${p.email} (${p.full_name || 'sem nome'})`);
  }

  // ---------- 3) Exportar tabelas remapeando IDs ----------
  const out = fs.createWriteStream('./crediario_data.sql');
  out.write(`-- Dump do Crediário gerado em ${new Date().toISOString()}\n`);
  out.write(`-- Origem: ${SOURCE_URL}\n\n`);
  out.write(`SET session_replication_role = 'replica';\n`);

  let skippedNoCompany = 0;
  let skippedNoUser = 0;

  function remapRow(row, { userCols = [], companyCols = [], renameCompanyCol } = {}) {
    const r = { ...row };
    for (const col of userCols) {
      if (r[col] == null) continue;
      const mapped = userMap.get(r[col]);
      if (!mapped) return null; // sem usuário correspondente — pula a linha
      r[col] = mapped;
    }
    for (const col of companyCols) {
      if (r[col] == null) continue;
      const mapped = companyMap.get(r[col]);
      if (!mapped) return null; // sem empresa correspondente — pula a linha
      r[col] = mapped;
    }
    if (renameCompanyCol && Object.prototype.hasOwnProperty.call(r, renameCompanyCol.from)) {
      r[renameCompanyCol.to] = r[renameCompanyCol.from];
      delete r[renameCompanyCol.from];
    }
    return r;
  }

  async function dumpRemapped(srcTable, targetTable, columns, opts) {
    process.stdout.write(`  → ${srcTable.padEnd(28)} → ${targetTable.padEnd(32)}`);
    const rows = await restSelect(SOURCE_URL, SOURCE_KEY, srcTable, columns);
    // Cada tabela é sua própria transação: um erro numa linha só desfaz essa
    // tabela, sem perder o que já tiver sido confirmado nas anteriores.
    out.write(`\n-- ============ ${srcTable} → ${targetTable} ============\n`);
    out.write(`BEGIN;\n`);
    let written = 0;
    for (const row of rows) {
      const mapped = remapRow(row, opts);
      if (!mapped) {
        if (opts?.companyCols?.length) skippedNoCompany++;
        if (opts?.userCols?.length) skippedNoUser++;
        continue;
      }
      out.write(insertStmt(targetTable, mapped) + '\n');
      written++;
    }
    out.write(`COMMIT;\n`);
    console.log(`${written}/${rows.length} linhas`);
    return written;
  }

  // Tabelas sem remapeamento de FK (copiam direto)
  async function dumpDirect(srcTable, targetTable, columns) {
    return dumpRemapped(srcTable, targetTable, columns, {});
  }

  await dumpDirect('consultas_cache', 'crediario_consultas_cache', '*');
  await dumpDirect('cora_webhook_logs', 'crediario_cora_webhook_logs', '*');
  await dumpDirect('contratos_assertiva', 'crediario_contratos_assertiva', '*');

  await dumpRemapped('consultas', 'crediario_consultas', '*', { userCols: ['user_id'] });

  await dumpRemapped('consultas_pg_entrega', 'crediario_consultas_pg_entrega', '*', {
    userCols: ['user_id'],
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('consultas_renegociacao', 'crediario_consultas_renegociacao', '*', {
    userCols: ['user_id'],
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('vendas', 'crediario_vendas', '*', {
    userCols: ['user_id'],
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('contracts', 'crediario_contracts', '*', {
    userCols: ['user_id'],
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('parcelas', 'crediario_parcelas', '*', {
    userCols: ['user_id'],
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('codigos_autorizacao', 'crediario_codigos_autorizacao', '*', {
    userCols: ['criado_por', 'usado_por'],
  });

  await dumpRemapped('empresa_credenciais', 'crediario_company_credentials', '*', {
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  await dumpRemapped('relatorios_diarios', 'crediario_relatorios_diarios', '*', {
    companyCols: ['empresa_id'],
    renameCompanyCol: { from: 'empresa_id', to: 'company_id' },
  });

  // Tabelas de configuração única (1 linha) — só migra se o destino ainda
  // estiver vazio, pra não duplicar/disputar com configuração já feita
  // manualmente no sistema novo.
  async function dumpSingletonIfEmpty(srcTable, targetTable, columns) {
    const existing = await restSelect(TARGET_URL, TARGET_KEY, targetTable, 'id');
    if (existing.length > 0) {
      console.log(`  → ${srcTable.padEnd(28)} → ${targetTable.padEnd(32)}já existe linha no destino, pulando`);
      return 0;
    }
    return dumpDirect(srcTable, targetTable, columns);
  }

  await dumpSingletonIfEmpty('credenciais_globais', 'crediario_global_credentials', '*');
  await dumpSingletonIfEmpty('contract_template', 'crediario_contract_template', '*');
  await dumpSingletonIfEmpty('settings', 'crediario_settings', '*');

  out.write(`\nSET session_replication_role = 'origin';\n`);
  out.end();

  console.log(`\n✅ Concluído. Arquivo: ./crediario_data.sql`);
  console.log(`   Linhas ignoradas por empresa não encontrada: ${skippedNoCompany}`);
  console.log(`   Linhas ignoradas por usuário não encontrado: ${skippedNoUser}`);
  console.log(`\nRevise o arquivo antes de aplicar. Para aplicar no destino:`);
  console.log(`   docker cp crediario_data.sql supabase-db:/tmp/crediario_data.sql`);
  console.log(`   docker exec supabase-db psql -U postgres -d postgres -f /tmp/crediario_data.sql`);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
