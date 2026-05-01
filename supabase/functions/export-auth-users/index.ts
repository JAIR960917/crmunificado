// Edge function temporária para exportar usuários do auth.users em JSON
// Protegida por uma senha passada via header x-export-password
// Após a migração, DELETE esta função.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-export-password",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Senha simples para evitar acesso anônimo (troque antes de usar!)
    const EXPORT_PASSWORD = "migrate-crm-2026-vps";
    const provided = req.headers.get("x-export-password") ?? new URL(req.url).searchParams.get("password");

    if (provided !== EXPORT_PASSWORD) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Forneça x-export-password no header ou ?password= na URL." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Lista usuários via Admin API (paginado)
    const allUsers: any[] = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data.users ?? [];
      allUsers.push(...users);
      if (users.length < perPage) break;
      page++;
      if (page > 50) break; // safety
    }

    // 2) Busca password hashes direto do auth.users (Admin API não retorna)
    //    Usamos uma query SQL via REST PostgREST não funciona pra schema auth,
    //    então fazemos via fetch direto no endpoint do postgres? Não.
    //    Solução: usar rpc não dá. Vamos fazer SELECT via supabase-js com schema 'auth'? Não exposto.
    //    Alternativa: criar função SECURITY DEFINER que retorna os hashes.
    const { data: hashRows, error: hashErr } = await admin
      .schema("public" as any)
      .rpc("_export_auth_password_hashes");

    if (hashErr) {
      // Função ainda não criada — retorna usuários sem hash e instrui
      return new Response(
        JSON.stringify({
          warning:
            "Função _export_auth_password_hashes não existe. Crie-a via migration para incluir os hashes de senha.",
          users_count: allUsers.length,
          users: allUsers.map((u) => ({
            id: u.id,
            email: u.email,
            phone: u.phone,
            email_confirmed_at: u.email_confirmed_at,
            phone_confirmed_at: u.phone_confirmed_at,
            created_at: u.created_at,
            updated_at: u.updated_at,
            last_sign_in_at: u.last_sign_in_at,
            raw_user_meta_data: u.user_metadata,
            raw_app_meta_data: u.app_metadata,
            is_super_admin: (u as any).is_super_admin ?? false,
            role: (u as any).role ?? "authenticated",
            aud: u.aud ?? "authenticated",
          })),
        }, null, 2),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hashMap = new Map<string, any>();
    for (const r of (hashRows as any[]) ?? []) hashMap.set(r.id, r);

    const exported = allUsers.map((u) => {
      const h = hashMap.get(u.id) ?? {};
      return {
        id: u.id,
        email: u.email,
        phone: u.phone,
        encrypted_password: h.encrypted_password ?? null,
        email_confirmed_at: u.email_confirmed_at,
        phone_confirmed_at: u.phone_confirmed_at,
        confirmation_token: h.confirmation_token ?? "",
        recovery_token: h.recovery_token ?? "",
        email_change_token_new: h.email_change_token_new ?? "",
        email_change: h.email_change ?? "",
        created_at: u.created_at,
        updated_at: u.updated_at,
        last_sign_in_at: u.last_sign_in_at,
        raw_user_meta_data: u.user_metadata ?? {},
        raw_app_meta_data: u.app_metadata ?? {},
        is_super_admin: (u as any).is_super_admin ?? false,
        role: (u as any).role ?? "authenticated",
        aud: u.aud ?? "authenticated",
        instance_id: h.instance_id ?? "00000000-0000-0000-0000-000000000000",
      };
    });

    return new Response(
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          count: exported.length,
          users: exported,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="auth-users-export.json"',
        },
      }
    );
  } catch (e: any) {
    console.error("export-auth-users error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
