// Envia inscrições da Campanha Copa para a coluna "Campanha Copa" da tela de
// Leads. Ação manual (admin/gerente) — leads NÃO são criados automaticamente
// no envio do formulário público (ver submit-campanha-copa).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertAdminOrGerente, getUserFromRequest } from "../_shared/staffAuth.ts";
import { loadCampanhaCopaJogoConfig } from "../_shared/campanhaCopaJogo.ts";
import {
  applyUltimoExameVistaToLeadData,
  loadJaFezExameVistaFieldId,
  loadLeadLastVisitFieldId,
} from "../_shared/campanhaCopaExameVista.ts";
import {
  applyFormaCaptacaoToLeadData,
  loadFormaCaptacaoFieldId,
} from "../_shared/campanhaCopaFormaCaptacao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeDigits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

function buildCopaNoteContent(sub: SubmissionRow): string {
  const palpite = sub.palpite_texto
    || (sub.palpite_brasil != null && sub.palpite_marrocos != null
      ? `${sub.palpite_brasil} x ${sub.palpite_marrocos}`
      : null);
  const jogo = sub.jogo_label || "Campanha Copa";
  return palpite
    ? `🏆 Participou da Campanha Copa (${jogo}) — palpite: ${palpite}.`
    : `🏆 Participou da Campanha Copa (${jogo}).`;
}

