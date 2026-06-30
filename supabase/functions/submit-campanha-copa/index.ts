import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalCorsHeaders } from "../_shared/internalAuth.ts";
import { loadCampanhaCopaJogoConfig } from "../_shared/campanhaCopaJogo.ts";
import {
  evaluateCampanhaCopaPeriodo,
  loadCampanhaCopaPeriodoConfig,
} from "../_shared/campanhaCopaPeriodo.ts";
import { loadCampanhaCopaSuccessConfig } from "../_shared/campanhaCopaSuccess.ts";
import {
  applyUltimoExameVistaToLeadData,
  loadJaFezExameVistaFieldId,
  loadLeadLastVisitFieldId,
} from "../_shared/campanhaCopaExameVista.ts";
import {
  applyFormaCaptacaoToLeadData,
  loadFormaCaptacaoFieldId,
} from "../_shared/campanhaCopaFormaCaptacao.ts";

const corsHeaders = internalCorsHeaders;

function cleanPhone(phone: string): string {
  let clean = (phone || "").replace(/\D/g, "");
  if (!clean) return "";
  if (clean.startsWith("0")) clean = clean.substring(1);
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
}

function cleanCpf(cpf: string): string {
  return (cpf || "").replace(/\D/g, "");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
}

function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadPublicConfig(supabase: ReturnType<typeof createClient>) {
  const jogo = await loadCampanhaCopaJogoConfig(supabase);
  const periodoCfg = await loadCampanhaCopaPeriodoConfig(supabase);
  const periodo = evaluateCampanhaCopaPeriodo(periodoCfg.inicio, periodoCfg.fim);
  const successCfg = await loadCampanhaCopaSuccessConfig(supabase);

  const { data } = await supabase
    .from("system_settings")
    .select("setting_key, setting_value")
    .in("setting_key", [
      "system_name",
      "logo_url",
      "campanha_copa_banner_url",
      "campanha_copa_pixel_form",
      "campanha_copa_pixel_success",
    ]);

  const map = new Map((data || []).map((r) => [r.setting_key, r.setting_value || ""]));

  return {
    system_name: map.get("system_name") || "Óticas Joonker",
    logo_url: map.get("logo_url") || "",
    banner_url: map.get("campanha_copa_banner_url") || "",
    pixel_form: map.get("campanha_copa_pixel_form") || "",
    pixel_success: map.get("campanha_copa_pixel_success") || "",
    periodo_aberto: periodo.aberto,
    periodo_mensagem: periodo.mensagem,
    periodo_inicio: periodo.inicio,
    periodo_fim: periodo.fim,
    jogo_key: jogo.jogo_key,
    jogo_label: jogo.jogo_label,
    team_home_name: jogo.team_home_name,
    team_away_name: jogo.team_away_name,
    team_home_flag: jogo.team_home_flag,
    team_away_flag: jogo.team_away_flag,
    match_meta: jogo.match_meta,
    success_image_url: successCfg.image_url,
    success_title: successCfg.title,
    success_subtitle: successCfg.subtitle,
    success_instagram_url: successCfg.instagram_url,
    success_button_label: successCfg.button_label,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  if (req.method === "GET") {
    return jsonResponse(await loadPublicConfig(supabase));
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const jogoCfg = await loadCampanhaCopaJogoConfig(supabase);
    const periodoCfg = await loadCampanhaCopaPeriodoConfig(supabase);
    const periodo = evaluateCampanhaCopaPeriodo(periodoCfg.inicio, periodoCfg.fim);
    if (!periodo.aberto) {
      return jsonResponse({
        error: periodo.mensagem || "O período para envio de palpites está encerrado.",
      }, 403);
    }

    const nome = String(body.nome || "").trim();
    const cpfRaw = String(body.cpf || "").trim();
    const idade = String(body.idade || "").trim();
    const cidade = String(body.cidade || "").trim();
    const telefoneRaw = String(body.telefone || "").trim();
    const usaOculos = String(body.usa_oculos || "").trim();
    const sintomas = toStringArray(body.sintomas);
    const doencas = toStringArray(body.doencas);
    const ultimoExame = String(body.ultimo_exame_vista || "").trim();
    const palpiteHome = Number(body.palpite_home ?? body.palpite_brasil);
    const palpiteAway = Number(body.palpite_away ?? body.palpite_marrocos);
    const consentimento = body.consentimento_marketing === true
      || body.consentimento_marketing === "true"
      || body.consentimento_marketing === "on";

    const trackingSlug = String(body.tracking_slug || "").trim().slice(0, 80) || null;
    const clientJogoKey = String(body.jogo_key || "").trim();
    if (clientJogoKey && clientJogoKey !== jogoCfg.jogo_key) {
      return jsonResponse({
        error: "O jogo foi atualizado. Recarregue a página e envie seu palpite novamente.",
      }, 409);
    }

    if (!nome) return jsonResponse({ error: "Informe seu nome completo." }, 400);

    const cpf = cleanCpf(cpfRaw);
    if (!cpf) return jsonResponse({ error: "Informe seu CPF." }, 400);
    if (!isValidCpf(cpf)) return jsonResponse({ error: "Informe um CPF válido." }, 400);

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

    if (!Number.isFinite(palpiteHome) || palpiteHome < 0 || palpiteHome > 99) {
      return jsonResponse({
        error: `Informe o palpite de gols do ${jogoCfg.team_home_name}.`,
      }, 400);
    }

    if (!Number.isFinite(palpiteAway) || palpiteAway < 0 || palpiteAway > 99) {
      return jsonResponse({
        error: `Informe o palpite de gols do ${jogoCfg.team_away_name}.`,
      }, 400);
    }

    if (!consentimento) {
      return jsonResponse({ error: "É necessário autorizar o uso dos dados para participar." }, 400);
    }

    const jogoKey = jogoCfg.jogo_key;

    const { data: existing } = await supabase
      .from("campanha_copa_submissions")
      .select("id")
      .eq("cpf", cpf)
      .eq("jogo", jogoKey)
      .maybeSingle();

    if (existing?.id) {
      return jsonResponse({ error: "O CPF já registrou um Palpite." }, 409);
    }

    // Mesma regra do CPF, mas pelo telefone — evita que a mesma pessoa
    // participe mais de uma vez no mesmo jogo só trocando o CPF informado
    // (ou vice-versa).
    const { data: existingByPhone } = await supabase
      .from("campanha_copa_submissions")
      .select("id")
      .eq("telefone", telefone)
      .eq("jogo", jogoKey)
      .maybeSingle();

    if (existingByPhone?.id) {
      return jsonResponse({ error: "Esse telefone já registrou um Palpite." }, 409);
    }

    const palpiteTexto = `${palpiteHome} x ${palpiteAway}`;
    const usaOculosNorm = usaOculos.toLowerCase().startsWith("s") ? "sim" : "nao";

    // O palpite é registrado e o lead já é criado automaticamente na coluna
    // "Participando da campanha atual" — o envio manual via Campanhas Copa
    // (campanha-copa-send-to-leads) continua existindo só para inscrições
    // antigas que ficaram sem lead vinculado.
    const { data: submission, error: subError } = await supabase
      .from("campanha_copa_submissions")
      .insert({
        lead_id: null,
        nome,
        cpf,
        idade,
        cidade,
        telefone,
        usa_oculos: usaOculosNorm,
        sintomas,
        doencas,
        ultimo_exame_vista: ultimoExame,
        palpite_brasil: palpiteHome,
        palpite_marrocos: palpiteAway,
        palpite_texto: palpiteTexto,
        jogo: jogoKey,
        jogo_label: jogoCfg.jogo_label,
        consentimento_marketing: true,
        assigned_to: null,
        tracking_slug: trackingSlug,
      })
      .select("id")
      .single();

    if (subError) {
      if (subError.code === "23505") {
        return jsonResponse({ error: "Esse CPF ou telefone já registrou um Palpite." }, 409);
      }
      console.error("[submit-campanha-copa] submission insert:", subError);
      return jsonResponse({ error: "Inscrição parcial — contate o suporte." }, 500);
    }

    const lastVisitFieldId = await loadLeadLastVisitFieldId(supabase);
    const jaFezExameVistaField = await loadJaFezExameVistaFieldId(supabase);
    const formaCaptacaoFieldId = await loadFormaCaptacaoFieldId(supabase);
    const leadData: Record<string, unknown> = {
      origem_campanha: "copa",
      nome_lead: nome,
      cpf,
      telefone,
      idade,
      cidade,
      usa_oculos: usaOculosNorm,
      sintomas,
      doencas,
      palpite_home: palpiteHome,
      palpite_away: palpiteAway,
      palpite_brasil: palpiteHome,
      palpite_marrocos: palpiteAway,
      palpite: palpiteTexto,
      jogo: jogoKey,
      jogo_label: jogoCfg.jogo_label,
      team_home_name: jogoCfg.team_home_name,
      team_away_name: jogoCfg.team_away_name,
      consentimento_marketing: true,
      ...(trackingSlug ? { tracking_slug: trackingSlug } : {}),
    };
    applyUltimoExameVistaToLeadData(leadData, ultimoExame, lastVisitFieldId, jaFezExameVistaField);
    applyFormaCaptacaoToLeadData(leadData, formaCaptacaoFieldId);

    const { data: lead, error: leadErr } = await supabase
      .from("crm_leads")
      .insert({
        data: leadData,
        status: "participando_campanha_atual",
        assigned_to: null,
        created_by: null,
      })
      .select("id")
      .single();

    if (leadErr || !lead) {
      console.error("[submit-campanha-copa] lead insert:", leadErr);
    } else {
      const { error: linkErr } = await supabase
        .from("campanha_copa_submissions")
        .update({ lead_id: lead.id })
        .eq("id", submission.id);
      if (linkErr) {
        console.error("[submit-campanha-copa] vincular lead_id:", linkErr);
      }
    }

    await supabase.from("campanha_copa_history").insert({
      submission_id: submission.id,
      user_id: null,
      action: "created",
      summary: `Inscrição recebida via formulário público — palpite ${palpiteTexto} (${jogoCfg.jogo_label}).`,
    });

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
