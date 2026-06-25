// Edge Function: cora-webhook (PÚBLICO — sem JWT)
// Recebe notificações da Cora sobre status de boletos/PIX e atualiza
// a tabela `parcelas` automaticamente. Registra tudo em `cora_webhook_logs`.
//
// Configurar no portal Cora a URL:
//   https://<PROJECT_REF>.functions.supabase.co/cora-webhook
// (opcional) cabeçalho de assinatura HMAC SHA-256 — se configurado, validamos
// usando o segredo CORA_WEBHOOK_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cora-signature, x-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const rawBody = await req.text();
  const headerEventId = req.headers.get("webhook-event-id");
  const headerEventType = req.headers.get("webhook-event-type");
  const headerResourceId = req.headers.get("webhook-resource-id");

  // (Opcional) Valida assinatura HMAC se a Cora estiver enviando
  const secret = Deno.env.get("CORA_WEBHOOK_SECRET");
  const signature = req.headers.get("x-cora-signature") || req.headers.get("x-signature");
  if (secret && signature) {
    const ok = await verifyHmac(rawBody, signature, secret);
    if (!ok) {
      console.warn("Assinatura inválida no webhook Cora");
      return json({ ok: false, error: "Assinatura inválida" }, 401);
    }
  }

  let payload: any = null;
  if (rawBody.trim()) {
    try { payload = JSON.parse(rawBody); } catch {
      return json({ ok: false, error: "JSON inválido" }, 400);
    }
  } else {
    payload = {
      event_id: headerEventId,
      event_type: headerEventType,
      resource_id: headerResourceId,
      source: "headers",
    };
  }

  // Tenta extrair o tipo de evento e o ID da invoice em diferentes formatos
  const eventType: string =
    headerEventType ?? payload?.event ?? payload?.type ?? payload?.event_type ?? "unknown";
  const invoiceId: string | null =
    headerResourceId ?? payload?.invoice?.id ?? payload?.data?.id ?? payload?.id ?? payload?.invoice_id ?? null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Loga primeiro (para auditoria/debug mesmo se algo falhar depois)
  const { data: logRow } = await admin
    .from("crediario_cora_webhook_logs")
    .insert({
      event_type: eventType,
      cora_invoice_id: invoiceId,
      payload,
      processed: false,
    })
    .select("id")
    .single();

  try {
    if (!invoiceId) {
      await markLog(admin, logRow?.id, false, "Sem invoice id no payload");
      return json({ ok: true, ignored: true });
    }

    // Eventos de pagamento da Cora costumam ser:
    //  - invoice.paid / payment.received / charge.paid
    const isPaid = /paid|received|pago|liquidad/i.test(eventType) ||
      /paid|received/i.test(payload?.invoice?.status ?? payload?.status ?? "");

    if (isPaid) {
      const valorPago =
        payload?.payment?.amount ??
        payload?.invoice?.paid_amount ??
        payload?.amount ?? null;

      const pagoEm =
        payload?.paid_at ??
        payload?.payment?.paid_at ??
        payload?.invoice?.paid_at ??
        new Date().toISOString();

      const update: Record<string, unknown> = {
        status: "pago",
        pago_em: pagoEm,
        erro_mensagem: null,
      };
      if (valorPago != null) {
        // Cora envia valores em centavos; convertemos sempre para reais
        update.valor_pago = Number(valorPago) / 100;
      }

      const { data: updated, error: upErr } = await admin
        .from("crediario_parcelas")
        .update(update)
        .eq("cora_invoice_id", invoiceId)
        .select("id");

      if (upErr) {
        await markLog(admin, logRow?.id, false, upErr.message);
        return json({ ok: false, error: upErr.message }, 500);
      }
      if (!updated || updated.length === 0) {
        await markLog(admin, logRow?.id, false, "Nenhuma parcela encontrada");
        return json({ ok: true, ignored: true, reason: "parcela não encontrada" });
      }

      await markLog(admin, logRow?.id, true);
      return json({ ok: true, updated: updated.length });
    }

    // Eventos de cancelamento/expiração
    const isCanceled = /cancel|expir|void/i.test(eventType);
    if (isCanceled) {
      await admin
        .from("crediario_parcelas")
        .update({ status: "cancelado" })
        .eq("cora_invoice_id", invoiceId);
      await markLog(admin, logRow?.id, true);
      return json({ ok: true });
    }

    // Outros eventos: só logamos
    await markLog(admin, logRow?.id, true);
    return json({ ok: true, ignored: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markLog(admin, logRow?.id, false, msg);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markLog(admin: any, id: string | undefined, processed: boolean, err?: string) {
  if (!id) return;
  await admin
    .from("crediario_cora_webhook_logs")
    .update({ processed, error_message: err ?? null })
    .eq("id", id);
}

async function verifyHmac(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const got = signature.replace(/^sha256=/, "").toLowerCase();
    return hex === got;
  } catch {
    return false;
  }
}
