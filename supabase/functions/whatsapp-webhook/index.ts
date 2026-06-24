/**
 * Webhook WhatsApp Cloud API (Meta).
 * GET  — verificação hub.challenge
 * POST — mensagens recebidas, ecos (envio pelo app) e status de entrega
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanPhone, normalizeWaId, waIdsEquivalent } from "../_shared/whatsappSend.ts";
import { findInboxConversationId, insertWhatsAppMessageRow, parseWhatsAppMessage } from "../_shared/whatsappInboxMedia.ts";

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
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

type WaMetadata = { phone_number_id?: string; display_phone_number?: string };

type MetaInstanceRow = {
  id: string;
  phone_number_id?: string | null;
  session?: string | null;
  display_phone?: string | null;
  is_active?: boolean | null;
  ai_enabled?: boolean | null;
  ai_webhook_url?: string | null;
  ai_webhook_secret?: string | null;
};

function phoneDigits(value: string): string {
  return (value || "").replace(/\D/g, "");
}

function phonesEquivalent(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const tailA = da.length >= 10 ? da.slice(-11) : da;
  const tailB = db.length >= 10 ? db.slice(-11) : db;
  return tailA === tailB;
}

async function loadMetaInstances(
  supabase: ReturnType<typeof createClient>,
): Promise<MetaInstanceRow[]> {
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("id, phone_number_id, session, display_phone, is_active, ai_enabled, ai_webhook_url, ai_webhook_secret")
    .eq("provider", "meta");
  if (error) {
    console.error("[whatsapp-webhook] erro ao listar instâncias meta:", error.message);
    return [];
  }
  return data || [];
}

/** Resolve instância Meta pelo phone_number_id (e fallbacks). */
function resolveMetaInstance(
  instances: MetaInstanceRow[],
  phoneNumberId: string,
  metadata?: WaMetadata,
): { instanceId: string | null; resolvedVia: string } {
  const pid = phoneNumberId.trim();
  const isMetaTestId = !pid || META_TEST_PHONE_NUMBER_IDS.has(pid);

  if (pid && !isMetaTestId) {
    const byPid = instances.find((row) => {
      const storedPid = row.phone_number_id?.trim() || "";
      const storedSession = row.session?.trim() || "";
      return storedPid === pid
        || storedSession === pid
        || phoneDigits(storedPid) === phoneDigits(pid)
        || phoneDigits(storedSession) === phoneDigits(pid);
    });
    if (byPid) return { instanceId: byPid.id, resolvedVia: "phone_number_id" };
  }

  const displayRaw = metadata?.display_phone_number || "";
  if (displayRaw) {
    const displayMatches = instances.filter(
      (row) => row.display_phone && phonesEquivalent(String(row.display_phone), displayRaw),
    );
    if (displayMatches.length === 1) {
      return { instanceId: displayMatches[0].id, resolvedVia: "display_phone" };
    }
    if (displayMatches.length > 1) {
      const active = displayMatches.find((row) => row.is_active !== false) || displayMatches[0];
      return { instanceId: active.id, resolvedVia: "display_phone_among_multiple" };
    }
  }

  if (isMetaTestId) {
    const activeMeta = instances.filter((row) => row.is_active !== false);
    if (activeMeta.length === 1) {
      return { instanceId: activeMeta[0].id, resolvedVia: "single_meta_instance_test_payload" };
    }
  }

  return { instanceId: null, resolvedVia: "none" };
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
  const hit = contacts.find((c) => waIdsEquivalent(String(c.wa_id || ""), waId));
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
    preview: string;
    waMessageId: string;
    messageType?: "text" | "media";
    mediaType?: string;
    mediaId?: string;
    mediaMime?: string;
    mediaFilename?: string;
    caption?: string;
    isTemplate?: boolean;
    metaTemplateName?: string | null;
    initialStatus: string;
    incrementUnread: boolean;
  },
): Promise<{ ok: boolean; conversationId: string | null }> {
  const { instanceId, waId, contactName, direction, text, preview, waMessageId, initialStatus } = opts;
  const canonicalWaId = normalizeWaId(waId);
  if (!canonicalWaId) {
    console.warn("[whatsapp-webhook] wa_id vazio — mensagem ignorada");
    return { ok: false, conversationId: null };
  }

  const now = new Date();
  const windowExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const previewText = preview.slice(0, 200);

  let { id: conversationId } = await findInboxConversationId(supabase, canonicalWaId, instanceId, {
    contactName: direction === "in" ? contactName : null,
  });

  if (!conversationId) {
    const { data: inserted, error: insertErr } = await supabase.from("whatsapp_conversations").insert({
      instance_id: instanceId,
      wa_id: canonicalWaId,
      contact_name: contactName,
      phone_display: canonicalWaId,
      window_expires_at: direction === "in" ? windowExpires.toISOString() : null,
      last_message_at: now.toISOString(),
      last_preview: previewText,
      unread_count: 0,
    }).select("id").single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        const retry = await findInboxConversationId(supabase, canonicalWaId, instanceId, {
          contactName: direction === "in" ? contactName : null,
        });
        conversationId = retry.id;
      } else {
        console.error("[whatsapp-webhook] erro ao criar conversa:", insertErr.message, insertErr.details);
        return { ok: false, conversationId: null };
      }
    } else {
      conversationId = inserted?.id || null;
    }
  }

  if (!conversationId) {
    console.error("[whatsapp-webhook] conversation_id indefinido após upsert");
    return { ok: false, conversationId: null };
  }

  if (waMessageId) {
    const { data: dup } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    if (dup?.id) {
      console.log("[whatsapp-webhook] mensagem duplicada ignorada", waMessageId);
      return { ok: true, conversationId };
    }
  }

  const inserted = await insertWhatsAppMessageRow(supabase, {
    conversation_id: conversationId,
    direction,
    body: opts.messageType === "media" ? null : (text || null),
    wa_message_id: waMessageId || null,
    status: initialStatus,
    is_template: opts.isTemplate ?? false,
    meta_template_name: opts.metaTemplateName ?? null,
    message_type: opts.messageType || "text",
    media_type: opts.mediaType || null,
    media_id: opts.mediaId || null,
    media_mime: opts.mediaMime || null,
    media_filename: opts.mediaFilename || null,
    caption: opts.caption || null,
  });

  if (!inserted.ok) {
    console.error("[whatsapp-webhook] erro ao inserir mensagem:", inserted.error);
    return { ok: false, conversationId: null };
  }

  const { error: metaErr } = await supabase.rpc("apply_whatsapp_conversation_message_meta", {
    p_conversation_id: conversationId,
    p_preview: previewText,
    p_last_message_at: now.toISOString(),
    p_phone_display: canonicalWaId,
    p_wa_id: canonicalWaId,
    p_window_expires_at: direction === "in" ? windowExpires.toISOString() : null,
    p_contact_name: contactName,
    p_instance_id: instanceId,
    p_increment_unread: false,
    p_is_inbound: direction === "in",
  });
  if (metaErr) {
    console.error("[whatsapp-webhook] erro ao atualizar conversa:", metaErr.message);
    return { ok: false, conversationId: null };
  }

  console.log(`[whatsapp-webhook] gravado conv=${conversationId} wa_id=${canonicalWaId} dir=${direction}`);
  return { ok: true, conversationId };
}

