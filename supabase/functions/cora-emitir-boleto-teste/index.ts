// Edge Function: cora-emitir-boleto-teste
// Emite 1 boleto de teste na Cora usando mTLS + OAuth2 client_credentials.
// NÃO persiste em parcelas/vendas — é apenas para validar o fluxo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CORA_BASE = "https://matls-clients.api.cora.com.br";
const CORA_TOKEN_URL = `${CORA_BASE}/token`;
const CORA_INVOICES_URL = `${CORA_BASE}/v2/invoices`;

interface BoletoInput {
  nome: string;
  cpf: string;
  email?: string;
  valor: number; // em reais
  vencimento: string; // YYYY-MM-DD
  descricao?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<BoletoInput>;
    const nome = (body.nome ?? "").trim();
    const cpf = (body.cpf ?? "").replace(/\D/g, "");
    const email = (body.email ?? "").trim();
    const valor = Number(body.valor);
    const vencimento = (body.vencimento ?? "").trim();
    const descricao = (body.descricao ?? "Boleto de teste").trim();

    const errors: string[] = [];
    if (!nome) errors.push("nome obrigatório");
    if (cpf.length !== 11) errors.push("cpf inválido (11 dígitos)");
    if (!Number.isFinite(valor) || valor < 5) errors.push("valor mínimo R$ 5,00 (exigido pela Cora)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) errors.push("vencimento deve ser YYYY-MM-DD");
    if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);

    // Auth Cora (mesma lógica robusta do cora-auth-test)
    const clientId = Deno.env.get("CORA_CLIENT_ID");
    const certPem = Deno.env.get("CORA_CERTIFICATE");
    const keyPem = Deno.env.get("CORA_PRIVATE_KEY");
    if (!clientId || !certPem || !keyPem) {
      return json({ ok: false, error: "Secrets Cora ausentes" }, 400);
    }

    const buildPemCandidates = (raw: string, kind: "cert" | "key") => {
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
      } catch {
        // ignore
      }

