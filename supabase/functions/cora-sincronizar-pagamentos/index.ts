// Edge Function: cora-sincronizar-pagamentos
// Consulta na Cora o status de todas as parcelas com cora_invoice_id
// que ainda não estão pagas/canceladas, e atualiza no banco quando
// constarem como pagas. Útil para recuperar pagamentos que aconteceram
// antes do webhook estar funcionando.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORA_BASE = "https://matls-clients.api.cora.com.br";
const CORA_TOKEN_URL = `${CORA_BASE}/token`;
const CORA_INVOICE_URL = (id: string) => `${CORA_BASE}/v2/invoices/${id}`;

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
    if (!roles?.some((r) => r.role === "admin" || r.role === "desenvolvedor")) {
      return json({ error: "Apenas administradores" }, 403);
    }

    let empresaIdFilter: string | null = null;
    let limit = 200;
    try {
      const body = await req.json();
      if (typeof body?.company_id === "string" && body.company_id) empresaIdFilter = body.company_id;
      if (typeof body?.limit === "number" && body.limit > 0) limit = Math.min(1000, body.limit);
    } catch { /* sem body */ }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Busca parcelas pendentes que tenham cora_invoice_id
    let q = admin
      .from("crediario_parcelas")
      .select("id, company_id, cora_invoice_id, status")
      .not("cora_invoice_id", "is", null)
      .neq("status", "pago")
      .neq("status", "cancelado")
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (empresaIdFilter) q = q.eq("company_id", empresaIdFilter);

    const { data: parcelas, error: pErr } = await q;
    if (pErr) return json({ error: pErr.message }, 500);
    if (!parcelas || parcelas.length === 0) {
      return json({ ok: true, total: 0, atualizadas: 0, message: "Nenhuma parcela pendente com cora_invoice_id." });
    }

    // Agrupa por company_id
    const porEmpresa = new Map<string, typeof parcelas>();
    for (const p of parcelas) {
      const key = p.company_id || "_sem_empresa";
      const arr = porEmpresa.get(key) || [];
      arr.push(p);
      porEmpresa.set(key, arr);
    }

    let totalAtualizadas = 0;
    const erros: Array<{ company_id: string; error: string }> = [];
    const detalhes: Array<{ company_id: string; verificadas: number; pagas: number }> = [];

    for (const [empresaId, lista] of porEmpresa) {
      try {
        // Resolve credenciais
        let dbCreds: any = null;
        let empresaSlug = "";
        if (empresaId !== "_sem_empresa") {
          const [{ data: creds }, { data: emp }] = await Promise.all([
            admin.from("crediario_company_credentials").select("cora_client_id, cora_certificate, cora_private_key").eq("company_id", empresaId).maybeSingle(),
            admin.from("companies").select("name").eq("id", empresaId).maybeSingle(),
          ]);
          dbCreds = creds;
          empresaSlug = emp?.name ?? "";
        }
        const suffix = empresaSlug ? `_${empresaSlug}` : "";
        const clientId = dbCreds?.cora_client_id || Deno.env.get(`CORA_CLIENT_ID${suffix}`) || Deno.env.get("CORA_CLIENT_ID");
        const certPem = dbCreds?.cora_certificate || Deno.env.get(`CORA_CERTIFICATE${suffix}`) || Deno.env.get("CORA_CERTIFICATE");
        const keyPem = dbCreds?.cora_private_key || Deno.env.get(`CORA_PRIVATE_KEY${suffix}`) || Deno.env.get("CORA_PRIVATE_KEY");
        if (!clientId || !certPem || !keyPem) {
          erros.push({ company_id: empresaId, error: `Credenciais Cora ausentes${empresaSlug ? ` (${empresaSlug})` : ""}` });
          continue;
        }

        const certCandidates = buildPemCandidates(certPem, "cert");
        const keyCandidates = buildPemCandidates(keyPem, "key");
        let httpClient: Deno.HttpClient | null = null;
        let lastErr = "";
        for (const cert of certCandidates) {
          for (const key of keyCandidates) {
            try { httpClient = Deno.createHttpClient({ cert, key }); } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
            if (httpClient) break;
          }
          if (httpClient) break;
        }
        if (!httpClient) {
          erros.push({ company_id: empresaId, error: `mTLS: ${lastErr}` });
          continue;
        }

        // Token
        const tokenResp = await fetch(CORA_TOKEN_URL, {
          method: "POST",
          // @ts-ignore
          client: httpClient,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId }),
        });
        const tokenText = await tokenResp.text();
        if (!tokenResp.ok) {
          erros.push({ company_id: empresaId, error: `Auth Cora ${tokenResp.status}: ${tokenText.slice(0, 200)}` });
          continue;
        }
        const accessToken = JSON.parse(tokenText).access_token as string;

        // Consulta invoices em paralelo (10 simultâneas)
        let pagasEmpresa = 0;
        const CONCURRENCY = 10;
        const processOne = async (p: typeof lista[number]) => {
          if (!p.cora_invoice_id) return;
          try {
            const resp = await fetch(CORA_INVOICE_URL(p.cora_invoice_id), {
              method: "GET",
              // @ts-ignore
              client: httpClient,
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            });
            if (!resp.ok) { await resp.text(); return; }
            const inv = await resp.json();
            const status: string = String(inv?.status ?? "").toUpperCase();
            const isPaid = /PAID|RECEIVED|LIQUID/.test(status) ||
              /paid|received|liquid/i.test(inv?.payment_status ?? "");
            if (isPaid) {
              const pagoEm = inv?.paid_at ?? inv?.payment?.paid_at ?? inv?.updated_at ?? new Date().toISOString();
              const valorPagoRaw = inv?.paid_amount ?? inv?.payment?.amount ?? inv?.total_amount ?? null;
              const update: Record<string, unknown> = { status: "pago", pago_em: pagoEm, erro_mensagem: null };
              if (valorPagoRaw != null) update.valor_pago = Number(valorPagoRaw) / 100;
              await admin.from("crediario_parcelas").update(update).eq("id", p.id);
              pagasEmpresa++;
              totalAtualizadas++;
            } else if (/CANCEL|VOID/.test(status)) {
              await admin.from("crediario_parcelas").update({ status: "cancelado" }).eq("id", p.id);
            }
          } catch (e) {
            console.error("erro consulta invoice", p.cora_invoice_id, e);
          }
        };
        for (let i = 0; i < lista.length; i += CONCURRENCY) {
          await Promise.all(lista.slice(i, i + CONCURRENCY).map(processOne));
        }
        detalhes.push({ company_id: empresaId, verificadas: lista.length, pagas: pagasEmpresa });
      } catch (e) {
        erros.push({ company_id: empresaId, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({
      ok: erros.length === 0,
      total: parcelas.length,
      atualizadas: totalAtualizadas,
      detalhes,
      erros,
    });
  } catch (err) {
    console.error("cora-sincronizar-pagamentos fatal", err);
    return json({ error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) }, 500);
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
  return [...out];
}
