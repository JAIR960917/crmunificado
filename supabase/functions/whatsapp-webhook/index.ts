/**
 * Webhook WhatsApp Cloud API (Meta).
 * GET  — verificação hub.challenge
 * POST — mensagens e status (atualiza janela 24h + inbox)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanPhone } from "../_shared/whatsappSend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

async function verifySignature(payload: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !appSecret) return !appSecret;
  const expected = signatureHeader.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === expected;
}

function extractText(msg: Record<string, unknown>): string {
  const type = msg.type as string;
  if (type === "text") return (msg.text as { body?: string })?.body || "";
  if (type === "button") return (msg.button as { text?: string })?.text || "";
  if (type === "interactive") {
    const ir = msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } };
    return ir?.button_reply?.title || ir?.list_reply?.title || "";
  }
  return `[${type || "mensagem"}]`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
  const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") || "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN && challenge) {
      console.log("[whatsapp-webhook] verificação Meta OK");
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (APP_SECRET) {
    const valid = await verifySignature(rawBody, signature, APP_SECRET);
    if (!valid) {
      console.warn("[whatsapp-webhook] assinatura inválida");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const entries = (body.entry as unknown[]) || [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const changes = (e.changes as unknown[]) || [];
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const phoneNumberId = String((value.metadata as { phone_number_id?: string })?.phone_number_id || "");
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("id, company_id")
        .eq("provider", "meta")
        .or(`phone_number_id.eq.${phoneNumberId},session.eq.${phoneNumberId}`)
        .maybeSingle();

      const instanceId = instance?.id || null;

      const messages = (value.messages as unknown[]) || [];
      for (const m of messages) {
        const msg = m as Record<string, unknown>;
        const from = cleanPhone(String(msg.from || ""));
        const waMessageId = String(msg.id || "");
        const text = extractText(msg);
        const now = new Date();
        const windowExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        let conversationId: string | null = null;
        let convQuery = supabase
          .from("whatsapp_conversations")
          .select("id")
          .eq("wa_id", from);
        convQuery = instanceId
          ? convQuery.eq("instance_id", instanceId)
          : convQuery.is("instance_id", null);
        const { data: existingConv } = await convQuery.maybeSingle();

        if (existingConv?.id) {
          conversationId = existingConv.id;
          await supabase.from("whatsapp_conversations").update({
            window_expires_at: windowExpires.toISOString(),
            last_message_at: now.toISOString(),
            last_preview: text.slice(0, 200),
          }).eq("id", conversationId);
          await supabase.rpc("increment_whatsapp_unread", { p_conversation_id: conversationId });
        } else {
          const { data: inserted } = await supabase.from("whatsapp_conversations").insert({
            instance_id: instanceId,
            wa_id: from,
            phone_display: from,
            window_expires_at: windowExpires.toISOString(),
            last_message_at: now.toISOString(),
            last_preview: text.slice(0, 200),
            unread_count: 1,
          }).select("id").single();
          conversationId = inserted?.id || null;
        }

        if (conversationId) {
          await supabase.from("whatsapp_messages").insert({
            conversation_id: conversationId,
            direction: "in",
            body: text,
            wa_message_id: waMessageId,
            status: "received",
          });
        }
      }

      const statuses = (value.statuses as unknown[]) || [];
      for (const s of statuses) {
        const st = s as { id?: string; status?: string };
        if (st.id && st.status) {
          await supabase.from("whatsapp_messages")
            .update({ status: st.status })
            .eq("wa_message_id", st.id);
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
