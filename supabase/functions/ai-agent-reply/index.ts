/**
 * Callback do agente de IA (n8n): envia a resposta gerada pela IA de volta
 * para o cliente no WhatsApp e grava no histórico do Inbox.
 *
 * Autenticação: header `x-ai-agent-secret` deve bater com
 * whatsapp_instances.ai_webhook_secret da instância da conversa (não usa
 * login de usuário — quem chama é o workflow n8n, não um atendente).
 *
 * Body esperado: { conversation_id: string, message: string }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insertWhatsAppMessageRow } from "../_shared/whatsappInboxMedia.ts";
import { cleanPhone, resolveSendTargetByInstanceId, sendWhatsAppMessage, translateWhatsAppError } from "../_shared/whatsappSend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ai-agent-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const { conversation_id, message } = body as { conversation_id?: string; message?: string };
    const text = (message || "").trim();

    if (!conversation_id?.trim()) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!text) {
      return new Response(JSON.stringify({ error: "message é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conv, error: convErr } = await admin
      .from("whatsapp_conversations")
      .select("id, instance_id, wa_id, ai_active")
      .eq("id", conversation_id.trim())
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: instance, error: instErr } = await admin
      .from("whatsapp_instances")
      .select("id, ai_enabled, ai_webhook_secret")
      .eq("id", conv.instance_id)
      .maybeSingle();
    if (instErr) throw instErr;

    const secretHeader = req.headers.get("x-ai-agent-secret") || "";
    if (!instance?.ai_webhook_secret || secretHeader !== instance.ai_webhook_secret) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!instance.ai_enabled) {
      return new Response(JSON.stringify({ error: "IA desabilitada para este número" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se um atendente assumiu a conversa entre o encaminhamento e esta
    // resposta, não envia (evita IA e humano respondendo ao mesmo tempo).
    if (conv.ai_active === false) {
      return new Response(JSON.stringify({ ok: false, skipped: "ai_inactive" }), {
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

    const result = await sendWhatsAppMessage({
      target,
      phone: to,
      text,
      apiFullKey: Deno.env.get("APIFULL_API_KEY") || "",
      metaAccessToken: Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "",
      metaTemplateBodyParams: [],
      supabase: admin as any,
      conversationId: conv.id,
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: translateWhatsAppError(result.errorMessage || "Falha no envio") }), {
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
      is_template: false,
      meta_template_name: null,
      created_at: now,
      sent_by: null,
      sent_by_name: "Agente IA",
    });
    if (!saved.ok) {
      console.warn("[ai-agent-reply] mensagem enviada mas falhou ao gravar:", saved.error);
    }

    await admin.from("whatsapp_conversations").update({
      last_message_at: now,
      last_preview: text.slice(0, 200),
      updated_at: now,
    }).eq("id", conv.id);

    return new Response(JSON.stringify({ ok: true, meta_message_id: result.metaMessageId || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ai-agent-reply error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
