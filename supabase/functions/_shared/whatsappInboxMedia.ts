/** Parsing e persistência de mensagens com mídia (WhatsApp Cloud API). */

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
  });
  if (fallbackErr) return { ok: false, error: fallbackErr.message };
  return { ok: true };
}
