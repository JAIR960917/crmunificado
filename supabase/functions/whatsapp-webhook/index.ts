/**
 * Webhook WhatsApp Cloud API (Meta).
 * GET  — verificação hub.challenge
 * POST — mensagens recebidas, ecos (envio pelo app) e status de entrega
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanPhone } from "../_shared/whatsappSend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

async function verifySignature(payload: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret || !signatureHeader) return false;
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

/** Resolve instância Meta pelo phone_number_id do payload. */
async function resolveMetaInstance(
  supabase: ReturnType<typeof createClient>,
  phoneNumberId: string,
): Promise<string | null> {
  if (!phoneNumberId) return null;
  const { data: byPid } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("provider", "meta")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (byPid?.id) return byPid.id;
  const { data: bySession } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("provider", "meta")
    .eq("session", phoneNumberId)
    .maybeSingle();
  return bySession?.id || null;
}

/** wa_id do cliente (contato) a partir do payload Meta. */
function resolveCustomerWaId(
  msg: Record<string, unknown>,
  direction: "in" | "out",
  contacts: { wa_id?: string }[],
): string {
  const toRaw = (msg.to as string) || "";
  const fromRaw = String(msg.from || "");
  if (direction === "out") {
    const to = cleanPhone(toRaw);
    if (to) return to;
    const recipient = msg.recipient_id as string | undefined;
    if (recipient) return cleanPhone(recipient);
  }
  const from = cleanPhone(fromRaw);
  if (from) return from;
  if (contacts[0]?.wa_id) return cleanPhone(String(contacts[0].wa_id));
  return "";
}

function contactNameFromPayload(contacts: { profile?: { name?: string }; wa_id?: string }[], waId: string): string | null {
  const hit = contacts.find((c) => cleanPhone(String(c.wa_id || "")) === waId);
  return hit?.profile?.name?.trim() || null;
}

async function upsertConversationMessage(
  supabase: ReturnType<typeof createClient>,
  opts: {
    instanceId: string | null;
    waId: string;
    contactName: string | null;
    direction: "in" | "out";
    text: string;
    waMessageId: string;
    isTemplate?: boolean;
    metaTemplateName?: string | null;
    initialStatus: string;
    incrementUnread: boolean;
  },
): Promise<void> {
  const { instanceId, waId, contactName, direction, text, waMessageId, initialStatus, incrementUnread } = opts;
  if (!waId) {
    console.warn("[whatsapp-webhook] wa_id vazio — mensagem ignorada");
    return;
  }

  const now = new Date();
  const windowExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const preview = text.slice(0, 200);

  let conversationId: string | null = null;

  if (instanceId) {
    const { data: byInst } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("instance_id", instanceId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (byInst?.id) conversationId = byInst.id;
  }

  if (!conversationId) {
    let q = supabase.from("whatsapp_conversations").select("id").eq("wa_id", waId);
    if (instanceId) q = q.eq("instance_id", instanceId);
    else q = q.is("instance_id", null);
    const { data: legacy } = await q.maybeSingle();
    if (legacy?.id) {
      conversationId = legacy.id;
      if (instanceId) {
        await supabase.from("whatsapp_conversations").update({ instance_id: instanceId }).eq("id", conversationId);
      }
    }
  }

  if (conversationId) {
    const patch: Record<string, unknown> = {
      window_expires_at: direction === "in" ? windowExpires.toISOString() : undefined,
      last_message_at: now.toISOString(),
      last_preview: preview,
      phone_display: waId,
      updated_at: now.toISOString(),
    };
    if (contactName) patch.contact_name = contactName;
    if (instanceId) patch.instance_id = instanceId;
    await supabase.from("whatsapp_conversations").update(patch).eq("id", conversationId);
    if (incrementUnread) {
      await supabase.rpc("increment_whatsapp_unread", { p_conversation_id: conversationId });
    }
  } else {
    const { data: inserted } = await supabase.from("whatsapp_conversations").insert({
      instance_id: instanceId,
      wa_id: waId,
      contact_name: contactName,
      phone_display: waId,
      window_expires_at: direction === "in" ? windowExpires.toISOString() : null,
      last_message_at: now.toISOString(),
      last_preview: preview,
      unread_count: incrementUnread ? 1 : 0,
    }).select("id").single();
    conversationId = inserted?.id || null;
  }

  if (!conversationId) return;

  if (waMessageId) {
    const { data: dup } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    if (dup?.id) {
      console.log("[whatsapp-webhook] mensagem duplicada ignorada", waMessageId);
      return;
    }
  }

  await supabase.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    direction,
    body: text || null,
    wa_message_id: waMessageId || null,
    status: initialStatus,
    is_template: opts.isTemplate ?? false,
    meta_template_name: opts.metaTemplateName ?? null,
  });
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

  if (!APP_SECRET) {
    console.error("[whatsapp-webhook] WHATSAPP_APP_SECRET não configurado");
    return new Response(JSON.stringify({ error: "Webhook not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const valid = await verifySignature(rawBody, signature, APP_SECRET);
  if (!valid) {
    console.warn("[whatsapp-webhook] assinatura inválida ou ausente");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
  console.log(
    `[whatsapp-webhook] POST object=${String(body.object || "")} entries=${entries.length}`,
  );
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const changes = (e.changes as unknown[]) || [];
    for (const change of changes) {
      const ch = change as Record<string, unknown>;
      const field = String(ch.field || "messages");
      const value = ch.value as Record<string, unknown> | undefined;
      if (!value) continue;

      const phoneNumberId = String((value.metadata as { phone_number_id?: string })?.phone_number_id || "");
      const instanceId = await resolveMetaInstance(supabase, phoneNumberId);

      if (!instanceId && phoneNumberId) {
        console.warn(
          "[whatsapp-webhook] instância Meta não encontrada para phone_number_id=",
          phoneNumberId,
        );
      }

      const contacts = ((value.contacts as unknown[]) || []) as { profile?: { name?: string }; wa_id?: string }[];

      // Campo "messages" = cliente → empresa | "smb_message_echoes" = empresa → cliente (app WhatsApp)
      const isEcho = field === "smb_message_echoes" || field === "message_echoes";
      const direction: "in" | "out" = isEcho ? "out" : "in";

      const messages = (value.messages as unknown[]) || [];
      if (messages.length > 0) {
        console.log(
          `[whatsapp-webhook] field=${field} direction=${direction} count=${messages.length} phone_number_id=${phoneNumberId}`,
        );
      }

      for (const m of messages) {
        const msg = m as Record<string, unknown>;
        const waId = resolveCustomerWaId(msg, direction, contacts);
        const waMessageId = String(msg.id || "");
        const text = extractText(msg);
        const contactName = contactNameFromPayload(contacts, waId);

        console.log(
          `[whatsapp-webhook] msg ${direction} from=${String(msg.from || "")} to=${String(msg.to || "")} wa_id=${waId} preview=${text.slice(0, 40)}`,
        );

        await upsertConversationMessage(supabase, {
          instanceId,
          waId,
          contactName,
          direction,
          text,
          waMessageId,
          initialStatus: direction === "in" ? "received" : "sent",
          incrementUnread: direction === "in",
        });
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
