#!/usr/bin/env node
/**
 * Exporta dados do Lovable Cloud (origem) via API REST do PostgREST
 * e gera um arquivo data.sql com INSERTs prontos para o self-hosted.
 *
 * USO NA VPS:
 *   export SOURCE_URL="https://flhycgllttqeczrpmfoc.supabase.co"
 *   export SOURCE_SERVICE_KEY="eyJhbGc...service_role..."
 *   node 02_export_data.mjs
 *
 * Saída: ./data.sql + ./auth_users.sql + ./storage_objects.sql
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_URL = process.env.SOURCE_URL;
const SOURCE_KEY = process.env.SOURCE_SERVICE_KEY;
const PAGE_SIZE = 1000;

if (!SOURCE_URL || !SOURCE_KEY) {
  console.error('❌ Defina SOURCE_URL e SOURCE_SERVICE_KEY antes de executar.');
  process.exit(1);
}

// Ordem de export respeitando dependências (mesmo sem FKs explícitas, evita confusão)
const TABLES = [
  'companies',
  'profiles',
  'user_roles',
  'manager_companies',
  'crm_statuses',
  'crm_columns',
  'crm_form_fields',
  'crm_renovacao_form_fields',
  'crm_renovacao_statuses',
  'crm_cobranca_statuses',
  'crm_cobranca_status_checklist',
  'crm_cobranca_column_flow',
  'crm_leads',
  'crm_lead_notes',
  'crm_appointments',
  'crm_renovacoes',
  'crm_renovacao_notes',
  'renovacao_activities',
  'crm_cobrancas',
  'crm_cobranca_notes',
  'cobranca_activities',
  'crm_cobranca_checklist_completions',
  'crm_cobranca_flow_events',
  'crm_module_transition_logs',
  'lead_activities',
  'lead_card_opens',
  'notifications',
  'push_subscriptions',
  'scheduled_whatsapp_messages',
  'ssotica_funcionarios',
  'ssotica_integrations',
  'ssotica_sync_logs',
  'ssotica_user_mappings',
  'system_settings',
  'whatsapp_campaigns',
  'whatsapp_campaign_sends',
  'whatsapp_completion_logs',
  'whatsapp_instances',
  'whatsapp_trigger_campaigns',
  'whatsapp_trigger_steps',
  'whatsapp_trigger_sends',
];

// ----------- helpers -----------

function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'object') {
    // jsonb / array
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  // string
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function fetchPage(table, from, to) {
  const url = `${SOURCE_URL}/rest/v1/${table}?select=*&order=created_at.asc.nullslast`;
  const res = await fetch(url, {
    headers: {
      apikey: SOURCE_KEY,
      Authorization: `Bearer ${SOURCE_KEY}`,
      Range: `${from}-${to}`,
      'Range-Unit': 'items',
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} em ${table}: ${body}`);
  }
  const total = parseInt((res.headers.get('content-range') || '0/0').split('/')[1] || '0', 10);
  const rows = await res.json();
  return { rows, total };
}

async function dumpTable(table, out) {
  process.stdout.write(`  → ${table.padEnd(40)}`);
  let from = 0;
  let total = 0;
  let written = 0;

  out.write(`\n-- ============ ${table} ============\n`);

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { rows, total: t } = await fetchPage(table, from, to);
    total = t;
    if (rows.length === 0) break;

    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => sqlEscape(row[c]));
      out.write(
        `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')}) ON CONFLICT DO NOTHING;\n`
      );
      written++;
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`${written}/${total} linhas`);
  return { table, written, total };
}

// ----------- main -----------

async function main() {
  console.log(`📦 Exportando dados de ${SOURCE_URL}\n`);

  // Desabilita triggers e RLS durante o import
  const out = fs.createWriteStream('./data.sql');
  out.write(`-- Dump gerado em ${new Date().toISOString()}\n`);
  out.write(`-- Origem: ${SOURCE_URL}\n\n`);
  out.write(`SET session_replication_role = 'replica'; -- desabilita triggers\n`);
  out.write(`BEGIN;\n`);

  const summary = [];
  for (const table of TABLES) {
    try {
      const r = await dumpTable(table, out);
      summary.push(r);
    } catch (e) {
      console.error(`  ❌ ${table}: ${e.message}`);
      summary.push({ table, written: 0, total: 0, error: e.message });
    }
  }

  out.write(`\nCOMMIT;\n`);
  out.write(`SET session_replication_role = 'origin';\n`);
  out.end();

  console.log(`\n✅ Concluído. Arquivo: ./data.sql`);
  console.log('\nResumo:');
  console.table(summary);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
