// Edge Function: cora-registrar-webhook
// Registra o webhook do nosso sistema na Cora via API POST /endpoints/.
// A Cora NÃO tem painel para configurar webhooks — é feito 100% via API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORA_TOKEN_URL = "https://matls-clients.api.cora.com.br/token";
const CORA_ENDPOINTS_URL = "https://matls-clients.api.cora.com.br/endpoints/";

const WEBHOOK_URL = "https://api-crediario.joonker.com.br/functions/v1/cora-webhook";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    let triggers: string[] = ["paid", "canceled", "overdue"];
    let empresaId: string | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.triggers) && body.triggers.length) triggers = body.triggers;
      if (typeof body?.company_id === "string" && body.company_id) empresaId = body.company_id;
    } catch {
      // sem body
    }

    // Resolve credenciais: 1) banco por empresa, 2) secrets por slug, 3) fallback global
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
    const certPem  = dbCreds?.cora_certificate || Deno.env.get(`CORA_CERTIFICATE${suffix}`) || Deno.env.get("CORA_CERTIFICATE");
    const keyPem   = dbCreds?.cora_private_key || Deno.env.get(`CORA_PRIVATE_KEY${suffix}`) || Deno.env.get("CORA_PRIVATE_KEY");
    if (!clientId || !certPem || !keyPem) {
      return json({ error: `Credenciais Cora ausentes${empresaSlug ? ` para empresa ${empresaSlug}` : ""}` }, 400);
    }

    // Mesma lógica robusta da função cora-emitir-boleto-teste
    const certCandidates = buildPemCandidates(certPem, "cert");
    const keyCandidates = buildPemCandidates(keyPem, "key");
    const certLooksLikeKey = /BEGIN [A-Z ]*PRIVATE KEY/.test(certPem);
    const keyLooksLikeCert = /BEGIN CERTIFICATE/.test(keyPem);

    let httpClient: Deno.HttpClient | null = null;
    let lastErr = "";
    const tryCreate = (cert: string, key: string) => {
      try { return Deno.createHttpClient({ cert, key }); }
      catch (e) { lastErr = e instanceof Error ? e.message : String(e); return null; }
    };
    for (const cert of certCandidates) {
      for (const key of keyCandidates) {
        httpClient = tryCreate(cert, key);
        if (httpClient) break;
      }
      if (httpClient) break;
    }
    if (!httpClient && certLooksLikeKey && keyLooksLikeCert) {
      for (const cert of keyCandidates) {
        for (const key of certCandidates) {
          httpClient = tryCreate(cert, key);
          if (httpClient) break;
        }
        if (httpClient) break;
      }
    }
    if (!httpClient) {
      return json({
        error: `mTLS: ${lastErr || "Não foi possível decodificar o certificado"}`,
        hint: certLooksLikeKey && keyLooksLikeCert
          ? "Os secrets parecem invertidos: CORA_CERTIFICATE contém uma private key e CORA_PRIVATE_KEY contém um certificate."
          : "Verifique CORA_CERTIFICATE e CORA_PRIVATE_KEY (formato PEM completo).",
      }, 400);
    }

    // 1) Token
    const tokenResp = await fetch(CORA_TOKEN_URL, {
      method: "POST",
      // @ts-ignore
      client: httpClient,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId }),
    });
    const tokenText = await tokenResp.text();
    if (!tokenResp.ok) {
      console.error("Cora token error", tokenResp.status, tokenText);
      return json({
        error: "Falha auth Cora",
        status: tokenResp.status,
        body: tokenText.slice(0, 400),
      }, 502);
    }
    const accessToken = JSON.parse(tokenText).access_token as string;

    // 2) Registra um endpoint por trigger
    const results: Array<Record<string, unknown>> = [];
    for (const trigger of triggers) {
      const resp = await fetch(CORA_ENDPOINTS_URL, {
        method: "POST",
        // @ts-ignore
        client: httpClient,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          resource: "invoice",
          trigger,
        }),
      });
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      results.push({ trigger, ok: resp.ok, status: resp.status, response: parsed });
    }

    return json({
      ok: results.every((r) => r.ok),
      webhook_url: WEBHOOK_URL,
      results,
    });
  } catch (err) {
    console.error("cora-registrar-webhook fatal", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPemCandidates(raw: string, kind: "cert" | "key"): string[] {
  const out = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    let s = value.trim();
    if (!s) return;
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    if (!s.endsWith("\n")) s += "\n";
    out.add(s);
  };

  add(raw);
  add(raw.replace(/\\n/g, "\n").replace(/\\r/g, ""));

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") add(parsed);
  } catch { /* ignore */ }

  const unquoted = raw.replace(/^['"]|['"]$/g, "");
  if (unquoted !== raw) add(unquoted);

  const normalizedLiteral = unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "");
  if (normalizedLiteral !== raw) add(normalizedLiteral);

  if (!/BEGIN [A-Z ]+/.test(raw)) {
    try {
      const decoded = atob(raw.replace(/\s+/g, ""));
      if (/BEGIN [A-Z ]+/.test(decoded)) add(decoded);
    } catch { /* ignore */ }
  }

  const label = kind === "cert" ? "CERTIFICATE" : "(?:RSA |EC |)PRIVATE KEY";
  const inlineMatch = normalizedLiteral.match(
    new RegExp(`-----BEGIN ${label}-----\\s*([A-Za-z0-9+/=\\s]+?)\\s*-----END ${label}-----`, "m"),
  );
  if (inlineMatch) {
    const body = inlineMatch[1].replace(/\s+/g, "\n");
    const begin = kind === "cert"
      ? "-----BEGIN CERTIFICATE-----"
      : normalizedLiteral.match(/-----BEGIN ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----BEGIN PRIVATE KEY-----";
    const end = kind === "cert"
      ? "-----END CERTIFICATE-----"
      : normalizedLiteral.match(/-----END ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----END PRIVATE KEY-----";
    add(`${begin}\n${body}\n${end}\n`);
  }

  return [...out];
}
