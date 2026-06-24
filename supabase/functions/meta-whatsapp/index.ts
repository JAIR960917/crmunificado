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
    const roles = (roleRows || []).map((r) => r.role);
    const isAdmin = roles.includes("admin");

    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // list-templates só LÊ os templates aprovados na Meta (sem expor
    // token/config) — qualquer usuário com acesso ao Inbox WhatsApp precisa
    // disso pra mandar template, não só admin. As demais ações (config da
    // WABA, tokens, etc.) continuam só pra admin.
    const STAFF_ROLES = new Set(["admin", "gerente", "vendedor", "financeiro"]);
    const isStaff = roles.some((r) => STAFF_ROLES.has(r));
    const allowed = action === "list-templates" ? isStaff : isAdmin;
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Apenas administradores" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        .select("id, name, phone_number_id, waba_id, display_phone, meta_default_template, meta_template_language, is_active, ai_enabled, ai_webhook_url, ai_webhook_secret")
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

    if (action === "update-meta-instance") {
      const { id, meta_default_template, meta_template_language, waba_id, ai_enabled, ai_webhook_url, ai_webhook_secret } = body as {
        id?: string;
        meta_default_template?: string | null;
        meta_template_language?: string | null;
        waba_id?: string | null;
        ai_enabled?: boolean;
        ai_webhook_url?: string | null;
        ai_webhook_secret?: string | null;
      };

      if (!id?.trim()) {
        return new Response(JSON.stringify({ error: "ID da instância é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload: Record<string, unknown> = {};
      if (meta_default_template === null || typeof meta_default_template === "string") {
        payload.meta_default_template = meta_default_template?.trim() || null;
      }
      if (meta_template_language === null || typeof meta_template_language === "string") {
        payload.meta_template_language = (meta_template_language?.trim() || "pt_BR");
      }
      if (waba_id === null || typeof waba_id === "string") {
        payload.waba_id = waba_id?.trim() || null;
      }
      if (typeof ai_enabled === "boolean") {
        payload.ai_enabled = ai_enabled;
      }
      if (ai_webhook_url === null || typeof ai_webhook_url === "string") {
        payload.ai_webhook_url = ai_webhook_url?.trim() || null;
      }
      if (ai_webhook_secret === null || typeof ai_webhook_secret === "string") {
        payload.ai_webhook_secret = ai_webhook_secret?.trim() || null;
      }

      const { data: row, error: rowErr } = await supabase
        .from("whatsapp_instances")
        .select("id, provider")
        .eq("id", id.trim())
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        return new Response(JSON.stringify({ error: "Instância não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.provider !== "meta") {
        return new Response(JSON.stringify({ error: "Apenas instâncias Meta podem ser editadas aqui" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("whatsapp_instances")
        .update(payload)
        .eq("id", id.trim());
      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    /** Descobre o WABA ID vinculado a um Phone Number ID (útil ao cadastrar instâncias). */
    if (action === "resolve-waba-from-phone") {
      const { phone_number_id } = body as { phone_number_id?: string };
      const pid = phone_number_id?.trim();
      if (!pid) {
        return new Response(JSON.stringify({ error: "Phone Number ID é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado no servidor" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pid}?fields=whatsapp_business_account`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({
          error: (json as { error?: { message?: string } })?.error?.message || "Falha ao consultar número na Meta",
          raw: json,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const waba = (json as { whatsapp_business_account?: { id?: string; name?: string } })?.whatsapp_business_account;
      return new Response(JSON.stringify({
        waba_id: waba?.id || null,
        waba_name: waba?.name || null,
        fallback_env_waba_id: wabaId || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    /** Verifica se a WABA está inscrita no app (causa #1 de mensagens reais não chegarem no webhook). */
    if (action === "check-webhook-setup") {
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const waba = (body as { waba_id?: string }).waba_id?.trim() || wabaId;
      if (!waba) {
        return new Response(JSON.stringify({ error: "WHATSAPP_WABA_ID não configurado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const subRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const subscribed = await subRes.json();

      const wabaPhonesRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/phone_numbers?fields=id,display_phone_number,verified_name,status`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const wabaPhonesJson = await wabaPhonesRes.json();
      const wabaPhones = ((wabaPhonesJson as { data?: unknown[] }).data || []) as {
        id: string;
        display_phone_number?: string;
        status?: string;
      }[];

      const { data: metaInstances } = await supabase
        .from("whatsapp_instances")
        .select("id, name, phone_number_id, display_phone, waba_id")
        .eq("provider", "meta");

      const phoneChecks: Record<string, unknown>[] = [];
      for (const inst of metaInstances || []) {
        const pid = inst.phone_number_id?.trim();
        if (!pid) continue;
        const pRes = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${pid}?fields=display_phone_number,verified_name,status,code_verification_status,quality_rating,platform_type`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const pJson = await pRes.json();
        phoneChecks.push({
          instance_id: inst.id,
          instance_name: inst.name,
          phone_number_id: pid,
          ok: pRes.ok,
          error: pRes.ok ? null : (pJson as { error?: { message?: string } })?.error?.message,
          ...(pRes.ok ? pJson : {}),
        });
      }

      const appSubscribed = subRes.ok && Array.isArray((subscribed as { data?: unknown[] }).data)
        && ((subscribed as { data: unknown[] }).data.length > 0);

      const hints: string[] = [];
      if (!appSubscribed) {
        hints.push(
          "A WABA não está inscrita no app. Use «Inscrever WABA no webhook».",
          "O botão «Teste» da Meta usa phone_number_id fictício (123456123) — não prova que mensagens do celular chegam.",
        );
      }

      const crmIds = new Set((metaInstances || []).map((i) => i.phone_number_id?.trim()).filter(Boolean));
      for (const wp of wabaPhones) {
        if (!crmIds.has(wp.id)) {
          hints.push(
            `Número na Meta ${wp.display_phone_number || "?"} tem Phone Number ID ${wp.id} — não está no CRM. Cadastre em API Meta.`,
          );
        }
      }
      for (const inst of metaInstances || []) {
        const pid = inst.phone_number_id?.trim();
        if (pid && !wabaPhones.some((wp) => wp.id === pid)) {
          hints.push(`CRM tem phone_number_id ${pid} (${inst.name}) que não existe na WABA — corrija o cadastro.`);
        }
      }

      return new Response(JSON.stringify({
        waba_id: waba,
        app_subscribed_to_waba: appSubscribed,
        subscribed_apps: subscribed,
        waba_phone_numbers: wabaPhones,
        crm_instances: metaInstances || [],
        phone_numbers: phoneChecks,
        webhook_url: webhookUrl,
        hints,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    /** Inscreve o app na WABA para receber webhooks de mensagens reais. */
    if (action === "subscribe-waba") {
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const waba = (body as { waba_id?: string }).waba_id?.trim() || wabaId;
      if (!waba) {
        return new Response(JSON.stringify({ error: "WHATSAPP_WABA_ID não configurado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const postRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/subscribed_apps`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const postJson = await postRes.json();
      if (!postRes.ok) {
        return new Response(JSON.stringify({
          error: (postJson as { error?: { message?: string } })?.error?.message || "Falha ao inscrever WABA",
          raw: postJson,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const getRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/subscribed_apps`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const getJson = await getRes.json();

      return new Response(JSON.stringify({
        ok: true,
        subscribe_result: postJson,
        subscribed_apps: getJson,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    /** Registra número na Cloud API (Pendente → CONNECTED). Exige PIN de 6 dígitos. */
    if (action === "register-meta-phone") {
      const { phone_number_id, pin } = body as { phone_number_id?: string; pin?: string };
      const pid = phone_number_id?.trim();
      const pinStr = String(pin ?? "").replace(/\D/g, "");
      if (!pid) {
        return new Response(JSON.stringify({ error: "Phone Number ID é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (pinStr.length !== 6) {
        return new Response(JSON.stringify({ error: "Informe o PIN de verificação em 2 etapas (6 dígitos)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN não configurado no servidor" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const registerRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pid}/register`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messaging_product: "whatsapp", pin: pinStr }),
        },
      );
      const registerJson = await registerRes.json();
      if (!registerRes.ok) {
        const msg = (registerJson as { error?: { message?: string; code?: number } })?.error?.message
          || "Falha ao registrar número na Meta";
        return new Response(JSON.stringify({ error: msg, raw: registerJson }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const statusRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${pid}?fields=display_phone_number,verified_name,status,code_verification_status,quality_rating`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const statusJson = await statusRes.json();

      return new Response(JSON.stringify({
        ok: true,
        register_result: registerJson,
        phone_status: statusRes.ok ? statusJson : null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
