// Edge Function: cora-sincronizar-agendado
// Sincroniza parcelas pagas na Cora, UMA EMPRESA POR VEZ (evita timeout).
// Uso: cron às 06:00 e 13:00 (America/Sao_Paulo) via scripts/cora-sync-agendado.sh
// Auth: admin/desenvolvedor logado, Bearer SERVICE_ROLE_KEY ou x-cron-secret = CRON_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORA_BASE = "https://matls-clients.api.cora.com.br";
const CORA_TOKEN_URL = `${CORA_BASE}/token`;
const CORA_INVOICE_URL = (id: string) => `${CORA_BASE}/v2/invoices/${id}`;

const TIME_BUDGET_MS = Number(Deno.env.get("CORA_SYNC_TIME_BUDGET_MS")) || 55_000;
const PER_EMPRESA_LIMIT = Number(Deno.env.get("CORA_SYNC_PER_EMPRESA_LIMIT")) || 120;
const CONCURRENCY = 5;

interface ParcelaRow {
  id: string;
  company_id: string | null;
  cora_invoice_id: string | null;
  status: string;
}

async function checkAuth(req: Request): Promise<{ ok: boolean; status?: number; error?: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret === cronSecret) return { ok: true };

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorized" };

  const token = auth.slice(7);
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return { ok: true };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (!roles?.some((r) => r.role === "admin" || r.role === "desenvolvedor")) {
    return { ok: false, status: 403, error: "Apenas administradores" };
  }
  return { ok: true };
}

function buildPemCandidates(raw: string): string[] {
  const out = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    let s = value.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!s.endsWith("\n")) s += "\n";
    out.add(s);
  };
  add(raw);
  add(raw.replace(/\\n/g, "\n"));
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") add(parsed);
  } catch { /* ignore */ }
  return [...out];
}

async function createCoraClient(
  admin: ReturnType<typeof createClient>,
  empresaId: string | null,
  empresaSlug: string,
) {
  let dbCreds: {
    cora_client_id?: string | null;
    cora_certificate?: string | null;
    cora_private_key?: string | null;
  } | null = null;

  if (empresaId) {
    const { data } = await admin
      .from("crediario_company_credentials")
      .select("cora_client_id, cora_certificate, cora_private_key")
      .eq("company_id", empresaId)
      .maybeSingle();
    dbCreds = data;
  }

  const suffix = empresaSlug ? `_${empresaSlug}` : "";
  const clientId = dbCreds?.cora_client_id || Deno.env.get(`CORA_CLIENT_ID${suffix}`) || Deno.env.get("CORA_CLIENT_ID");
  const certPem = dbCreds?.cora_certificate || Deno.env.get(`CORA_CERTIFICATE${suffix}`) || Deno.env.get("CORA_CERTIFICATE");
  const keyPem = dbCreds?.cora_private_key || Deno.env.get(`CORA_PRIVATE_KEY${suffix}`) || Deno.env.get("CORA_PRIVATE_KEY");

  if (!clientId || !certPem || !keyPem) {
    throw new Error(`Credenciais Cora ausentes${empresaSlug ? ` (${empresaSlug})` : ""}`);
  }

  let httpClient: Deno.HttpClient | null = null;
  let lastErr = "";
  for (const cert of buildPemCandidates(certPem)) {
    for (const key of buildPemCandidates(keyPem)) {
      try { httpClient = Deno.createHttpClient({ cert, key }); } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      if (httpClient) break;
    }
    if (httpClient) break;
  }
  if (!httpClient) throw new Error(`mTLS: ${lastErr}`);

  const tokenResp = await fetch(CORA_TOKEN_URL, {
    method: "POST",
    // @ts-ignore
    client: httpClient,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId }),
  });
  const tokenText = await tokenResp.text();
  if (!tokenResp.ok) throw new Error(`Auth Cora ${tokenResp.status}: ${tokenText.slice(0, 200)}`);

  return {
    httpClient,
    accessToken: JSON.parse(tokenText).access_token as string,
  };
}

