/** Parsing e persistência de mensagens com mídia (WhatsApp Cloud API). */

import { nationalMobileDigits, normalizeWaId, waIdsEquivalent } from "./whatsappSend.ts";

type SupabaseAdmin = ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;

type ConversationRow = {
  id: string;
  wa_id: string;
  contact_name?: string | null;
  card_id?: string | null;
};

async function findExactInboxConversationId(
  admin: SupabaseAdmin,
  waId: string,
  instanceId: string | null,
): Promise<string | null> {
  if (instanceId) {
    const { data } = await admin
      .from("whatsapp_conversations")
      .select("id")
      .eq("instance_id", instanceId)
      .eq("wa_id", waId)
      .maybeSingle();
    return data?.id || null;
  }

  const { data } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("wa_id", waId)
    .is("instance_id", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

function pickBestEquivalentConversation(
  rows: ConversationRow[],
  canonicalWaId: string,
): ConversationRow | null {
  const matches = rows.filter((row) => waIdsEquivalent(row.wa_id, canonicalWaId));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  return matches.slice().sort((a, b) => {
    const score = (row: ConversationRow) =>
      (row.card_id ? 100 : 0) + (row.contact_name?.trim() ? 10 : 0);
    return score(b) - score(a);
  })[0];
}

function namesLooselyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a || "").trim().toLowerCase();
  const nb = (b || "").trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const fa = na.split(/\s+/)[0];
  const fb = nb.split(/\s+/)[0];
  return fa.length >= 3 && fa === fb;
}

