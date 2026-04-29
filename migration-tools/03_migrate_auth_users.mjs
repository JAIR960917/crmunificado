#!/usr/bin/env node
/**
 * Exporta usuários do auth.users via Supabase Admin API.
 * Os hashes de senha (encrypted_password) NÃO são expostos pela Admin API,
 * então este script gera comandos para RECRIAR os usuários no self-hosted
 * SEM senha — eles precisarão fazer "Esqueci a senha" ou você define uma
 * senha temporária aqui.
 *
 * USO:
 *   export SOURCE_URL="https://flhycgllttqeczrpmfoc.supabase.co"
 *   export SOURCE_SERVICE_KEY="eyJhbGc...service_role..."
 *   export TARGET_URL="https://api.joonker.com.br"
 *   export TARGET_SERVICE_KEY="eyJhbGc...service_role do self-hosted..."
 *   node 03_migrate_auth_users.mjs
 */

const SOURCE_URL = process.env.SOURCE_URL;
const SOURCE_KEY = process.env.SOURCE_SERVICE_KEY;
const TARGET_URL = process.env.TARGET_URL;
const TARGET_KEY = process.env.TARGET_SERVICE_KEY;

if (!SOURCE_URL || !SOURCE_KEY || !TARGET_URL || !TARGET_KEY) {
  console.error('❌ Defina SOURCE_URL, SOURCE_SERVICE_KEY, TARGET_URL e TARGET_SERVICE_KEY.');
  process.exit(1);
}

async function listUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${SOURCE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`;
    const res = await fetch(url, {
      headers: { apikey: SOURCE_KEY, Authorization: `Bearer ${SOURCE_KEY}` },
    });
    if (!res.ok) throw new Error(`Erro listando usuários: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.users?.length) break;
    all.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return all;
}

async function createUserOnTarget(user) {
  const body = {
    id: user.id, // mantém o mesmo UUID — CRÍTICO para FK em profiles, leads etc.
    email: user.email,
    phone: user.phone || undefined,
    email_confirm: !!user.email_confirmed_at,
    phone_confirm: !!user.phone_confirmed_at,
    user_metadata: user.user_metadata || {},
    app_metadata: user.app_metadata || {},
    // Sem senha — usuário precisará usar "Esqueci minha senha"
  };

  const res = await fetch(`${TARGET_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: TARGET_KEY,
      Authorization: `Bearer ${TARGET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    if (txt.includes('already been registered') || txt.includes('duplicate')) {
      return { skipped: true };
    }
    throw new Error(`${res.status}: ${txt}`);
  }
  return { created: true };
}

async function main() {
  console.log(`📥 Listando usuários em ${SOURCE_URL}...`);
  const users = await listUsers();
  console.log(`   ${users.length} usuários encontrados\n`);

  let created = 0, skipped = 0, failed = 0;
  for (const u of users) {
    try {
      const r = await createUserOnTarget(u);
      if (r.created) {
        created++;
        console.log(`  ✅ ${u.email}`);
      } else {
        skipped++;
        console.log(`  ⏭️  ${u.email} (já existe)`);
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ ${u.email}: ${e.message}`);
    }
  }

  console.log(`\n✅ Concluído: ${created} criados, ${skipped} pulados, ${failed} falharam`);
  console.log(`\n⚠️  IMPORTANTE: Os usuários precisam usar "Esqueci minha senha" no novo sistema,`);
  console.log(`   pois os hashes de senha NÃO são migráveis via Admin API.`);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
