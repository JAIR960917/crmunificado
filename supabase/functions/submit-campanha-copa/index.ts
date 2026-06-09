import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalCorsHeaders } from "../_shared/internalAuth.ts";

const corsHeaders = internalCorsHeaders;

function cleanPhone(phone: string): string {
  let clean = (phone || "").replace(/\D/g, "");
  if (!clean) return "";
  if (clean.startsWith("0")) clean = clean.substring(1);
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const nome = String(body.nome || "").trim();
    const idade = String(body.idade || "").trim();
    const cidade = String(body.cidade || "").trim();
    const telefoneRaw = String(body.telefone || "").trim();
    const usaOculos = String(body.usa_oculos || "").trim();
    const ultimoExame = String(body.ultimo_exame_vista || "").trim();
    const palpiteBrasil = Number(body.palpite_brasil);
    const palpiteMarrocos = Number(body.palpite_marrocos);
    const consentimento = body.consentimento_marketing === true
      || body.consentimento_marketing === "true"
      || body.consentimento_marketing === "on";

    if (!nome) return jsonResponse({ error: "Informe seu nome completo." }, 400);
    if (!idade) return jsonResponse({ error: "Informe sua idade." }, 400);
    if (!cidade) return jsonResponse({ error: "Informe sua cidade." }, 400);

    const telefone = cleanPhone(telefoneRaw);
    if (telefone.length < 12) {
      return jsonResponse({ error: "Informe um telefone válido com DDD." }, 400);
    }

    if (!usaOculos || !["sim", "nao", "não"].includes(usaOculos.toLowerCase())) {
      return jsonResponse({ error: "Informe se você usa óculos de grau." }, 400);
    }

    if (!ultimoExame) {
      return jsonResponse({ error: "Informe quando foi seu último exame de vista." }, 400);
    }

    if (!Number.isFinite(palpiteBrasil) || palpiteBrasil < 0 || palpiteBrasil > 99) {
      return jsonResponse({ error: "Informe o palpite de gols do Brasil." }, 400);
    }

    if (!Number.isFinite(palpiteMarrocos) || palpiteMarrocos < 0 || palpiteMarrocos > 99) {
      return jsonResponse({ error: "Informe o palpite de gols do Marrocos." }, 400);
    }

    if (!consentimento) {
      return jsonResponse({ error: "É necessário autorizar o uso dos dados para participar." }, 400);
    }

    const palpiteTexto = `${palpiteBrasil} x ${palpiteMarrocos}`;
    const usaOculosNorm = usaOculos.toLowerCase().startsWith("s") ? "sim" : "nao";

    const { data: setting } = await supabase
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", "campanha_copa_default_user_id")
      .maybeSingle();

    const defaultUserId = (setting?.setting_value || "").trim() || null;

    const leadData: Record<string, unknown> = {
      origem_campanha: "copa",
      nome_lead: nome,
      telefone,
      idade,
      cidade,
      usa_oculos: usaOculosNorm,
      ultimo_exame_vista: ultimoExame,
      palpite_brasil: palpiteBrasil,
      palpite_marrocos: palpiteMarrocos,
      palpite: palpiteTexto,
      consentimento_marketing: true,
    };

    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .insert({
        data: leadData,
        status: "campanha_copa",
        assigned_to: defaultUserId,
        created_by: defaultUserId,
      })
      .select("id")
      .single();

    if (leadError) {
      console.error("[submit-campanha-copa] lead insert:", leadError);
      return jsonResponse({ error: "Não foi possível registrar sua inscrição. Tente novamente." }, 500);
    }

    const { data: submission, error: subError } = await supabase
      .from("campanha_copa_submissions")
      .insert({
        lead_id: lead.id,
        nome,
        idade,
        cidade,
        telefone,
        usa_oculos: usaOculosNorm,
        ultimo_exame_vista: ultimoExame,
        palpite_brasil: palpiteBrasil,
        palpite_marrocos: palpiteMarrocos,
        palpite_texto: palpiteTexto,
        consentimento_marketing: true,
        assigned_to: defaultUserId,
      })
      .select("id")
      .single();

    if (subError) {
      console.error("[submit-campanha-copa] submission insert:", subError);
      return jsonResponse({ error: "Inscrição parcial — contate o suporte." }, 500);
    }

    return jsonResponse({
      ok: true,
      id: submission.id,
      message: "Inscrição realizada com sucesso! Boa sorte no sorteio.",
    });
  } catch (e) {
    console.error("[submit-campanha-copa]", e);
    return jsonResponse({ error: "Erro interno. Tente novamente em instantes." }, 500);
  }
});