async function findConversationByCardId(
  admin: SupabaseAdmin,
  cardId: string,
  instanceId: string | null,
): Promise<string | null> {
  if (instanceId) {
    const { data } = await admin
      .from("whatsapp_conversations")
      .select("id")
      .eq("card_id", cardId)
      .eq("instance_id", instanceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const { data } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("card_id", cardId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function findConversationByCobrancaPhone(
  admin: SupabaseAdmin,
  canonicalWaId: string,
  instanceId: string | null,
  contactName: string | null,
): Promise<string | null> {
  const national = nationalMobileDigits(canonicalWaId);
  if (national.length < 10) return null;

  const { data: ranked } = await admin.rpc("find_cobrancas_by_phone", {
    p_phone: national,
    p_contact_name: contactName,
    p_prefer_card_id: null,
    p_name_hint: null,
  });

  const cardIds = ((ranked || []) as { id: string; match_score?: number }[])
    .filter((r) => r.match_score == null || r.match_score >= 300)
    .map((r) => r.id);

  for (const cardId of cardIds) {
    const convId = await findConversationByCardId(admin, cardId, instanceId);
    if (convId) return convId;
  }

  const { data: legacy } = await admin.rpc("find_cobranca_by_phone_system", {
    p_phone: national,
  });
  const legacyRow = Array.isArray(legacy) ? legacy[0] : legacy;
  if (legacyRow?.id) {
    return await findConversationByCardId(admin, legacyRow.id, instanceId);
  }

  return null;
}

async function findConversationByContactName(
  admin: SupabaseAdmin,
  instanceId: string | null,
  contactName: string | null,
): Promise<string | null> {
  if (!instanceId || !contactName?.trim()) return null;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await admin
    .from("whatsapp_conversations")
    .select("id, contact_name, card_id, module")
    .eq("instance_id", instanceId)
    .eq("module", "cobrancas")
    .not("card_id", "is", null)
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);

  const matches = (rows || []).filter((row) =>
    namesLooselyMatch(row.contact_name, contactName),
  );
  if (matches.length === 1) return matches[0].id;
  return null;
}

/** Localiza conversa existente (wa_id, card de cobrança ou nome do contato). */
export async function findInboxConversationId(
  admin: SupabaseAdmin,
  waId: string,
  instanceId: string | null,
  opts?: { contactName?: string | null },
): Promise<{ id: string | null; canonicalWaId: string }> {
  const canonicalWaId = normalizeWaId(waId);
  if (!canonicalWaId) return { id: null, canonicalWaId: "" };

  const contactName = opts?.contactName?.trim() || null;

  for (const candidate of [canonicalWaId, waId.trim()].filter(Boolean)) {
    const exactId = await findExactInboxConversationId(admin, candidate, instanceId);
    if (exactId) return { id: exactId, canonicalWaId };
  }

  const loadFuzzy = async (filterInstance: string | null) => {
    let query = admin
      .from("whatsapp_conversations")
      .select("id, wa_id, contact_name, card_id")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(150);
    query = filterInstance
      ? query.eq("instance_id", filterInstance)
      : query.is("instance_id", null);
    const { data } = await query;
    return pickBestEquivalentConversation((data || []) as ConversationRow[], canonicalWaId);
  };

  let best = instanceId ? await loadFuzzy(instanceId) : null;
  if (!best?.id && instanceId) {
    best = await loadFuzzy(null);
  }
  if (!best?.id && !instanceId) {
    best = await loadFuzzy(null);
  }
  if (best?.id) return { id: best.id, canonicalWaId };

  const byCard = await findConversationByCobrancaPhone(
    admin,
    canonicalWaId,
    instanceId,
    contactName,
  );
  if (byCard) return { id: byCard, canonicalWaId };

  const byName = await findConversationByContactName(admin, instanceId, contactName);
  if (byName) return { id: byName, canonicalWaId };

  return { id: null, canonicalWaId };
}

/** Grava mensagem enviada (campanha/gatilho/API) no Inbox WhatsApp. */
export async function recordOutboundWhatsAppInbox(
  admin: SupabaseAdmin,
  opts: {
    instanceId: string | null;
    phone: string;
    contactName?: string | null;
    body: string;
    waMessageId?: string | null;
    isTemplate?: boolean;
    metaTemplateName?: string | null;
    module?: string | null;
    cardId?: string | null;
    sentByName?: string;
  },
): Promise<void> {
  const canonicalWaId = normalizeWaId(opts.phone);
  if (!canonicalWaId) {
    console.warn("[recordOutboundWhatsAppInbox] telefone inválido — ignorado");
    return;
  }

  const now = new Date();
  const bodyText = (opts.body || "").trim();
  const previewText = bodyText.slice(0, 200)
    || (opts.isTemplate ? `[Template] ${opts.metaTemplateName || "Meta"}` : "(mensagem)");

  let { id: conversationId } = await findInboxConversationId(admin, canonicalWaId, opts.instanceId);

  const convPatch: Record<string, unknown> = {
    last_message_at: now.toISOString(),
    last_preview: previewText,
    phone_display: canonicalWaId,
    wa_id: canonicalWaId,
    updated_at: now.toISOString(),
  };
  if (opts.contactName) convPatch.contact_name = opts.contactName;
  if (opts.instanceId) convPatch.instance_id = opts.instanceId;
  if (opts.module) convPatch.module = opts.module;
  if (opts.cardId) convPatch.card_id = opts.cardId;

  if (conversationId) {
    const { error: updErr } = await admin
      .from("whatsapp_conversations")
      .update(convPatch)
      .eq("id", conversationId);
    if (updErr) {
      console.warn("[recordOutboundWhatsAppInbox] erro ao atualizar conversa:", updErr.message);
      return;
    }
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("whatsapp_conversations")
      .insert({
        instance_id: opts.instanceId,
        wa_id: canonicalWaId,
        contact_name: opts.contactName ?? null,
        phone_display: canonicalWaId,
        module: opts.module ?? null,
        card_id: opts.cardId ?? null,
        window_expires_at: null,
        last_message_at: now.toISOString(),
        last_preview: previewText,
        unread_count: 0,
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        const retry = await findInboxConversationId(admin, canonicalWaId, opts.instanceId);
        conversationId = retry.id;
        if (conversationId) {
          await admin.from("whatsapp_conversations").update(convPatch).eq("id", conversationId);
        }
      } else {
        console.warn("[recordOutboundWhatsAppInbox] erro ao criar conversa:", insertErr.message);
        return;
      }
    } else {
      conversationId = inserted?.id || null;
    }
  }

  if (!conversationId) {
    console.warn("[recordOutboundWhatsAppInbox] conversation_id indefinido após upsert");
    return;
  }

  if (opts.waMessageId) {
    const { data: dup } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", opts.waMessageId)
      .maybeSingle();
    if (dup?.id) {
      console.log("[recordOutboundWhatsAppInbox] mensagem duplicada ignorada", opts.waMessageId);
      return;
    }
  }

  const saved = await insertWhatsAppMessageRow(admin, {
    conversation_id: conversationId,
    direction: "out",
    body: bodyText || null,
    wa_message_id: opts.waMessageId || null,
    status: "sent",
    is_template: opts.isTemplate ?? false,
    meta_template_name: opts.metaTemplateName ?? null,
    created_at: now.toISOString(),
    sent_by: null,
    sent_by_name: opts.sentByName ?? "Gatilho",
  });

  if (!saved.ok) {
    console.warn("[recordOutboundWhatsAppInbox] erro ao inserir mensagem:", saved.error);
    return;
  }

  console.log(`[recordOutboundWhatsAppInbox] gravado conv=${conversationId} wa_id=${canonicalWaId}`);
}

/** Texto enviado ao cliente: cabeçalho em negrito (Markdown WhatsApp) + conteúdo. */
export function formatOutboundWhatsAppBody(senderName: string, content?: string | null): string {
  const name = (senderName || "").trim() || "Atendente";
  const part = (content || "").trim();
  const header = `*Atendente ${name}*`;
  return part ? `${header}\n\n${part}` : header;
}

export type ParsedWaMessage = {
  messageType: "text" | "media";
  text: string;
  preview: string;
  mediaType?: "image" | "audio" | "video" | "document" | "sticker";
  mediaId?: string;
  mediaMime?: string;
  mediaFilename?: string;
  caption?: string;
};

export function parseWhatsAppMessage(msg: Record<string, unknown>): ParsedWaMessage {
  const type = String(msg.type || "text");

  if (type === "text") {
    const text = (msg.text as { body?: string })?.body || "";
    return { messageType: "text", text, preview: text };
  }

  if (type === "button") {
    const text = (msg.button as { text?: string })?.text || "";
    return { messageType: "text", text, preview: text };
  }

  if (type === "interactive") {
    const ir = msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } };
    const text = ir?.button_reply?.title || ir?.list_reply?.title || "";
    return { messageType: "text", text, preview: text };
  }

  if (type === "image") {
    const img = msg.image as { id?: string; mime_type?: string; caption?: string; filename?: string };
    const caption = img?.caption?.trim() || "";
    return {
      messageType: "media",
      text: caption,
      preview: caption ? `📷 ${caption}` : "📷 Imagem",
      mediaType: "image",
      mediaId: img?.id,
      mediaMime: img?.mime_type,
      mediaFilename: img?.filename,
      caption: caption || undefined,
    };
  }

  if (type === "audio") {
    const audio = msg.audio as { id?: string; mime_type?: string };
    return {
      messageType: "media",
      text: "",
      preview: "🎤 Áudio",
      mediaType: "audio",
      mediaId: audio?.id,
      mediaMime: audio?.mime_type || "audio/ogg",
    };
  }

  if (type === "video") {
    const video = msg.video as { id?: string; mime_type?: string; caption?: string };
    const caption = video?.caption?.trim() || "";
    return {
      messageType: "media",
      text: caption,
      preview: caption ? `🎬 ${caption}` : "🎬 Vídeo",
      mediaType: "video",
      mediaId: video?.id,
      mediaMime: video?.mime_type,
      caption: caption || undefined,
    };
  }

  if (type === "document") {
    const doc = msg.document as { id?: string; mime_type?: string; filename?: string; caption?: string };
    const caption = doc?.caption?.trim() || "";
    const name = doc?.filename || "documento";
    return {
      messageType: "media",
      text: caption,
      preview: `📄 ${name}`,
      mediaType: "document",
      mediaId: doc?.id,
      mediaMime: doc?.mime_type,
      mediaFilename: name,
      caption: caption || undefined,
    };
  }

  if (type === "sticker") {
    const st = msg.sticker as { id?: string; mime_type?: string };
    return {
      messageType: "media",
      text: "",
      preview: "🧩 Sticker",
      mediaType: "sticker",
      mediaId: st?.id,
      mediaMime: st?.mime_type || "image/webp",
    };
  }

  if (type === "reaction") {
    const reaction = msg.reaction as { emoji?: string } | undefined;
    const emoji = reaction?.emoji || "👍";
    const text = `${emoji} Reagiu à mensagem`;
    return { messageType: "text", text, preview: text };
  }

  if (type === "location") {
    const loc = msg.location as { latitude?: number; longitude?: number; name?: string; address?: string } | undefined;
    const label = loc?.name || loc?.address || "";
    const coords = loc?.latitude != null && loc?.longitude != null ? `${loc.latitude},${loc.longitude}` : null;
    const text = label
      ? `📍 ${label}${coords ? ` (${coords})` : ""}`
      : coords
      ? `📍 Localização: ${coords}`
      : "📍 Localização";
    return { messageType: "text", text, preview: text };
  }

  if (type === "contacts") {
    const cts = msg.contacts as { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[] | undefined;
    const first = cts?.[0];
    const name = first?.name?.formatted_name || "Contato";
    const phone = first?.phones?.[0]?.phone || "";
    const text = phone ? `👤 ${name} — ${phone}` : `👤 ${name}`;
    const preview = cts && cts.length > 1 ? `👤 ${cts.length} contatos compartilhados` : text;
    return { messageType: "text", text, preview };
  }

  if (type === "order") {
    return { messageType: "text", text: "🛒 Pedido recebido via WhatsApp", preview: "🛒 Pedido" };
  }

  if (type === "unsupported" || type === "system") {
    const text = "📵 Mensagem não suportada (enquete, evento ou outro tipo)";
    return { messageType: "text", text, preview: text };
  }

  const fallback = `[${type}]`;
  return { messageType: "text", text: fallback, preview: fallback };
}

/** Meta não aceita audio/webm — normaliza para tipos suportados. */
export function normalizeMetaUploadMime(
  mediaType: "image" | "audio" | "video" | "document",
  mimeType: string,
  filename: string,
): { mime: string; filename: string; error?: string; reject?: boolean } {
  const mime = (mimeType || "").toLowerCase().trim();
  const name = filename || "upload";

  if (mediaType === "audio") {
    if (mime.includes("ogg")) return { mime: "audio/ogg", filename: name.endsWith(".ogg") ? name : `${name}.ogg` };
    if (mime.includes("mpeg") || mime.includes("mp3")) {
      return { mime: "audio/mpeg", filename: name.endsWith(".mp3") ? name : `${name}.mp3` };
    }
    if (mime.includes("aac") || mime.includes("mp4")) {
      return { mime: "audio/aac", filename: name.endsWith(".aac") ? name : `${name}.aac` };
    }
    if (mime.includes("amr")) return { mime: "audio/amr", filename: name.endsWith(".amr") ? name : `${name}.amr` };
    if (mime.includes("webm")) {
      return {
        mime: "audio/webm",
        filename: name.endsWith(".webm") ? name : `${name}.webm`,
        reject: true,
        error:
          "Áudio em WebM não é aceito pela Meta como mensagem de áudio. Use Chrome/Firefox (grava OGG/Opus) ou envie um arquivo .ogg/.mp3.",
      };
    }
    return {
      mime: "audio/ogg",
      filename: `${name}.ogg`,
      error: "Formato de áudio não reconhecido; tentando como audio/ogg.",
    };
  }

  if (mediaType === "image" && !mime.startsWith("image/")) {
    return { mime: "image/jpeg", filename: name };
  }

  return { mime: mime || "application/octet-stream", filename: name };
}

export async function insertWhatsAppMessageRow(
  admin: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from("whatsapp_messages").insert(row as any);
  if (!error) return { ok: true };

  const msg = error.message || "";
  const missingCol = msg.includes("column") || msg.includes("does not exist") || error.code === "PGRST204";
  if (!missingCol) return { ok: false, error: msg };

  const preview =
    (row.caption as string) ||
    (row.body as string) ||
    (row.media_type === "image" ? "📷 Imagem" : row.media_type === "audio" ? "🎤 Áudio" : "📎 Anexo");

  const { error: fallbackErr } = await admin.from("whatsapp_messages").insert({
    conversation_id: row.conversation_id,
    direction: row.direction,
    body: preview,
    wa_message_id: row.wa_message_id,
    status: row.status,
    is_template: row.is_template ?? false,
    meta_template_name: row.meta_template_name ?? null,
    created_at: row.created_at,
    sent_by: row.sent_by ?? null,
    sent_by_name: row.sent_by_name ?? null,
  });
  if (fallbackErr) return { ok: false, error: fallbackErr.message };
  return { ok: true };
}