type SubmissionRow = {
  id: string;
  lead_id: string | null;
  nome: string;
  cpf: string | null;
  idade: string | null;
  cidade: string | null;
  telefone: string;
  usa_oculos: string | null;
  sintomas: string[] | null;
  doencas: string[] | null;
  ultimo_exame_vista: string | null;
  palpite_brasil: number | null;
  palpite_marrocos: number | null;
  palpite_texto: string | null;
  jogo: string | null;
  jogo_label: string | null;
  assigned_to: string | null;
  consentimento_marketing: boolean | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user, response: authResp } = await getUserFromRequest(req, supabaseUrl, serviceKey);
    if (authResp) return authResp;

    const forbidden = await assertAdminOrGerente(admin, user!.id, corsHeaders);
    if (forbidden) return forbidden;

    const { submissionIds } = await req.json().catch(() => ({})) as { submissionIds?: unknown };
    const ids = Array.isArray(submissionIds)
      ? submissionIds.map((id) => String(id)).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: "Informe ao menos uma inscrição." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error: rowsErr } = await admin
      .from("campanha_copa_submissions")
      .select(
        "id, lead_id, nome, cpf, idade, cidade, telefone, usa_oculos, sintomas, doencas, ultimo_exame_vista, palpite_brasil, palpite_marrocos, palpite_texto, jogo, jogo_label, assigned_to, consentimento_marketing",
      )
      .in("id", ids);

    if (rowsErr) {
      console.error("[campanha-copa-send-to-leads] erro ao buscar submissions:", rowsErr);
      return new Response(JSON.stringify({ error: "Erro ao buscar inscrições" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jogoCfg = await loadCampanhaCopaJogoConfig(admin);
    const lastVisitFieldId = await loadLeadLastVisitFieldId(admin);
    const jaFezExameVistaField = await loadJaFezExameVistaFieldId(admin);
    const formaCaptacaoFieldId = await loadFormaCaptacaoFieldId(admin);

    const results: { submissionId: string; status: "sent" | "already_sent" | "error"; leadId?: string; error?: string }[] = [];

    for (const id of ids) {
      const sub = (rows ?? []).find((r) => r.id === id) as SubmissionRow | undefined;
      if (!sub) {
        results.push({ submissionId: id, status: "error", error: "Inscrição não encontrada" });
        continue;
      }
      if (sub.lead_id) {
        results.push({ submissionId: id, status: "already_sent", leadId: sub.lead_id });
        continue;
      }

      // Antes de criar um lead novo, verifica se já existe ALGUM lead (de
      // qualquer origem) com o mesmo telefone — evita duplicar quem já está
      // na tela de Leads. Se existir, só registra um comentário nele.
      const phoneSuffix = normalizeDigits(sub.telefone).slice(-8);
      let existingLeadId: string | null = null;
      if (phoneSuffix.length === 8) {
        const { data: matchRows, error: matchErr } = await admin.rpc(
          "find_lead_by_phone_suffix",
          { p_phone_suffix: phoneSuffix },
        );
        if (matchErr) {
          console.error("[campanha-copa-send-to-leads] erro ao verificar duplicidade:", matchErr);
        } else {
          existingLeadId = (matchRows as { id: string }[] | null)?.[0]?.id ?? null;
        }
      }

      if (existingLeadId) {
        const { error: noteErr } = await admin.from("crm_lead_notes").insert({
          lead_id: existingLeadId,
          user_id: user!.id,
          content: buildCopaNoteContent(sub),
        });
        if (noteErr) {
          console.error("[campanha-copa-send-to-leads] erro ao registrar comentário:", noteErr);
          results.push({ submissionId: id, status: "error", error: "Erro ao registrar comentário no lead existente" });
          continue;
        }

        const { error: updErr } = await admin
          .from("campanha_copa_submissions")
          .update({ lead_id: existingLeadId })
          .eq("id", id);
        if (updErr) {
          console.error("[campanha-copa-send-to-leads] erro ao vincular submission:", updErr);
        }

        results.push({ submissionId: id, status: "already_sent", leadId: existingLeadId });
        continue;
      }

      const leadData: Record<string, unknown> = {
        origem_campanha: "copa",
        nome_lead: sub.nome,
        cpf: sub.cpf,
        telefone: sub.telefone,
        idade: sub.idade,
        cidade: sub.cidade,
        usa_oculos: sub.usa_oculos,
        sintomas: sub.sintomas ?? [],
        doencas: sub.doencas ?? [],
        palpite_home: sub.palpite_brasil,
        palpite_away: sub.palpite_marrocos,
        palpite_brasil: sub.palpite_brasil,
        palpite_marrocos: sub.palpite_marrocos,
        palpite: sub.palpite_texto,
        jogo: sub.jogo,
        jogo_label: sub.jogo_label,
        team_home_name: jogoCfg.team_home_name,
        team_away_name: jogoCfg.team_away_name,
        consentimento_marketing: !!sub.consentimento_marketing,
      };
      applyUltimoExameVistaToLeadData(leadData, sub.ultimo_exame_vista || "", lastVisitFieldId, jaFezExameVistaField);
      applyFormaCaptacaoToLeadData(leadData, formaCaptacaoFieldId);

      // Inscrições do jogo ATUAL entram na coluna "Participando da campanha
      // atual"; as de jogos anteriores caem direto na coluna geral
      // "Campanha Copa". Quando o admin troca o jogo, um trigger no banco
      // move quem estava em "participando" de volta pra "campanha_copa".
      const statusKey = sub.jogo === jogoCfg.jogo_key
        ? "participando_campanha_atual"
        : "campanha_copa";

      const { data: lead, error: leadErr } = await admin
        .from("crm_leads")
        .insert({
          data: leadData,
          status: statusKey,
          assigned_to: sub.assigned_to,
          created_by: user!.id,
        })
        .select("id")
        .single();

      if (leadErr || !lead) {
        console.error("[campanha-copa-send-to-leads] erro ao criar lead:", leadErr);
        results.push({ submissionId: id, status: "error", error: "Erro ao criar lead" });
        continue;
      }

      const { error: updErr } = await admin
        .from("campanha_copa_submissions")
        .update({ lead_id: lead.id })
        .eq("id", id);

      if (updErr) {
        console.error("[campanha-copa-send-to-leads] erro ao vincular submission:", updErr);
        results.push({ submissionId: id, status: "error", error: "Erro ao vincular inscrição" });
        continue;
      }

      const { error: noteErr } = await admin.from("crm_lead_notes").insert({
        lead_id: lead.id,
        user_id: user!.id,
        content: buildCopaNoteContent(sub),
      });
      if (noteErr) {
        console.error("[campanha-copa-send-to-leads] erro ao registrar comentário no lead novo:", noteErr);
      }

      results.push({ submissionId: id, status: "sent", leadId: lead.id as string });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[campanha-copa-send-to-leads]", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Erro ao enviar para Leads" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
