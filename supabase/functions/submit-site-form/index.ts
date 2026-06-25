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
    const { page, session_id } = body as Record<string, string>;
    const { error: pvErr } = await supabase.from("site_page_views").insert({
      page: (page || "/").slice(0, 512),
      session_id: session_id ? String(session_id).slice(0, 128) : null,
      referrer: null,
      user_agent: null,
    });
    if (pvErr) console.error("[submit-site-form] pageview insert error:", pvErr.message);
    return json({ ok: !pvErr });
  }

  // click analytics
  if (action === "click") {
    const { button_id, button_label, page, session_id } = body as Record<string, string>;
    const { error: clErr } = await supabase.from("site_button_clicks").insert({
      button_id: button_id ? String(button_id).slice(0, 128) : null,
      button_label: button_label ? String(button_label).slice(0, 256) : null,
      page: (page || "/").slice(0, 512),
      session_id: session_id ? String(session_id).slice(0, 128) : null,
    });
    if (clErr) console.error("[submit-site-form] click insert error:", clErr.message);
    return json({ ok: !clErr });
  }

  // submit form (lead)
  const nome = String(body.nome || "").trim().slice(0, 256);
  const email = String(body.email || "").trim().slice(0, 256);
  const telefone = String(body.telefone || "").trim().slice(0, 32);
  const data = body.data as Record<string, string> | undefined;

  if (!nome) return json({ error: "Informe seu nome." }, 400);

  // Rate limit: máx. 30 submissões nos últimos 10 minutos
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("site_form_submissions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", tenMinAgo);
  if ((recentCount ?? 0) >= 30) {
    return json({ error: "Muitas solicitações recentes. Tente novamente em alguns minutos." }, 429);
  }

  // Verifica duplicata por e-mail ou telefone usando queries parametrizadas separadas
  // (evita injeção PostgREST via interpolação de string em .or())
  if (email || telefone) {
    let duplicate = false;
    if (email) {
      const { data } = await supabase
        .from("site_form_submissions")
        .select("id")
        .eq("email", email)
        .limit(1);
      if (data && data.length > 0) duplicate = true;
    }
    if (!duplicate && telefone) {
      const { data } = await supabase
        .from("site_form_submissions")
        .select("id")
        .eq("telefone", telefone)
        .limit(1);
      if (data && data.length > 0) duplicate = true;
    }
    if (duplicate) {
      return json({
        error: "Já recebemos uma candidatura com este e-mail ou telefone. Nossa equipe entrará em contato em breve!",
        duplicate: true,
      }, 409);
    }
  }

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
