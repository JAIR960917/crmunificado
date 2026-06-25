import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Authenticate caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Não autorizado" }, 401);

  const token = authHeader.replace("Bearer ", "");
  const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
  if (!caller) return jsonResponse({ error: "Não autorizado" }, 401);

  // Get caller roles
  const { data: callerRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id);

  const isAdmin = callerRoles?.some((r) => r.role === "admin");
  const isGerente = callerRoles?.some((r) => r.role === "gerente");

  if (!isAdmin && !isGerente) {
    return jsonResponse({ error: "Sem permissão" }, 403);
  }

  const { action, target_user_id, full_name, email, new_password, role, company_id, extra_company_ids } = await req.json();

  if (!action || !target_user_id) {
    return jsonResponse({ error: "action e target_user_id são obrigatórios" }, 400);
  }

  // Prevent self-deletion
  if (action === "delete" && target_user_id === caller.id) {
    return jsonResponse({ error: "Não é possível excluir a si mesmo" }, 400);
  }

  // Get target user's profile to check company
  const { data: targetProfile } = await supabaseAdmin
    .from("profiles")
    .select("company_id, user_id")
    .eq("user_id", target_user_id)
    .single();

  if (!targetProfile) {
    return jsonResponse({ error: "Usuário não encontrado" }, 404);
  }

  // Get target user's roles
  const { data: targetRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", target_user_id);

  const targetIsAdmin = targetRoles?.some((r) => r.role === "admin");

  // Gerente scope checks
  if (isGerente && !isAdmin) {
    // Gerentes cannot manage admins
    if (targetIsAdmin) {
      return jsonResponse({ error: "Gerentes não podem gerenciar administradores" }, 403);
    }

    // Gerentes can only manage users in their company
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("company_id")
      .eq("user_id", caller.id)
      .single();

    if (
      !callerProfile?.company_id ||
      !targetProfile.company_id ||
      callerProfile.company_id !== targetProfile.company_id
    ) {
      return jsonResponse({ error: "Usuário não pertence à sua empresa" }, 403);
    }
  }

  // ── DELETE ──
  if (action === "delete") {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(target_user_id);
    if (error) return jsonResponse({ error: "Falha ao excluir usuário" }, 400);
    // Profile and roles are cascade-deleted
    return jsonResponse({ message: "Usuário excluído" });
  }

  // ── UPDATE PROFILE ──
  if (action === "update") {
    const updates: Record<string, unknown> = {};
    if (typeof full_name === "string" && full_name.trim().length > 0 && full_name.length <= 100) {
      updates.full_name = full_name.trim();
    }
    if (typeof email === "string" && email.trim().length > 0 && email.length <= 255) {
      updates.email = email.trim().toLowerCase();
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("user_id", target_user_id);
      if (error) return jsonResponse({ error: "Falha ao atualizar perfil" }, 400);
    }

    // Update auth email if changed
    if (typeof email === "string" && email.trim().length > 0) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(target_user_id, {
        email: email.trim().toLowerCase(),
      });
      if (error) return jsonResponse({ error: "Falha ao atualizar email de autenticação" }, 400);
    }

    // Update role if provided (admin only, or gerente for non-admin/non-financeiro)
    if (role) {
      const { data: roleDef } = await supabaseAdmin
        .from("role_definitions")
        .select("key, base_role")
        .eq("key", role)
        .maybeSingle();
      if (!roleDef) return jsonResponse({ error: "Papel inválido" }, 400);
      const baseRole = roleDef.base_role as string;
      if (isGerente && !isAdmin && (baseRole === "admin" || baseRole === "financeiro")) {
        return jsonResponse({ error: "Gerentes não podem atribuir papel de admin ou financeiro" }, 403);
      }
      await supabaseAdmin.from("user_roles").delete().eq("user_id", target_user_id);
      await supabaseAdmin.from("user_roles").insert({ user_id: target_user_id, role: baseRole, role_key: roleDef.key });
    }

    // Update company if provided (admin only)
    if (isAdmin && company_id !== undefined) {
      const cid = company_id === null || company_id === "__none__" ? null : company_id;
      await supabaseAdmin.from("profiles").update({ company_id: cid }).eq("user_id", target_user_id);
    }

    // Update extra companies for gerentes (admin only)
    if (isAdmin && Array.isArray(extra_company_ids)) {
      // Remove existing extra companies
      await supabaseAdmin.from("manager_companies").delete().eq("user_id", target_user_id);
      // Insert new ones
      const inserts = extra_company_ids
        .filter((id: string) => id && id !== "__none__")
        .map((cid: string) => ({ user_id: target_user_id, company_id: cid }));
      if (inserts.length > 0) {
        await supabaseAdmin.from("manager_companies").insert(inserts);
      }
    }

    return jsonResponse({ message: "Usuário atualizado" });
  }

  // ── RESET PASSWORD ──
  if (action === "reset_password") {
    if (!new_password || typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128) {
      return jsonResponse({ error: "Senha deve ter entre 8 e 128 caracteres" }, 400);
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(target_user_id, {
      password: new_password,
    });
    if (error) return jsonResponse({ error: "Falha ao alterar senha" }, 400);
    return jsonResponse({ message: "Senha alterada com sucesso" });
  }

  return jsonResponse({ error: "Ação inválida" }, 400);
});
