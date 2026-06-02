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

/** ID fictício usado só no botão «Teste» do painel Meta — não é o número real. */
const META_TEST_PHONE_NUMBER_IDS = new Set(["123456123", "123456789", "0"]);

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

type WaMetadata = { phone_number_id?: string; display_phone_number?: string };

/** Resolve instância Meta pelo phone_number_id (e fallbacks). */
async function resolveMetaInstance(
  supabase: ReturnType<typeof createClient>,
  phoneNumberId: string,
  metadata?: WaMetadata,
): Promise<{ instanceId: string | null; resolvedVia: string }> {
  const pid = phoneNumberId.trim();
  const isMetaTestId = !pid || META_TEST_PHONE_NUMBER_IDS.has(pid);

  if (pid && !isMetaTestId) {
    const { data: byPid } = await supabase
      .from("whatsapp_instances")
      .select("id")
      .eq("provider", "meta")
      .eq("phone_number_id", pid)
      .maybeSingle();
    if (byPid?.id) return { instanceId: byPid.id, resolvedVia: "phone_number_id" };

    const { data: bySession } = await supabase
      .from("whatsapp_instances")
      .select("id")
      .eq("provider", "meta")
      .eq("session", pid)
      .maybeSingle();
    if (bySession?.id) return { instanceId: bySession.id, resolvedVia: "session" };
  }

  const displayRaw = metadata?.display_phone_number || "";
  if (displayRaw) {
    const normalized = cleanPhone(displayRaw);
    const { data: metaRows } = await supabase
      .from("whatsapp_instances")
      .select("id, display_phone")
      .eq("provider", "meta")
      .eq("is_active", true);
    for (const row of metaRows || []) {
      if (row.display_phone && cleanPhone(String(row.display_phone)) === normalized) {
        return { instanceId: row.id, resolvedVia: "display_phone" };
      }
    }
  }

  const { data: activeMeta } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("provider", "meta")
    .eq("is_active", true);

  if (activeMeta?.length === 1) {
    return { instanceId: activeMeta[0].id, resolvedVia: isMetaTestId ? "single_meta_instance_test_payload" : "single_meta_instance" };
  }

  return { instanceId: null, resolvedVia: "none" };
}

