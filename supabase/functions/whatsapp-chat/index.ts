/**
 * Envio manual pelo Inbox (texto/template) via Meta Cloud API.
 * Grava mensagem "out" em whatsapp_messages e atualiza preview da conversa.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserFromRequest, getUserRoles } from "../_shared/staffAuth.ts";
import { cleanPhone, resolveSendTargetByInstanceId, sendWhatsAppMessage, translateWhatsAppError } from "../_shared/whatsappSend.ts";
import {
  formatOutboundWhatsAppBody,
  insertWhatsAppMessageRow,
  normalizeMetaUploadMime,
} from "../_shared/whatsappInboxMedia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = new Set(["admin", "gerente", "vendedor", "financeiro"]);

async function resolveSenderLabel(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ sent_by: string; sent_by_name: string }> {
  const { data } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  const name = (data?.full_name || "").trim() || (data?.email || "").split("@")[0]?.trim() || "Atendente";
  return { sent_by: userId, sent_by_name: name };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { user, response } = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE_KEY);
    if (response) return new Response(await response.text(), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roles = await getUserRoles(admin as any, user.id);
    const allowed = roles.some((r) => ALLOWED_ROLES.has(r));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado no servidor" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GRAPH_API_VERSION = "v21.0";

    if (
      action !== "send-text" && action !== "send-template" && action !== "send-media" &&
      action !== "get-media" && action !== "delete-message"
    ) {
      return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Só admin tem bypass total de empresa pra ACESSAR/responder uma
    // conversa. "gerente" entrou aqui numa correção anterior e isso deixava
    // ele mandar mensagem em QUALQUER conversa do sistema (inclusive em
    // números de Marketing sem relação com a empresa dele) — o controle por
    // empresa (hasInboxAccess/isMyCompany) já cobre o caso de gerente de
    // verdade. Gerente continua podendo excluir qualquer mensagem (moderação),
    // isso é independente do acesso à conversa.
    const isPrivileged = roles.some((r) => r === "admin");
    const canModerateMessages = roles.some((r) => r === "admin" || r === "gerente");

    async function isMyCompany(companyId: string): Promise<boolean> {
      const { data: profile } = await admin
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profile?.company_id === companyId) return true;

      const { data: mgr } = await admin
        .from("manager_companies")
        .select("company_id")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
        .maybeSingle();
      return !!mgr?.company_id;
    }

    // Mesma regra de public.user_has_whatsapp_inbox_access(): vínculo manual,
    // OU empresa da instância igual à do usuário. NÃO inclui "já foi
    // responsável por alguma conversa nessa instância" — isso vazava acesso
    // à instância INTEIRA pra sempre por causa de uma única conversa antiga
    // (até fechada), mesmo depois do usuário mudar de empresa. O acesso à
    // conversa ESPECÍFICA que é (ou foi) atribuída ao usuário já é coberto
    // direto em assertConversationAccess via conv.assigned_to === user.id.
    async function hasInboxAccess(instanceId: string): Promise<boolean> {
      const { data: assignment } = await admin
        .from("whatsapp_instance_assignments")
        .select("id")
        .eq("user_id", user.id)
        .eq("instance_id", instanceId)
        .maybeSingle();
      if (assignment?.id) return true;

      const { data: instance } = await admin
        .from("whatsapp_instances")
        .select("company_id")
        .eq("id", instanceId)
        .maybeSingle();
      return !!(instance?.company_id && (await isMyCompany(instance.company_id)));
    }

    async function assertConversationAccess(conversationId: string) {
      const { data: conv, error: convErr } = await admin
        .from("whatsapp_conversations")
        .select("id, instance_id, wa_id, contact_name, status, assigned_to, routed_to_company_id")
        .eq("id", conversationId.trim())
        .maybeSingle();
      if (convErr) throw convErr;
      if (!conv) {
        return { error: "Conversa não encontrada", status: 404, conv: null as null };
      }
      if (!isPrivileged && conv.instance_id) {
        let allowed: boolean;
        if (conv.assigned_to === user.id) {
          // Já é o responsável (inclusive após transferência entre empresas).
          allowed = true;
        } else if (conv.status === "pending" && conv.routed_to_company_id) {
          // Encaminhada para outra empresa — só essa empresa (ou admin) age nela.
          allowed = await isMyCompany(conv.routed_to_company_id);
        } else {
          allowed = await hasInboxAccess(conv.instance_id);
        }
        if (!allowed) {
          return { error: "Você não tem acesso a este número WhatsApp", status: 403, conv: null as null };
        }
      }
      return { conv, error: null as string | null, status: 200 };
    }

    if (action === "get-media") {
      const { message_id } = body as { message_id?: string };
      if (!message_id?.trim()) {
        return new Response(JSON.stringify({ error: "message_id é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: msg, error: msgErr } = await admin
        .from("whatsapp_messages")
        .select("id, conversation_id, media_id, media_type, media_mime, body")
        .eq("id", message_id.trim())
        .maybeSingle();
      if (msgErr) throw msgErr;
      if (!msg) {
        return new Response(JSON.stringify({ error: "Mensagem não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!msg.media_id) {
        return new Response(JSON.stringify({ error: "Mensagem sem mídia" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const access = await assertConversationAccess(String(msg.conversation_id));
      if (!access.conv) {
        return new Response(JSON.stringify({ error: access.error }), {
          status: access.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.media_id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const metaJson = await metaRes.json().catch(() => ({}));
      if (!metaRes.ok) {
        const err = (metaJson as { error?: { message?: string } })?.error?.message || "Falha ao obter URL da mídia";
        return new Response(JSON.stringify({ error: translateWhatsAppError(err) }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mediaUrl = String((metaJson as { url?: string }).url || "");
      if (!mediaUrl) {
        return new Response(JSON.stringify({ error: "Meta não retornou URL da mídia" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Valida que o domínio da URL pertence à Meta/WhatsApp antes de enviar o token.
      const ALLOWED_MEDIA_DOMAINS = [
        "cdn.fbsbx.com", "lookaside.fbsbx.com",
        "mmg.whatsapp.net", "scontent.whatsapp.net",
        "media.fbsbx.com", "graph.facebook.com",
      ];
      try {
        const parsedUrl = new URL(mediaUrl);
        const allowed = ALLOWED_MEDIA_DOMAINS.some((d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith("." + d));
        if (!allowed) {
          console.error("[whatsapp-chat] URL de mídia fora dos domínios permitidos:", parsedUrl.hostname);
          return new Response(JSON.stringify({ error: "URL de mídia inválida." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: "URL de mídia inválida." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Download do media URL exige o mesmo token Bearer.
      const fileRes = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!fileRes.ok) {
        return new Response(JSON.stringify({ error: `Falha ao baixar mídia (${fileRes.status})` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const buf = new Uint8Array(await fileRes.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const mime = String((metaJson as { mime_type?: string }).mime_type || msg.media_mime || "application/octet-stream");

      return new Response(JSON.stringify({
        ok: true,
        base64,
        mime_type: mime,
        media_type: msg.media_type,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete-message") {
      const { message_id } = body as { message_id?: string };
      if (!message_id?.trim()) {
        return new Response(JSON.stringify({ error: "message_id é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: msg, error: msgErr } = await admin
        .from("whatsapp_messages")
        .select("id, conversation_id, direction, sent_by, wa_message_id")
        .eq("id", message_id.trim())
        .maybeSingle();
      if (msgErr) throw msgErr;
      if (!msg) {
        return new Response(JSON.stringify({ error: "Mensagem não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.direction !== "out") {
        return new Response(JSON.stringify({ error: "Só é possível excluir mensagens enviadas" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const canDelete = canModerateMessages || msg.sent_by === user.id;
      if (!canDelete) {
        return new Response(JSON.stringify({ error: "Você só pode excluir suas próprias mensagens" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // A Meta Cloud API não expõe endpoint de exclusão de mensagens enviadas —
      // a remoção é feita apenas no histórico do CRM.
      const { error: delErr } = await admin
        .from("whatsapp_messages")
        .delete()
        .eq("id", message_id.trim());
      if (delErr) throw delErr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id } = body as { conversation_id?: string };
    if (!conversation_id?.trim()) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const access = await assertConversationAccess(conversation_id.trim());
    if (!access.conv) {
      return new Response(JSON.stringify({ error: access.error }), {
        status: access.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const conv = access.conv;

    if (!conv.instance_id) {
      return new Response(JSON.stringify({ error: "Conversa sem instance_id — não é possível enviar" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const target = await resolveSendTargetByInstanceId(admin as any, String(conv.instance_id));
    if (!target) {
      return new Response(JSON.stringify({ error: "Instância WhatsApp não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const to = cleanPhone(String(conv.wa_id || ""));
    if (!to) {
      return new Response(JSON.stringify({ error: "wa_id inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sender = await resolveSenderLabel(admin, user.id);

    let text = "";
    let metaTemplateName: string | null = null;
    let metaTemplateLanguage: string | null = null;
    let isTemplate = false;

    async function uploadMediaToMeta(params: {
      phoneNumberId: string;
      accessToken: string;
      mimeType: string;
      filename: string;
      bytes: Uint8Array;
    }): Promise<{ ok: true; id: string } | { ok: false; error: string; raw?: unknown }> {
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/media`;
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", params.mimeType);
      form.append("file", new Blob([params.bytes], { type: params.mimeType }), params.filename);

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}` },
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string } })?.error?.message || `Meta media HTTP ${res.status}`;
        return { ok: false, error: translateWhatsAppError(err), raw: json };
      }
      const id = String((json as { id?: string })?.id || "");
      if (!id) return { ok: false, error: "Meta não retornou media id", raw: json };
      return { ok: true, id };
    }

    async function sendTextMessage(params: {
      phoneNumberId: string;
      accessToken: string;
      to: string;
      text: string;
    }): Promise<{ ok: true; messageId: string | null; raw: unknown } | { ok: false; error: string; raw?: unknown }> {
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: params.to,
          type: "text",
          text: { preview_url: false, body: params.text },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string } })?.error?.message || `Meta send HTTP ${res.status}`;
        return { ok: false, error: translateWhatsAppError(err), raw: json };
      }
      const messageId = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id || null;
      return { ok: true, messageId, raw: json };
    }

    async function sendMediaMessage(params: {
      phoneNumberId: string;
      accessToken: string;
      to: string;
      mediaType: "image" | "audio" | "video" | "document";
      mediaId: string;
      caption?: string;
      filename?: string;
    }): Promise<{ ok: true; messageId: string | null; raw: unknown } | { ok: false; error: string; raw?: unknown }> {
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/messages`;
      const body: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: params.to,
        type: params.mediaType,
      };
      if (params.mediaType === "image") body.image = { id: params.mediaId, ...(params.caption ? { caption: params.caption } : {}) };
      if (params.mediaType === "audio") body.audio = { id: params.mediaId };
      if (params.mediaType === "video") body.video = { id: params.mediaId, ...(params.caption ? { caption: params.caption } : {}) };
      if (params.mediaType === "document") {
        body.document = {
          id: params.mediaId,
          ...(params.filename ? { filename: params.filename } : {}),
          ...(params.caption ? { caption: params.caption } : {}),
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string } })?.error?.message || `Meta send HTTP ${res.status}`;
        return { ok: false, error: translateWhatsAppError(err), raw: json };
      }
      const messageId = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id || null;
      return { ok: true, messageId, raw: json };
    }

    if (action === "send-text") {
      const { text: t } = body as { text?: string };
      text = (t || "").trim();
      if (!text) {
        return new Response(JSON.stringify({ error: "Texto é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      if (action === "send-media") {
        if (target.provider !== "meta" || !target.phoneNumberId) {
          return new Response(JSON.stringify({ error: "Anexos só estão disponíveis na Meta Cloud API" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { media_type, mime_type, filename, base64, caption } = body as {
          media_type?: string;
          mime_type?: string;
          filename?: string;
          base64?: string;
          caption?: string;
        };

        const mediaType = (media_type || "").trim().toLowerCase() as "image" | "audio" | "video" | "document";
        const mimeType = (mime_type || "").trim().toLowerCase();
        const fileName = (filename || "").trim() || "upload";
        const b64 = (base64 || "").trim();

        if (!mediaType || !["image", "audio", "video", "document"].includes(mediaType)) {
          return new Response(JSON.stringify({ error: "media_type inválido (image/audio/video/document)" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!mimeType || !mimeType.includes("/")) {
          return new Response(JSON.stringify({ error: "mime_type é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!b64) {
          return new Response(JSON.stringify({ error: "base64 é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // limite simples para não estourar edge/memória (aprox). Ajuste se necessário.
        if (b64.length > 18_000_000) {
          return new Response(JSON.stringify({ error: "Arquivo muito grande (limite ~13MB em base64)" }), {
            status: 413,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        let bytes: Uint8Array;
        try {
          const bin = atob(b64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch {
          return new Response(JSON.stringify({ error: "base64 inválido" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const normalized = normalizeMetaUploadMime(mediaType, mimeType, fileName);
        if (normalized.reject) {
          return new Response(JSON.stringify({ error: normalized.error || "Formato de áudio não suportado" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const uploaded = await uploadMediaToMeta({
          phoneNumberId: target.phoneNumberId,
          accessToken,
          mimeType: normalized.mime,
          filename: normalized.filename,
          bytes,
        });
        if (!uploaded.ok) {
          const hint = normalized.error ? ` ${normalized.error}` : "";
          return new Response(JSON.stringify({ error: uploaded.error + hint, raw: uploaded.raw }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cap = typeof caption === "string" ? caption.trim() || null : null;

        if (mediaType === "audio") {
          const headerSent = await sendTextMessage({
            phoneNumberId: target.phoneNumberId,
            accessToken,
            to,
            text: formatOutboundWhatsAppBody(sender.sent_by_name, ""),
          });
          if (!headerSent.ok) {
            return new Response(JSON.stringify({ error: headerSent.error, raw: headerSent.raw }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        const captionForMeta = mediaType === "audio"
          ? undefined
          : formatOutboundWhatsAppBody(sender.sent_by_name, cap);

        const sent = await sendMediaMessage({
          phoneNumberId: target.phoneNumberId,
          accessToken,
          to,
          mediaType,
          mediaId: uploaded.id,
          caption: captionForMeta,
          filename: fileName,
        });
        if (!sent.ok) {
          return new Response(JSON.stringify({ error: sent.error, raw: sent.raw }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const now = new Date().toISOString();
        const preview = mediaType === "image"
          ? "📷 Imagem"
          : mediaType === "audio"
          ? "🎤 Áudio"
          : mediaType === "video"
          ? "🎬 Vídeo"
          : "📄 Documento";

        const saved = await insertWhatsAppMessageRow(admin, {
          conversation_id: conv.id,
          direction: "out",
          body: null,
          wa_message_id: sent.messageId,
          status: "sent",
          is_template: false,
          meta_template_name: null,
          created_at: now,
          message_type: "media",
          media_type: mediaType,
          media_mime: normalized.mime,
          media_filename: normalized.filename,
          media_size: bytes.length,
          media_id: uploaded.id,
          caption: cap,
          sent_by: sender.sent_by,
          sent_by_name: sender.sent_by_name,
        });
        if (!saved.ok) {
          return new Response(JSON.stringify({ error: saved.error || "Falha ao salvar mensagem no banco" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await admin.from("whatsapp_conversations").update({
          last_message_at: now,
          last_preview: (preview + (caption?.trim() ? ` · ${caption.trim()}` : "")).slice(0, 200),
          updated_at: now,
        }).eq("id", conv.id);

        return new Response(JSON.stringify({ ok: true, meta_message_id: sent.messageId, media_id: uploaded.id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { template_name, template_language } = body as { template_name?: string; template_language?: string };
      metaTemplateName = (template_name || "").trim() || null;
      metaTemplateLanguage = (template_language || "").trim() || "pt_BR";
      if (!metaTemplateName) {
        return new Response(JSON.stringify({ error: "template_name é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      isTemplate = true;
      text = `📄 Template enviado: ${metaTemplateName}`;
    }

    const textForWhatsApp = action === "send-text"
      ? formatOutboundWhatsAppBody(sender.sent_by_name, text)
      : "";

    // Envio manual de template pelo Inbox não tem um texto de origem no CRM
    // para extrair variáveis ({nome}, etc.) — usamos o nome do contato salvo
    // na conversa para que a Meta receba os parâmetros esperados e não rejeite
    // o template com "Number of parameters does not match" (#132000).
    const templateVars: Record<string, string> = isTemplate
      ? { nome: (conv.contact_name || "").trim() || "Cliente" }
      : {};

    console.log(
      `[whatsapp-chat] send ${action} provider=${target.provider} instance=${conv.instance_id} to=${to} pid=${target.phoneNumberId ?? "—"}`,
    );

    const result = await sendWhatsAppMessage({
      target,
      phone: to,
      text: textForWhatsApp,
      apiFullKey: Deno.env.get("APIFULL_API_KEY") || "",
      metaAccessToken: accessToken,
      metaTemplateName,
      metaTemplateLanguage,
      metaTemplateVars: templateVars,
      metaTemplateMessageSource: isTemplate ? "{nome}" : null,
      supabase: admin as any,
      conversationId: conv.id,
      forceTemplate: isTemplate,
    });

    if (!result.ok) {
      console.warn("[whatsapp-chat] send failed:", result.errorMessage, result.raw);
      return new Response(JSON.stringify({ error: translateWhatsAppError(result.errorMessage || "Falha no envio"), raw: result.raw }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const saved = await insertWhatsAppMessageRow(admin, {
      conversation_id: conv.id,
      direction: "out",
      body: text,
      wa_message_id: result.metaMessageId || null,
      status: "sent",
      is_template: isTemplate,
      meta_template_name: metaTemplateName,
      created_at: now,
      sent_by: sender.sent_by,
      sent_by_name: sender.sent_by_name,
    });
    if (!saved.ok) {
      console.warn("[whatsapp-chat] mensagem enviada na Meta mas falhou ao gravar:", saved.error);
    }
    const convPatch: Record<string, unknown> = {
      last_message_at: now,
      last_preview: text.slice(0, 200),
      updated_at: now,
    };
    if (target.instanceId && !conv.instance_id) {
      convPatch.instance_id = target.instanceId;
    }
    await admin.from("whatsapp_conversations").update(convPatch).eq("id", conv.id);

    return new Response(JSON.stringify({ ok: true, meta_message_id: result.metaMessageId || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("whatsapp-chat error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

