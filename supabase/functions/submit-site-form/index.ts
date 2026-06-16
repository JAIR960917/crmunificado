import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalCorsHeaders } from "../_shared/internalAuth.ts";

const corsHeaders = internalCorsHeaders;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // GET → campos do formulário OU config do site
  if (req.method === "GET") {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");

    if (type === "config") {
      const { data } = await supabase.from("site_web_config").select("key, value");
      const config: Record<string, string> = {};
      for (const row of (data || [])) config[row.key] = row.value;
      return json({ config });
    }

    // padrão: campos ativos do formulário
    const { data, error } = await supabase
      .from("site_form_fields")
      .select("id, label, field_type, placeholder, options, is_required, position")
      .eq("is_active", true)
      .order("position", { ascending: true });
    if (error) return json({ error: "Erro ao carregar formulário." }, 500);
    return json({ fields: data || [] });
  }

  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "submit");

  // pageview analytics
  if (action === "pageview") {
    const { page, session_id, referrer, user_agent } = body as Record<string, string>;
    await supabase.from("site_page_views").insert({
      page: page || "/", session_id: session_id || null,
      referrer: referrer || null, user_agent: user_agent || null,
    }).catch(() => {});
    return json({ ok: true });
  }

  // click analytics
  if (action === "click") {
    const { button_id, button_label, page, session_id } = body as Record<string, string>;
    await supabase.from("site_button_clicks").insert({
      button_id: button_id || null, button_label: button_label || null,
      page: page || "/", session_id: session_id || null,
    }).catch(() => {});
    return json({ ok: true });
  }

  // submit form (lead)
  const nome = String(body.nome || "").trim();
  const email = String(body.email || "").trim();
  const telefone = String(body.telefone || "").trim();
  const data = body.data as Record<string, string> | undefined;

  if (!nome) return json({ error: "Informe seu nome." }, 400);

  const { error } = await supabase.from("site_form_submissions").insert({
    nome: nome || null, email: email || null,
    telefone: telefone || null, data: data ?? {}, status: "novo",
  });

  if (error) {
    console.error("[submit-site-form] insert:", error);
    return json({ error: "Erro ao enviar formulário. Tente novamente." }, 500);
  }

  return json({ ok: true, message: "Formulário enviado com sucesso!" });
});
