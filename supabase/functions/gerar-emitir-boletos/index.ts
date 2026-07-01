// Edge Function: gerar-emitir-boletos
// Para um contrato assinado:
// 1) Cria as parcelas no banco (se ainda não existem) com vencimentos mensais
// 2) Para cada parcela pendente, emite um boleto na Cora (mTLS + OAuth2)
// 3) Atualiza a parcela com cora_invoice_id, linha_digitavel, pdf_url, pix...
// Idempotente: usa parcela.id como Idempotency-Key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CORA_BASE = "https://matls-clients.api.cora.com.br";
const CORA_TOKEN_URL = `${CORA_BASE}/token`;
const CORA_INVOICES_URL = `${CORA_BASE}/v2/invoices`;

interface BodyInput {
  contrato_id: string;
  intervalo_dias?: number; // default 30
  primeiro_vencimento?: string; // YYYY-MM-DD (default: hoje + intervalo)
}

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

    // Service client (bypassa RLS para escritas controladas)
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = (await req.json().catch(() => ({}))) as Partial<BodyInput>;
    const contratoId = body.contrato_id;
    if (!contratoId) return json({ ok: false, error: "contrato_id obrigatório" }, 400);
    const intervaloDias = Number.isFinite(body.intervalo_dias) ? Number(body.intervalo_dias) : 30;

    // 1) Carrega contrato (com empresa)
    const { data: contrato, error: contratoErr } = await admin
      .from("crediario_contracts")
      .select("id, user_id, venda_id, status, nome, cpf, company_id")
      .eq("id", contratoId)
      .maybeSingle();
    if (contratoErr || !contrato) return json({ ok: false, error: "Contrato não encontrado" }, 404);
    if (contrato.user_id !== userId) {
      // Permite admin/financeiro/gerente: checa role
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "financeiro", "gerente"]);
      if (!roleRows || roleRows.length === 0) {
        return json({ ok: false, error: "Sem permissão" }, 403);
      }
    }
    if (contrato.status !== "assinado") {
      return json({ ok: false, error: "Contrato precisa estar assinado" }, 400);
    }
    if (!contrato.venda_id) {
      return json({ ok: false, error: "Contrato sem venda vinculada" }, 400);
    }

    // Carrega empresa (credenciais Cora são resolvidas por company_id no banco)
    const empresaSlug: string | null = null;
    if (contrato.company_id) {
      const { data: emp } = await admin
        .from("companies").select("id").eq("id", contrato.company_id).maybeSingle();
      if (!emp) return json({ ok: false, error: "Empresa não encontrada" }, 400);
    }

    // 2) Carrega venda
    const { data: venda, error: vendaErr } = await admin
      .from("crediario_vendas")
      .select("id, user_id, parcelas, valor_parcela, valor_financiado, cpf, nome, primeiro_vencimento, aprovacao_admin")
      .eq("id", contrato.venda_id)
      .maybeSingle();
    if (vendaErr || !venda) return json({ ok: false, error: "Venda não encontrada" }, 404);

    if (venda.aprovacao_admin === "pendente") {
      return json({ ok: false, error: "Venda aguardando autorização do administrador (entrada abaixo do mínimo)" }, 403);
    }
    if (venda.aprovacao_admin === "rejeitada") {
      return json({ ok: false, error: "Venda rejeitada pelo administrador" }, 403);
    }

    // 3) Garante que as parcelas existam no banco
    const { data: existentes } = await admin
      .from("crediario_parcelas")
      .select("id, numero_parcela, status, cora_invoice_id, vencimento, valor")
      .eq("venda_id", venda.id)
      .order("numero_parcela", { ascending: true });

    let parcelas = existentes ?? [];
    if (parcelas.length === 0) {
      // Cria as parcelas — prioridade: body.primeiro_vencimento → venda.primeiro_vencimento → hoje + intervalo
      const vencEscolhido = body.primeiro_vencimento || venda.primeiro_vencimento;
      const baseDate = vencEscolhido
        ? new Date(vencEscolhido + "T00:00:00")
        : addDays(new Date(), intervaloDias);
      const rows: any[] = [];
      for (let i = 1; i <= venda.parcelas; i++) {
        const venc = i === 1 ? baseDate : addMonthsKeepDay(baseDate, i - 1);
        rows.push({
          user_id: venda.user_id,
          venda_id: venda.id,
          contrato_id: contrato.id,
          company_id: contrato.company_id,
          numero_parcela: i,
          total_parcelas: venda.parcelas,
          valor: Number(venda.valor_parcela),
          vencimento: venc.toISOString().slice(0, 10),
          status: "pendente",
        });
      }
      const { data: criadas, error: parcelaErr } = await admin
        .from("crediario_parcelas")
        .insert(rows)
        .select("id, numero_parcela, status, cora_invoice_id, vencimento, valor")
        .order("numero_parcela", { ascending: true });
      if (parcelaErr) return json({ ok: false, error: `Erro criando parcelas: ${parcelaErr.message}` }, 500);
      parcelas = criadas ?? [];
    }

    // 4) Setup mTLS Cora — tenta credenciais salvas no banco (por desenvolvedor),
    //    senão usa secrets por slug, senão fallback global
    let dbCreds: { cora_client_id: string | null; cora_certificate: string | null; cora_private_key: string | null } | null = null;
    if (contrato.company_id) {
      const { data } = await admin
        .from("crediario_company_credentials")
        .select("cora_client_id, cora_certificate, cora_private_key")
        .eq("company_id", contrato.company_id)
        .maybeSingle();
      dbCreds = data ?? null;
    }
    const suffix = empresaSlug ? `_${empresaSlug}` : "";
    const clientId = dbCreds?.cora_client_id || Deno.env.get(`CORA_CLIENT_ID${suffix}`) || Deno.env.get("CORA_CLIENT_ID");
    const certPem  = dbCreds?.cora_certificate || Deno.env.get(`CORA_CERTIFICATE${suffix}`) || Deno.env.get("CORA_CERTIFICATE");
    const keyPem   = dbCreds?.cora_private_key || Deno.env.get(`CORA_PRIVATE_KEY${suffix}`) || Deno.env.get("CORA_PRIVATE_KEY");
    if (!clientId || !certPem || !keyPem) {
      return json({ ok: false, error: `Credenciais Cora ausentes${empresaSlug ? ` para empresa ${empresaSlug}` : ""}` }, 500);
    }

    const httpClient = buildMtlsClient(certPem, keyPem);
    if (!httpClient) return json({ ok: false, error: "Falha mTLS (certificado/chave)" }, 500);

    // Token
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

    // Carrega configurações de cobrança (juros/multa/desconto)
    const { data: settingsRow } = await admin
      .from("crediario_settings")
      .select("cora_interest_monthly_percent, cora_fine_percent, cora_discount_percent")
      .limit(1)
      .maybeSingle();
    const jurosMensal = Number(settingsRow?.cora_interest_monthly_percent ?? 0);
    const multaPercent = Number(settingsRow?.cora_fine_percent ?? 0);
    const descontoPercent = Number(settingsRow?.cora_discount_percent ?? 0);

    // 5) Emite cada parcela pendente (sem cora_invoice_id)
    const results: any[] = [];
    for (const p of parcelas) {
      if (p.cora_invoice_id) {
        results.push({ numero: p.numero_parcela, ok: true, skipped: true, invoice_id: p.cora_invoice_id });
        continue;
      }

      const valorCentavos = Math.round(Number(p.valor) * 100);
      if (valorCentavos < 500) {
        await admin.from("crediario_parcelas").update({
          status: "erro",
          erro_mensagem: "Valor mínimo Cora R$ 5,00",
        }).eq("id", p.id);
        results.push({ numero: p.numero_parcela, ok: false, error: "valor < R$ 5,00" });
        continue;
      }

      const payload: any = {
        code: `V${venda.id.slice(0, 8)}-P${p.numero_parcela}`,
        customer: {
          name: venda.nome || contrato.nome,
          document: { identity: (venda.cpf || contrato.cpf).replace(/\D/g, ""), type: "CPF" },
        },
        services: [
          {
            name: `Parcela ${p.numero_parcela}/${venda.parcelas}`,
            description: `Parcela ${p.numero_parcela} de ${venda.parcelas}`,
            amount: valorCentavos,
          },
        ],
        payment_terms: buildCoraPaymentTerms(p.vencimento, multaPercent, jurosMensal, descontoPercent),
        payment_forms: ["BANK_SLIP", "PIX"],
      };

      try {
        // Tenta emitir com 1 retry automático para o erro de CIP async da Cora.
        // "Bank slip not registered in CIP" = boleto criado mas registro CIP ainda pendente.
        // A Cora garante idempotência pelo p.id, então retentar retorna o mesmo boleto já registrado.
        let invResp: Response | null = null;
        let invText = "";
        let invJson: any = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 4000)); // aguarda CIP registrar
          invResp = await fetch(CORA_INVOICES_URL, {
            method: "POST",
            // @ts-ignore
            client: httpClient,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "Idempotency-Key": p.id,
            },
            body: JSON.stringify(payload),
          });
          invText = await invResp.text();
          try { invJson = JSON.parse(invText); } catch { invJson = null; }

          if (invResp.ok) break;

          // Só retenta para erro de registro CIP — outros erros são definitivos
          const errMsg = (invJson?.message || invJson?.errors?.[0]?.message || invText).toLowerCase();
          const isCipError = errMsg.includes("not registered in cip") || errMsg.includes("cip");
          if (!isCipError) break;
          console.log(`parcela ${p.id} attempt ${attempt + 1} CIP error, retrying...`);
        }

        if (!invResp!.ok) {
          const errMsg = invJson?.message || invJson?.errors?.[0]?.message || invText.slice(0, 300);
          await admin.from("crediario_parcelas").update({
            status: "erro",
            erro_mensagem: errMsg,
          }).eq("id", p.id);
          results.push({ numero: p.numero_parcela, ok: false, error: errMsg });
          continue;
        }

        // Log da resposta completa para diagnóstico de campos Pix
        console.log(`cora invoice response keys: ${Object.keys(invJson ?? {}).join(", ")}`);
        if (invJson?.payment_options) {
          console.log(`payment_options keys: ${Object.keys(invJson.payment_options).join(", ")}`);
          if (invJson.payment_options.pix) {
            console.log(`pix keys: ${Object.keys(invJson.payment_options.pix).join(", ")}`);
          }
        }

        const bankSlip = invJson?.payment_options?.bank_slip ?? invJson?.bank_slip ?? {};
        const pix = invJson?.payment_options?.pix
          ?? invJson?.pix
          ?? invJson?.payment_forms?.pix
          ?? {};

        await admin.from("crediario_parcelas").update({
          cora_invoice_id: invJson?.id ?? null,
          linha_digitavel: bankSlip?.digitable ?? bankSlip?.digitable_line ?? bankSlip?.typed_bar_code ?? null,
          codigo_barras: bankSlip?.barcode ?? bankSlip?.bar_code ?? null,
          pdf_url: bankSlip?.url ?? bankSlip?.pdf_url ?? invJson?.pdf ?? null,
          // Cora pode retornar o EMV Pix em vários campos dependendo da versão da API
          pix_emv: pix?.emv ?? pix?.copy_paste ?? pix?.emv_code ?? pix?.payload ?? pix?.key ?? null,
          pix_qrcode: pix?.qr_code ?? pix?.qr_code_url ?? pix?.qrcode ?? pix?.image ?? pix?.image_url ?? null,
          status: "emitido",
          emitido_em: new Date().toISOString(),
          erro_mensagem: null,
        }).eq("id", p.id);

        results.push({ numero: p.numero_parcela, ok: true, invoice_id: invJson?.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("crediario_parcelas").update({ status: "erro", erro_mensagem: msg }).eq("id", p.id);
        results.push({ numero: p.numero_parcela, ok: false, error: msg });
      }
    }

    const sucessos = results.filter((r) => r.ok && !r.skipped).length;
    const ja_emitidos = results.filter((r) => r.skipped).length;
    const falhas = results.filter((r) => !r.ok).length;

    return json({
      ok: falhas === 0,
      message: `${sucessos} emitidos, ${ja_emitidos} já existiam, ${falhas} falharam`,
      total_parcelas: parcelas.length,
      results,
    });
  } catch (err) {
    console.error("gerar-emitir-boletos error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

// Adiciona N meses preservando o dia do mês original.
// Se o mês destino não tiver esse dia (ex: 31 em fev), usa o último dia do mês.
function addMonthsKeepDay(d: Date, months: number) {
  const day = d.getDate();
  const r = new Date(d);
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Formato payment_terms da API Cora v2 (/v2/invoices). Multa deve ser enviada explicitamente. */
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

function buildMtlsClient(certPem: string, keyPem: string): Deno.HttpClient | null {
  const buildPemCandidates = (raw: string, kind: "cert" | "key") => {
    const out = new Set<string>();
    const add = (v: string | null | undefined) => {
      if (!v) return;
      let s = v.trim();
      if (!s) return;
      s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
      if (!s.endsWith("\n")) s += "\n";
      out.add(s);
    };
    add(raw);
    add(raw.replace(/\\n/g, "\n").replace(/\\r/g, ""));
    try { const p = JSON.parse(raw); if (typeof p === "string") add(p); } catch {}
    const unq = raw.replace(/^['"]|['"]$/g, "");
    if (unq !== raw) add(unq);
    const norm = unq.replace(/\\n/g, "\n").replace(/\\r/g, "");
    if (norm !== raw) add(norm);
    if (!/BEGIN [A-Z ]+/.test(raw)) {
      try { const dec = atob(raw.replace(/\s+/g, "")); if (/BEGIN [A-Z ]+/.test(dec)) add(dec); } catch {}
    }
    const label = kind === "cert" ? "CERTIFICATE" : "(?:RSA |EC |)PRIVATE KEY";
    const m = norm.match(new RegExp(`-----BEGIN ${label}-----\\s*([A-Za-z0-9+/=\\s]+?)\\s*-----END ${label}-----`, "m"));
    if (m) {
      const body = m[1].replace(/\s+/g, "\n");
      const begin = kind === "cert" ? "-----BEGIN CERTIFICATE-----"
        : norm.match(/-----BEGIN ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----BEGIN PRIVATE KEY-----";
      const end = kind === "cert" ? "-----END CERTIFICATE-----"
        : norm.match(/-----END ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----END PRIVATE KEY-----";
      add(`${begin}\n${body}\n${end}\n`);
    }
    return [...out];
  };

  const certs = buildPemCandidates(certPem, "cert");
  const keys = buildPemCandidates(keyPem, "key");
  for (const cert of certs) {
    for (const key of keys) {
      try { return Deno.createHttpClient({ cert, key }); } catch {}
    }
  }
  // Tenta invertido
  const certLooksKey = /BEGIN [A-Z ]*PRIVATE KEY/.test(certPem);
  const keyLooksCert = /BEGIN CERTIFICATE/.test(keyPem);
  if (certLooksKey && keyLooksCert) {
    for (const cert of keys) for (const key of certs) {
      try { return Deno.createHttpClient({ cert, key }); } catch {}
    }
  }
  return null;
}
