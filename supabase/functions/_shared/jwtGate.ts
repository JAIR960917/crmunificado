/** Decodifica role do JWT Supabase (sem verificar assinatura — use após verify no main). */
export function decodeJwtRole(authHeader: string): string | null {
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

/** Serviços públicos (sem JWT de usuário). */
export const JWT_EXEMPT_SERVICES = new Set([
  "whatsapp-webhook",
  "seed-admin",
  "submit-campanha-copa",
  "submit-site-form",
  "ai-agent-reply",
  "ai-agent-schedule-appointment",
  "ai-agent-lookup-appointment",
  "get-company-links",
]);

/** Bloqueia uso da chave anon em funções que exigem usuário ou bootstrap. */
export function rejectAnonJwt(
  req: Request,
  serviceName: string,
): Response | null {
  if (JWT_EXEMPT_SERVICES.has(serviceName)) return null;
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (anonKey && token === anonKey) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        detail: "Chave anon não permitida nesta função. Use sessão de usuário.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const role = decodeJwtRole(authHeader);
  if (role === "anon") {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        detail: "Chave anon não permitida nesta função. Use sessão de usuário.",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}
