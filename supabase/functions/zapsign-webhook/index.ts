// Edge Function: zapsign-webhook
// Recebe eventos do ZapSign (doc_signed, doc_refused, doc_created, doc_deleted).
// Validação opcional via header customizado (ZAPSIGN_WEBHOOK_SECRET) configurado na ZapSign.
//
// Quando doc_signed: marca contrato como "assinado" e salva signed_file em signature_data.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-zapsign-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const expectedSecret = Deno.env.get("ZAPSIGN_WEBHOOK_SECRET");
    if (expectedSecret && expectedSecret !== "disabled") {
      const provided = req.headers.get("x-zapsign-secret") ??
        req.headers.get("X-Zapsign-Secret") ??
        new URL(req.url).searchParams.get("secret");
      if (provided !== expectedSecret) {
        console.warn("zapsign-webhook: secret inválido");
        return json({ ok: false, error: "Invalid secret" }, 401);
      }
    }

    const payload: any = await req.json().catch(() => null);
    if (!payload) return json({ ok: false, error: "Invalid JSON" }, 400);

    console.info("zapsign-webhook event", payload?.event_type, "token", payload?.token);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const eventType: string = String(payload?.event_type ?? "").toLowerCase();
    const docToken: string | null = payload?.token ?? payload?.doc?.token ?? null;
    const externalId: string | null = payload?.external_id ?? payload?.doc?.external_id ?? null;
    const signedFile: string | null = payload?.signed_file ?? payload?.doc?.signed_file ?? null;

    if (!docToken && !externalId) {
      return json({ ok: true, ignored: true, reason: "sem token/external_id" });
    }

    // Procura contrato por external_id (preferido — é o id do contrato) ou doc_token
    let contrato: { id: string; status: string } | null = null;
    if (externalId) {
      const { data } = await admin
        .from("crediario_contracts").select("id, status").eq("id", externalId).maybeSingle();
      contrato = data ?? null;
    }
    if (!contrato && docToken) {
      const { data } = await admin
        .from("crediario_contracts").select("id, status")
        .eq("signature_external_id", docToken).maybeSingle();
      contrato = data ?? null;
    }

    if (!contrato) {
      console.warn("contrato não encontrado", { externalId, docToken });
      return json({ ok: true, ignored: true, reason: "contrato não encontrado" });
    }

    if (eventType === "doc_signed" || eventType === "doc_assinado") {
      await admin.from("crediario_contracts").update({
        status: "assinado",
        signed_at: new Date().toISOString(),
        signature_data: { ...payload, signed_file: signedFile },
      }).eq("id", contrato.id);
      return json({ ok: true, contrato_id: contrato.id, status: "assinado" });
    }

    if (eventType === "doc_refused" || eventType === "doc_recusado") {
      await admin.from("crediario_contracts").update({
        status: "recusado",
        signature_data: payload,
      }).eq("id", contrato.id);
      return json({ ok: true, contrato_id: contrato.id, status: "recusado" });
    }

    // Outros eventos: apenas atualiza signature_data
    await admin.from("crediario_contracts").update({ signature_data: payload }).eq("id", contrato.id);
    return json({ ok: true, contrato_id: contrato.id, evento: eventType });
  } catch (err) {
    console.error("zapsign-webhook error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