async function findConversationId(
  supabase: ReturnType<typeof createClient>,
  waId: string,
  instanceId: string | null,
): Promise<string | null> {
  if (instanceId) {
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("instance_id", instanceId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const { data: rows } = await supabase
    .from("whatsapp_conversations")
    .select("id, instance_id")
    .eq("wa_id", waId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  return rows?.[0]?.id || null;
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
): Promise<boolean> {
  const { instanceId, waId, contactName, direction, text, waMessageId, initialStatus, incrementUnread } = opts;
  if (!waId) {
    console.warn("[whatsapp-webhook] wa_id vazio — mensagem ignorada");
    return false;
  }

  const now = new Date();
  const windowExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const preview = text.slice(0, 200);

  let conversationId = await findConversationId(supabase, waId, instanceId);

  if (conversationId) {
    const patch: Record<string, unknown> = {
      last_message_at: now.toISOString(),
      last_preview: preview,
      phone_display: waId,
      updated_at: now.toISOString(),
    };
    if (direction === "in") patch.window_expires_at = windowExpires.toISOString();
    if (contactName) patch.contact_name = contactName;
    if (instanceId) patch.instance_id = instanceId;

    const { error: updErr } = await supabase.from("whatsapp_conversations").update(patch).eq("id", conversationId);
    if (updErr) {
      console.error("[whatsapp-webhook] erro ao atualizar conversa:", updErr.message);
      return false;
    }
    if (incrementUnread) {
      const { error: rpcErr } = await supabase.rpc("increment_whatsapp_unread", { p_conversation_id: conversationId });
      if (rpcErr) console.warn("[whatsapp-webhook] increment_whatsapp_unread:", rpcErr.message);
    }
  } else {
    const { data: inserted, error: insertErr } = await supabase.from("whatsapp_conversations").insert({
      instance_id: instanceId,
      wa_id: waId,
      contact_name: contactName,
      phone_display: waId,
      window_expires_at: direction === "in" ? windowExpires.toISOString() : null,
      last_message_at: now.toISOString(),
      last_preview: preview,
      unread_count: incrementUnread ? 1 : 0,
    }).select("id").single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        conversationId = await findConversationId(supabase, waId, instanceId);
      } else {
        console.error("[whatsapp-webhook] erro ao criar conversa:", insertErr.message, insertErr.details);
        return false;
      }
    } else {
      conversationId = inserted?.id || null;
    }
  }

  if (!conversationId) {
    console.error("[whatsapp-webhook] conversation_id indefinido após upsert");
    return false;
  }

  if (waMessageId) {
    const { data: dup } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    if (dup?.id) {
      console.log("[whatsapp-webhook] mensagem duplicada ignorada", waMessageId);
      return true;
    }
  }

  const { error: msgErr } = await supabase.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    direction,
    body: text || null,
    wa_message_id: waMessageId || null,
    status: initialStatus,
    is_template: opts.isTemplate ?? false,
    meta_template_name: opts.metaTemplateName ?? null,
  });

  if (msgErr) {
    console.error("[whatsapp-webhook] erro ao inserir mensagem:", msgErr.message);
    return false;
  }

  console.log(`[whatsapp-webhook] gravado conv=${conversationId} wa_id=${waId} dir=${direction}`);
  return true;
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
  let saved = 0;

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

      const metadata = (value.metadata as WaMetadata) || {};
      const phoneNumberId = String(metadata.phone_number_id || "").trim();
      const { instanceId, resolvedVia } = await resolveMetaInstance(supabase, phoneNumberId, metadata);

      if (META_TEST_PHONE_NUMBER_IDS.has(phoneNumberId)) {
        console.warn(
          "[whatsapp-webhook] phone_number_id de TESTE da Meta (" + phoneNumberId + ") — não é mensagem real do celular. Envie do WhatsApp pessoal e procure phone_number_id=1173598282496506 nos logs.",
        );
      } else if (!instanceId) {
        console.warn(
          "[whatsapp-webhook] instância não encontrada para phone_number_id=" + phoneNumberId +
            " — cadastre em WhatsApp → API Meta com ID exato do painel Meta.",
        );
      } else {
        console.log(
          `[whatsapp-webhook] instância ${instanceId} via ${resolvedVia} phone_number_id=${phoneNumberId}`,
        );
      }

      const contacts = ((value.contacts as unknown[]) || []) as { profile?: { name?: string }; wa_id?: string }[];
      const isEcho = field === "smb_message_echoes" || field === "message_echoes";
      const direction: "in" | "out" = isEcho ? "out" : "in";

      const messages = (value.messages as unknown[]) || [];
      const statuses = (value.statuses as unknown[]) || [];

      console.log(
        `[whatsapp-webhook] field=${field} messages=${messages.length} statuses=${statuses.length} display=${metadata.display_phone_number || "—"}`,
      );

      for (const m of messages) {
        const msg = m as Record<string, unknown>;
        const waId = resolveCustomerWaId(msg, direction, contacts);
        const waMessageId = String(msg.id || "");
        const text = extractText(msg);
        const contactName = contactNameFromPayload(contacts, waId);

        console.log(
          `[whatsapp-webhook] msg ${direction} from=${String(msg.from || "")} wa_id=${waId} preview=${text.slice(0, 60)}`,
        );

        const ok = await upsertConversationMessage(supabase, {
          instanceId,
          waId,
          contactName,
          direction,
          text,
          waMessageId,
          initialStatus: direction === "in" ? "received" : "sent",
          incrementUnread: direction === "in",
        });
        if (ok) saved += 1;
      }

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

  console.log(`[whatsapp-webhook] fim POST saved=${saved}`);

  return new Response(JSON.stringify({ ok: true, saved }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