async function sincronizarEmpresa(
  admin: ReturnType<typeof createClient>,
  empresaId: string | null,
  empresaNome: string,
  empresaSlug: string,
): Promise<{ verificadas: number; pagas: number; error?: string }> {
  let q = admin
    .from("crediario_parcelas")
    .select("id, company_id, cora_invoice_id, status")
    .not("cora_invoice_id", "is", null)
    .neq("status", "pago")
    .neq("status", "cancelado")
    .order("updated_at", { ascending: true })
    .limit(PER_EMPRESA_LIMIT);

  q = empresaId ? q.eq("company_id", empresaId) : q.is("company_id", null);

  const { data: parcelas, error: pErr } = await q;
  if (pErr) throw new Error(pErr.message);
  if (!parcelas?.length) return { verificadas: 0, pagas: 0 };

  const { httpClient, accessToken } = await createCoraClient(admin, empresaId, empresaSlug);
  let pagas = 0;

  const processOne = async (p: ParcelaRow) => {
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
        pagas++;
      } else if (/CANCEL|VOID/.test(status)) {
        await admin.from("crediario_parcelas").update({ status: "cancelado" }).eq("id", p.id);
      }
    } catch (e) {
      console.error("cora-sync invoice", empresaNome, p.cora_invoice_id, e);
    }
  };

  for (let i = 0; i < parcelas.length; i += CONCURRENCY) {
    await Promise.all(parcelas.slice(i, i + CONCURRENCY).map(processOne));
  }

  return { verificadas: parcelas.length, pagas };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authResult = await checkAuth(req);
    if (!authResult.ok) return json({ ok: false, error: authResult.error ?? "Unauthorized" }, authResult.status ?? 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const startedAt = Date.now();
    const detalhes: Array<{ empresa: string; verificadas: number; pagas: number; error?: string }> = [];
    let totalVerificadas = 0;
    let totalPagas = 0;
    const erros: string[] = [];

    let empresaIdFilter: string | null | undefined = undefined;
    try {
      const body = await req.json();
      if (body && Object.prototype.hasOwnProperty.call(body, "company_id")) {
        empresaIdFilter = typeof body.company_id === "string" && body.company_id
          ? body.company_id
          : null;
      }
    } catch { /* sem body = todas */ }

    const { data: empresas } = await admin
      .from("companies")
      .select("id, name")
      .order("name");

    let fila: Array<{ id: string | null; nome: string; slug: string }> = [
      ...(empresas ?? []).map((e) => ({ id: e.id, nome: e.name, slug: "" })),
      { id: null, nome: "(sem empresa)", slug: "" },
    ];

    if (empresaIdFilter !== undefined) {
      fila = fila.filter((e) => e.id === empresaIdFilter);
      if (fila.length === 0) {
        return json({ ok: false, error: "Empresa não encontrada ou inativa" }, 404);
      }
    }

    for (const emp of fila) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        erros.push(`Tempo esgotado após ${detalhes.length} empresa(s); próxima execução continua.`);
        break;
      }
      try {
        const r = await sincronizarEmpresa(admin, emp.id, emp.name, "");
        totalVerificadas += r.verificadas;
        totalPagas += r.pagas;
        if (r.verificadas > 0 || r.pagas > 0) {
          detalhes.push({ empresa: emp.name, verificadas: r.verificadas, pagas: r.pagas });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        erros.push(`${emp.name}: ${msg}`);
        detalhes.push({ empresa: emp.name, verificadas: 0, pagas: 0, error: msg });
      }
    }

    return json({
      ok: erros.length === 0,
      empresas_processadas: detalhes.length,
      total_verificadas: totalVerificadas,
      total_pagas: totalPagas,
      detalhes,
      erros,
      duracao_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("cora-sincronizar-agendado fatal", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
