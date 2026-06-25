// Edge Function: cora-listar-webhooks
// Lista os webhooks (endpoints) atualmente registrados na Cora.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CORA_TOKEN_URL = "https://matls-clients.api.cora.com.br/token";
const CORA_ENDPOINTS_URL = "https://matls-clients.api.cora.com.br/endpoints/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!roles?.some((r) => r.role === "admin")) {
      return json({ error: "Apenas administradores" }, 403);
    }

    let empresaId: string | null = null;
    try {
      const body = await req.json();
      if (typeof body?.company_id === "string" && body.company_id) empresaId = body.company_id;
    } catch { /* sem body */ }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let dbCreds: { cora_client_id: string | null; cora_certificate: string | null; cora_private_key: string | null } | null = null;
    let empresaSlug = "";
    if (empresaId) {
      const [{ data: creds }, { data: emp }] = await Promise.all([
        admin.from("crediario_company_credentials").select("cora_client_id, cora_certificate, cora_private_key").eq("company_id", empresaId).maybeSingle(),
        admin.from("companies").select("name").eq("id", empresaId).maybeSingle(),
      ]);
      dbCreds = creds ?? null;
      empresaSlug = emp?.name ?? "";
    }
    const suffix = empresaSlug ? `_${empresaSlug}` : "";
    const clientId = dbCreds?.cora_client_id || Deno.env.get(`CORA_CLIENT_ID${suffix}`) || Deno.env.get("CORA_CLIENT_ID");
    const certPem = dbCreds?.cora_certificate || Deno.env.get(`CORA_CERTIFICATE${suffix}`) || Deno.env.get("CORA_CERTIFICATE");
    const keyPem = dbCreds?.cora_private_key || Deno.env.get(`CORA_PRIVATE_KEY${suffix}`) || Deno.env.get("CORA_PRIVATE_KEY");
    if (!clientId || !certPem || !keyPem) {
      return json({ error: `Credenciais Cora ausentes${empresaSlug ? ` para empresa ${empresaSlug}` : ""}` }, 400);
    }

    const client = buildMtlsClient(certPem, keyPem);
    if (!client) return json({ error: "Falha mTLS" }, 500);

    const tokenResp = await fetch(CORA_TOKEN_URL, {
      method: "POST",
      // @ts-ignore
      client,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId }),
    });
    if (!tokenResp.ok) {
      return json({ error: "Falha auth Cora", status: tokenResp.status }, 502);
    }
    const accessToken = (await tokenResp.json()).access_token as string;

    const resp = await fetch(CORA_ENDPOINTS_URL, {
      method: "GET",
      // @ts-ignore
      client,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    return json({ ok: resp.ok, status: resp.status, endpoints: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildMtlsClient(certRaw: string, keyRaw: string): Deno.HttpClient | null {
  const norm = (s: string) => s.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim() + "\n";
  for (const cert of [norm(certRaw), certRaw]) {
    for (const key of [norm(keyRaw), keyRaw]) {
      try { return Deno.createHttpClient({ cert, key }); } catch { /* */ }
    }
  }
  return null;
}