/**
 * Encaminha a mensagem recebida ao workflow n8n do agente de IA (se o
 * número tiver IA habilitada e a conversa não tiver sido assumida por um
 * atendente humano). Best-effort: erro aqui não falha o webhook da Meta.
 */
async function forwardToAiAgent(
  supabase: ReturnType<typeof createClient>,
  instance: MetaInstanceRow | undefined,
  conversationId: string,
  waId: string,
  contactName: string | null,
  text: string,
): Promise<void> {
  if (!instance?.ai_enabled || !instance.ai_webhook_url) return;

  try {
    const { data: conv } = await supabase
      .from("whatsapp_conversations")
      .select("ai_active")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv || conv.ai_active === false) return;

    const { data: history } = await supabase
      .from("whatsapp_messages")
      .select("direction, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(15);

    const payload = {
      conversation_id: conversationId,
      instance_id: instance.id,
      wa_id: waId,
      contact_name: contactName,
      message: text,
      history: ((history || []) as { direction: string; body: string | null; created_at: string }[])
        .reverse()
        .map((m) => ({ direction: m.direction, text: m.body, created_at: m.created_at })),
    };

    const res = await fetch(instance.ai_webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(instance.ai_webhook_secret ? { "x-ai-agent-secret": instance.ai_webhook_secret } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[whatsapp-webhook] n8n webhook respondeu HTTP ${res.status} para conv=${conversationId}`);
    }
  } catch (e) {
    console.error("[whatsapp-webhook] erro ao encaminhar para o agente de IA:", e instanceof Error ? e.message : e);
  }
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

  if (!APP_SECRET) {
    console.error("[whatsapp-webhook] WHATSAPP_APP_SECRET não configurado — rejeitando requisição");
    return new Response(JSON.stringify({ error: "Webhook not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const valid = await verifySignature(rawBody, signature, APP_SECRET);
  if (!valid) {
    console.warn(
      "[whatsapp-webhook] assinatura inválida — confira WHATSAPP_APP_SECRET (App Secret do app Meta)",
      signature ? "header ok" : "sem x-hub-signature-256",
    );
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
  const metaInstances = await loadMetaInstances(supabase);

  console.log(
    `[whatsapp-webhook] POST object=${String(body.object || "")} entries=${entries.length} meta_instances=${metaInstances.length}`,
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
      const { instanceId, resolvedVia } = resolveMetaInstance(metaInstances, phoneNumberId, metadata);

      if (META_TEST_PHONE_NUMBER_IDS.has(phoneNumberId)) {
        console.warn(
          "[whatsapp-webhook] phone_number_id de TESTE da Meta (" + phoneNumberId + ") — não é mensagem real do celular.",
        );
      } else if (!instanceId) {
        const crmIds = metaInstances
          .map((row) => row.phone_number_id?.trim())
          .filter(Boolean)
          .join(", ") || "nenhum";
        console.warn(
          "[whatsapp-webhook] instância não encontrada phone_number_id=" + phoneNumberId +
            " display=" + (metadata.display_phone_number || "—") +
            " crm_ids=" + crmIds +
            " — mensagem será gravada sem instance_id; corrija o Phone Number ID no CRM.",
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
        const parsed = parseWhatsAppMessage(msg);
        const contactName = contactNameFromPayload(contacts, waId);

        console.log(
          `[whatsapp-webhook] msg ${direction} type=${String(msg.type || "")} wa_id=${waId} preview=${parsed.preview.slice(0, 60)}`,
        );

        const { ok, conversationId } = await upsertConversationMessage(supabase, {
          instanceId,
          waId,
          contactName,
          direction,
          text: parsed.text,
          preview: parsed.preview,
          waMessageId,
          messageType: parsed.messageType,
          mediaType: parsed.mediaType,
          mediaId: parsed.mediaId,
          mediaMime: parsed.mediaMime,
          mediaFilename: parsed.mediaFilename,
          caption: parsed.caption,
          initialStatus: direction === "in" ? "received" : "sent",
          incrementUnread: direction === "in",
        });
        if (ok) saved += 1;

        if (ok && direction === "in" && conversationId && parsed.messageType !== "media") {
          const instance = metaInstances.find((row) => row.id === instanceId);
          await forwardToAiAgent(supabase, instance, conversationId, waId, contactName, parsed.text);
        }
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
