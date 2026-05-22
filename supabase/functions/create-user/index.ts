import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Verify caller is authenticated
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
  if (!caller) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Check caller role
  const { data: callerRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id);

  const isAdmin = callerRoles?.some((r) => r.role === "admin");
  const isGerente = callerRoles?.some((r) => r.role === "gerente");

  if (!isAdmin && !isGerente) {
    return new Response(JSON.stringify({ error: "Sem permissão para criar usuários" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { email, password, full_name, role, company_id, extra_company_ids } = await req.json();

  if (!email || !password || !role) {
    return new Response(JSON.stringify({ error: "Email, senha e papel são obrigatórios" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve role (pode ser key de função nativa ou customizada)
  const { data: roleDef } = await supabaseAdmin
    .from("role_definitions")
    .select("key, base_role")
    .eq("key", role)
    .maybeSingle();

  if (!roleDef) {
    return new Response(JSON.stringify({ error: "Papel inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const baseRole = roleDef.base_role as string;
  const roleKey = roleDef.key as string;

  if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length < 8 || password.length > 128) {
    return new Response(JSON.stringify({ error: "Email ou senha inválidos" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (isGerente && !isAdmin && (baseRole === "admin" || baseRole === "financeiro")) {
    return new Response(JSON.stringify({ error: "Gerentes não podem criar administradores ou financeiros" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get gerente's company_id
  let companyId: string | null = null;
  if (isGerente && !isAdmin) {
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("user_id", caller.id)
      .single();
    companyId = callerProfile?.company_id || null;
    if (!companyId) {
      return new Response(JSON.stringify({ error: "Gerente não está alocado a nenhuma empresa" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Create user
  const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name || "" },
  });

  if (error) {
    const safeMessage = error.message?.includes("already been registered")
      ? "Este email já está cadastrado"
      : "Falha ao criar usuário";
    return new Response(JSON.stringify({ error: safeMessage }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Assign role
  await supabaseAdmin.from("user_roles").insert({
    user_id: newUser.user.id,
    role,
  });

  // If created by gerente, auto-assign to same company
  // If admin provided a company_id, use that instead
  const finalCompanyId = isAdmin && company_id ? company_id : companyId;
  if (finalCompanyId) {
    await supabaseAdmin
      .from("profiles")
      .update({ company_id: finalCompanyId })
      .eq("user_id", newUser.user.id);
  }

  // Insert extra companies for gerentes (admin only)
  if (isAdmin && Array.isArray(extra_company_ids) && extra_company_ids.length > 0) {
    const inserts = extra_company_ids
      .filter((id: string) => id && id !== "__none__")
      .map((cid: string) => ({ user_id: newUser.user.id, company_id: cid }));
    if (inserts.length > 0) {
      await supabaseAdmin.from("manager_companies").insert(inserts);
    }
  }

  return new Response(JSON.stringify({ message: "Usuário criado", userId: newUser.user.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
