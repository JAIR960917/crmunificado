/**
 * Painel admin: configuração e testes da WhatsApp Cloud API (Meta).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_API_VERSION = "v21.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roleRows || []).some((r) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas administradores" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL") || Deno.env.get("SITE_URL") || "";
    const webhookUrl = publicUrl
      ? `${publicUrl.replace(/\/$/, "")}/functions/v1/whatsapp-webhook`
      : "";

    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
    const wabaId = Deno.env.get("WHATSAPP_WABA_ID") || "";

    if (action === "get-status") {
      const { data: providerRow } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("setting_key", "whatsapp_provider")
        .maybeSingle();
      const { data: appIdRow } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("setting_key", "whatsapp_meta_app_id")
        .maybeSingle();
      const { data: metaInstances } = await supabase
        .from("whatsapp_instances")
        .select("id, name, phone_number_id, display_phone, is_active")
        .eq("provider", "meta");

      return new Response(JSON.stringify({
        provider: providerRow?.setting_value || "apifull",
        meta_app_id: appIdRow?.setting_value || "",
        webhook_url: webhookUrl,
        env: {
          access_token: !!accessToken,
          verify_token: !!verifyToken,
          app_secret: !!appSecret,
          waba_id: !!wabaId,
        },
        meta_instances: metaInstances || [],
        privacy_url: `${(Deno.env.get("SITE_URL") || "").replace(/\/$/, "")}/privacidade`,
        terms_url: `${(Deno.env.get("SITE_URL") || "").replace(/\/$/, "")}/termos`,
        data_deletion_url: `${(Deno.env.get("SITE_URL") || "").replace(/\/$/, "")}/exclusao-dados`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "save-settings") {
      const { provider, meta_app_id } = body as { provider?: string; meta_app_id?: string };
      if (provider === "meta" || provider === "apifull") {
        await supabase.from("system_settings").upsert(
          { setting_key: "whatsapp_provider", setting_value: provider },
          { onConflict: "setting_key" },
        );
      }
      if (typeof meta_app_id === "string") {
        await supabase.from("system_settings").upsert(
          { setting_key: "whatsapp_meta_app_id", setting_value: meta_app_id },
          { onConflict: "setting_key" },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create-meta-instance") {
      const { name, phone_number_id, waba_id, display_phone, meta_default_template } = body as {
        name?: string;
        phone_number_id?: string;
        waba_id?: string;
        display_phone?: string;
        meta_default_template?: string;
      };
      if (!name?.trim() || !phone_number_id?.trim()) {
        return new Response(JSON.stringify({ error: "Nome e Phone Number ID são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const pid = phone_number_id.trim();
      const { error } = await supabase.from("whatsapp_instances").insert({
        name: name.trim(),
        session: pid,
        provider: "meta",
        phone_number_id: pid,
        waba_id: waba_id?.trim() || wabaId || null,
        display_phone: display_phone?.trim() || null,
        meta_default_template: meta_default_template?.trim() || null,
        company_id: null,
        is_active: true,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "test-connection") {
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado no servidor" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const waba = wabaId || body.waba_id;
      if (!waba) {
        return new Response(JSON.stringify({ error: "WHATSAPP_WABA_ID não configurado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}?fields=id,name,account_review_status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: json?.error?.message || "Falha na API Meta", raw: json }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, waba: json }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-templates") {
      if (!accessToken || !wabaId) {
        return new Response(JSON.stringify({ error: "Token ou WABA ID ausente" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: json?.error?.message || "Erro ao listar templates" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const templates = ((json.data as unknown[]) || []).map((t: Record<string, unknown>) => ({
        name: t.name,
        status: t.status,
        category: t.category,
        language: t.language,
      }));
      return new Response(JSON.stringify({ templates }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("meta-whatsapp error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