      const unquoted = raw.replace(/^['"]|['"]$/g, "");
      if (unquoted !== raw) add(unquoted);

      const normalizedLiteral = unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "");
      if (normalizedLiteral !== raw) add(normalizedLiteral);

      if (!/BEGIN [A-Z ]+/.test(raw)) {
        try {
          const decoded = atob(raw.replace(/\s+/g, ""));
          if (/BEGIN [A-Z ]+/.test(decoded)) add(decoded);
        } catch {
          // ignore
        }
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
    };

    const certCandidates = buildPemCandidates(certPem, "cert");
    const keyCandidates = buildPemCandidates(keyPem, "key");

    const certLooksLikeKey = /BEGIN [A-Z ]*PRIVATE KEY/.test(certPem);
    const keyLooksLikeCert = /BEGIN CERTIFICATE/.test(keyPem);

    let client: Deno.HttpClient | null = null;
    let lastErr = "";

    const tryCreateClient = (cert: string, key: string) => {
      try {
        return Deno.createHttpClient({ cert, key });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        return null;
      }
    };

    for (const cert of certCandidates) {
      for (const key of keyCandidates) {
        client = tryCreateClient(cert, key);
        if (client) break;
      }
      if (client) break;
    }

    if (!client && certLooksLikeKey && keyLooksLikeCert) {
      for (const cert of keyCandidates) {
        for (const key of certCandidates) {
          client = tryCreateClient(cert, key);
          if (client) break;
        }
        if (client) break;
      }
    }

    if (!client) {
      return json(
        {
          ok: false,
          error: `mTLS: ${lastErr || "Unable to decode certificate"}`,
          hint: certLooksLikeKey && keyLooksLikeCert
            ? "Os secrets parecem invertidos: CORA_CERTIFICATE contém uma private key e CORA_PRIVATE_KEY contém um certificate."
            : "Os secrets não estão em PEM válido. Cole o conteúdo exato dos arquivos certificate.pem e private-key.key, incluindo BEGIN/END.",
          cert_candidates: certCandidates.length,
          key_candidates: keyCandidates.length,
          cert_first_line: certCandidates[0]?.split("\n")[0] ?? null,
          key_first_line: keyCandidates[0]?.split("\n")[0] ?? null,
        },
        200,
      );
    }

    // Token
    const tokenResp = await fetch(CORA_TOKEN_URL, {
      method: "POST",
      // @ts-ignore Deno HttpClient
      client,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
      }),
    });
    const tokenText = await tokenResp.text();
    if (!tokenResp.ok) {
      return json({ ok: false, error: `Auth Cora: ${tokenText.slice(0, 300)}` }, 502);
    }
    const tokenJson = JSON.parse(tokenText);
    const accessToken = tokenJson.access_token as string;

    // Idempotency-Key (UUID)
    const idempotencyKey = crypto.randomUUID();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: settingsRow } = await admin
      .from("crediario_settings")
      .select("cora_interest_monthly_percent, cora_fine_percent, cora_discount_percent")
      .limit(1)
      .maybeSingle();
    const jurosMensal = Number(settingsRow?.cora_interest_monthly_percent ?? 0);
    const multaPercent = Number(settingsRow?.cora_fine_percent ?? 0);
    const descontoPercent = Number(settingsRow?.cora_discount_percent ?? 0);

    // Payload conforme docs Cora v2: https://developers.cora.com.br/reference/emissão-de-boleto-registrado-v2
    const valorCentavos = Math.round(valor * 100);
    const invoicePayload = {
      code: `TESTE-${Date.now()}`,
      customer: {
        name: nome,
        email: email || undefined,
        document: { identity: cpf, type: "CPF" },
      },
      services: [
        {
          name: descricao,
          description: descricao,
          amount: valorCentavos,
        },
      ],
      payment_terms: buildCoraPaymentTerms(vencimento, multaPercent, jurosMensal, descontoPercent),
      payment_forms: ["BANK_SLIP", "PIX"],
      notifications: email
        ? {
            channels: ["EMAIL"],
            destination: { email },
            rules: ["NOTIFY_ON_DUE_DATE"],
          }
        : undefined,
    };

    const started = Date.now();
    const invResp = await fetch(CORA_INVOICES_URL, {
      method: "POST",
      // @ts-ignore Deno HttpClient
      client,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(invoicePayload),
    });
    const elapsed = Date.now() - started;
    const invText = await invResp.text();
    let invJson: any = null;
    try { invJson = JSON.parse(invText); } catch {}

    if (!invResp.ok) {
      console.error("Cora invoice failed", { status: invResp.status, body: invText.slice(0, 800) });
      return json(
        {
          ok: false,
          status: invResp.status,
          elapsed_ms: elapsed,
          error: invJson?.message || invJson?.error || invText.slice(0, 400),
          raw: invJson,
        },
        200,
      );
    }

    // Extrai campos úteis
    const bankSlip = invJson?.payment_options?.bank_slip ?? invJson?.bank_slip ?? {};
    const pix = invJson?.payment_options?.pix ?? invJson?.pix ?? {};

    return json({
      ok: true,
      message: "Boleto de teste emitido com sucesso! ✅",
      elapsed_ms: elapsed,
      invoice_id: invJson?.id ?? null,
      code: invJson?.code ?? null,
      status: invJson?.status ?? null,
      total_amount: invJson?.total_amount ?? valorCentavos,
      due_date: invJson?.payment_terms?.due_date ?? vencimento,
      pdf_url: bankSlip?.url ?? invJson?.pdf ?? null,
      digitable_line: bankSlip?.digitable ?? bankSlip?.digitable_line ?? null,
      barcode: bankSlip?.barcode ?? null,
      pix_emv: pix?.emv ?? null,
      pix_qrcode: pix?.qr_code ?? null,
      raw: invJson,
    });
  } catch (err) {
    console.error("cora-emitir-boleto-teste error", err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildCoraPaymentTerms(
  dueDate: string,
  multaPercent: number,
  jurosMensal: number,
  descontoPercent: number,
) {
  const payment_terms: Record<string, unknown> = {
    due_date: dueDate,
    fine: { rate: multaPercent },
  };
  if (jurosMensal > 0) payment_terms.interest = { rate: jurosMensal };
  if (descontoPercent > 0) {
    payment_terms.discount = { type: "PERCENT", value: descontoPercent };
  }
  return payment_terms;
}
