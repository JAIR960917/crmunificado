export const internalCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Cron interno ou service_role (chamadas pg_net / edge). */
export function assertCronOrServiceRole(
  req: Request,
  corsHeaders: Record<string, string> = internalCorsHeaders,
): Response | null {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceRole = !!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;

  if (!isServiceRole && (!cronSecret || providedSecret !== cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

type SupabaseAdmin = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: { role: string }[] | null }>;
    };
  };
};

/** Cron/service_role OU usuário autenticado admin/gerente (painel). */
export async function assertCronServiceRoleOrStaff(
  req: Request,
  supabaseAdmin: SupabaseAdmin,
  corsHeaders: Record<string, string> = internalCorsHeaders,
): Promise<Response | null> {
  const cronGate = assertCronOrServiceRole(req, corsHeaders);
  if (!cronGate) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return cronGate;

  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return cronGate;

  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const allowed = (roles || []).some((r) => r.role === "admin" || r.role === "gerente");
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
