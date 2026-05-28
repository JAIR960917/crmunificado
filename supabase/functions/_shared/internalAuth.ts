export const internalCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function decodeJwtRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded));
    return typeof json?.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

/**
 * Apenas cron interno (x-cron-secret) ou JWT com role=service_role.
 * Rejeita anon/authenticated mesmo que a chave seja válida no Kong.
 */
export function assertCronOrServiceRole(
  req: Request,
  corsHeaders: Record<string, string> = internalCorsHeaders,
): Response | null {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  if (cronSecret && providedSecret && providedSecret === cronSecret) {
    return null;
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwtRole = decodeJwtRole(authHeader);
  if (jwtRole === "service_role") {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: "Unauthorized",
      detail: "Requer JWT service_role ou header x-cron-secret",
    }),
    {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
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
