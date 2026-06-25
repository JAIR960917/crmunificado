// Edge Function: sincronizar-status-boletos
// Para um contrato (ou venda), busca todas as parcelas com cora_invoice_id
// e consulta GET /v2/invoices/{id} na Cora para atualizar o status local.
// Útil quando o webhook da Cora ainda não está configurado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CORA_BASE = "https://matls-clients.api.cora.com.br";
const CORA_TOKEN_URL = `${CORA_BASE}/token`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = (await req.json().catch(() => ({}))) as { contrato_id?: string; venda_id?: string };
    if (!body.contrato_id && !body.venda_id) {
      return json({ ok: false, error: "contrato_id ou venda_id obrigatório" }, 400);
    }

    // Carrega parcelas com cora_invoice_id
    let q = admin
      .from("crediario_parcelas")
      .select("id, numero_parcela, status, cora_invoice_id, user_id")
      .not("cora_invoice_id", "is", null);
    if (body.contrato_id) q = q.eq("contrato_id", body.contrato_id);
    else if (body.venda_id) q = q.eq("venda_id", body.venda_id);

    const { data: parcelas, error: parcelaErr } = await q;
    if (parcelaErr) return json({ ok: false, error: parcelaErr.message }, 500);
    if (!parcelas || parcelas.length === 0) {
      return json({ ok: true, message: "Nenhuma parcela emitida para sincronizar", updated: 0 });
    }

    // Checa permissão (dono ou admin)
    const isOwner = parcelas.every((p) => p.user_id === userId);
    if (!isOwner) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) return json({ ok: false, error: "Sem permissão" }, 403);
    }

    // Setup mTLS Cora
    const clientId = Deno.env.get("CORA_CLIENT_ID");
    const certPem = Deno.env.get("CORA_CERTIFICATE");
    const keyPem = Deno.env.get("CORA_PRIVATE_KEY");
    if (!clientId || !certPem || !keyPem) return json({ ok: false, error: "Secrets Cora ausentes" }, 500);

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
    if (!httpClient) return json({ ok: false, error: `mTLS: ${lastErr || "Não foi possível decodificar o certificado"}` }, 500);

    const tokenResp = await fetch(CORA_TOKEN_URL, {
      method: "POST",
      // @ts-ignore
      client: httpClient,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId }),
    });
    const tokenText = await tokenResp.text();
    if (!tokenResp.ok) return json({ ok: false, error: `Auth Cora: ${tokenText.slice(0, 300)}` }, 502);
    const accessToken = JSON.parse(tokenText).access_token as string;

    let atualizadas = 0;
    const detalhes: any[] = [];

    for (const p of parcelas) {
      try {
        const r = await fetch(`${CORA_BASE}/v2/invoices/${p.cora_invoice_id}`, {
          method: "GET",
          // @ts-ignore
          client: httpClient,
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        const txt = await r.text();
        let inv: any = null;
        try { inv = JSON.parse(txt); } catch {}
        if (!r.ok) {
          detalhes.push({ numero: p.numero_parcela, ok: false, error: txt.slice(0, 200) });
          continue;
        }

        const remoteStatus = String(inv?.status ?? "").toUpperCase();
        const isPaid = /PAID|RECEIVED|PAGO|LIQUIDAD/i.test(remoteStatus) ||
          /PAID|RECEIVED/i.test(String(inv?.payment?.status ?? ""));
        const isCanceled = /CANCEL|EXPIR|VOID/i.test(remoteStatus);

        let newStatus = p.status;
        const update: Record<string, unknown> = {};

        if (isPaid && p.status !== "pago") {
          newStatus = "pago";
          update.status = "pago";
          update.pago_em = inv?.paid_at ?? inv?.payment?.paid_at ?? new Date().toISOString();
          const v = inv?.payment?.amount ?? inv?.paid_amount;
          if (v != null) update.valor_pago = Number(v) / 100;
        } else if (isCanceled && p.status !== "cancelado") {
          newStatus = "cancelado";
          update.status = "cancelado";
        }

        if (Object.keys(update).length > 0) {
          await admin.from("crediario_parcelas").update(update).eq("id", p.id);
          atualizadas++;
        }
        detalhes.push({ numero: p.numero_parcela, ok: true, status: newStatus });
      } catch (e) {
        detalhes.push({ numero: p.numero_parcela, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({
      ok: true,
      message: `${atualizadas} parcela(s) atualizada(s) de ${parcelas.length} consultada(s)`,
      updated: atualizadas,
      total: parcelas.length,
      detalhes,
    });
  } catch (err) {
    console.error("sincronizar-status-boletos error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
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
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (!s.endsWith("\n")) s += "\n";
    out.add(s);
  };

  add(raw);
  add(raw.replace(/\\n/g, "\n").replace(/\\r/g, ""));

  try { const parsed = JSON.parse(raw); if (typeof parsed === "string") add(parsed); } catch {}

  const unquoted = raw.replace(/^['"]|['"]$/g, "");
  if (unquoted !== raw) add(unquoted);

  const normalizedLiteral = unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "");
  if (normalizedLiteral !== raw) add(normalizedLiteral);

  if (!/BEGIN [A-Z ]+/.test(raw)) {
    try {
      const decoded = atob(raw.replace(/\s+/g, ""));
      if (/BEGIN [A-Z ]+/.test(decoded)) add(decoded);
    } catch {}
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
