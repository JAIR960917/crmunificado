/**
 * Envio manual pelo Inbox (texto/template) via Meta Cloud API.
 * Grava mensagem "out" em whatsapp_messages e atualiza preview da conversa.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserFromRequest, getUserRoles } from "../_shared/staffAuth.ts";
import { cleanPhone, resolveSendTargetByInstanceId, sendWhatsAppMessage, translateWhatsAppError } from "../_shared/whatsappSend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = new Set(["admin", "gerente", "vendedor", "financeiro"]);

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

    if (action !== "send-text" && action !== "send-template") {
      return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
        status: 400,
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

    const { data: conv, error: convErr } = await admin
      .from("whatsapp_conversations")
      .select("id, instance_id, wa_id")
      .eq("id", conversation_id.trim())
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!conv.instance_id) {
      return new Response(JSON.stringify({ error: "Conversa sem instance_id — não é possível enviar" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPrivileged = roles.some((r) => r === "admin" || r === "gerente");
    if (!isPrivileged) {
      const { data: allowed } = await admin
        .from("whatsapp_instance_assignments")
        .select("id")
        .eq("user_id", user.id)
        .eq("instance_id", conv.instance_id)
        .maybeSingle();
      if (!allowed?.id) {
        return new Response(JSON.stringify({ error: "Você não tem acesso a este número WhatsApp" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    let text = "";
    let metaTemplateName: string | null = null;
    let metaTemplateLanguage: string | null = null;
    let isTemplate = false;

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
      text = `[Template] ${metaTemplateName}`;
    }

    const result = await sendWhatsAppMessage({
      target,
      phone: to,
      text: action === "send-text" ? text : "",
      metaAccessToken: accessToken,
      metaTemplateName,
      metaTemplateLanguage,
      metaTemplateBodyParams: [],
      supabase: admin as any,
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: translateWhatsAppError(result.errorMessage || "Falha no envio"), raw: result.raw }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    await admin.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "out",
      body: action === "send-text" ? text : null,
      wa_message_id: result.metaMessageId || null,
      status: "sent",
      is_template: isTemplate,
      meta_template_name: metaTemplateName,
      created_at: now,
    });
    await admin.from("whatsapp_conversations").update({
      last_message_at: now,
      last_preview: (action === "send-text" ? text : `[Template] ${metaTemplateName}`).slice(0, 200),
      updated_at: now,
    }).eq("id", conv.id);

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

