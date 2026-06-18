/**
 * Tool do agente de IA (n8n): agenda um exame de vista direto no CRM
 * (tabela crm_appointments), a partir do nome/telefone/data/hora que o
 * cliente informou no WhatsApp.
 *
 * Autenticação: mesmo esquema do ai-agent-reply — header `x-ai-agent-secret`
 * deve bater com whatsapp_instances.ai_webhook_secret da instância da
 * conversa.
 *
 * Body esperado:
 *   { conversation_id, nome, telefone, data: "YYYY-MM-DD", hora: "HH:mm", cidade?: string }
 *
 * Sempre responde HTTP 200 com { ok: boolean, message: string, ... } —
 * mesmo quando a vaga não pode ser confirmada — para que o agente de IA
 * consiga reformular a resposta pro cliente em linguagem natural.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveRouteForCity, type CidadeLojaRoute } from "../_shared/campanhaCopaCidade.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ai-agent-secret",
};

const DAY_LABELS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDateParts(data: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function parseTimeParts(hora: string): { h: number; min: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const { conversation_id, nome, telefone, data, hora, cidade } = body as {
      conversation_id?: string;
      nome?: string;
      telefone?: string;
      data?: string;
      hora?: string;
      cidade?: string;
    };

    if (!conversation_id?.trim()) return jsonResponse({ ok: false, message: "conversation_id é obrigatório" }, 400);
    if (!nome?.trim()) return jsonResponse({ ok: false, message: "nome é obrigatório" }, 400);
    if (!telefone?.trim()) return jsonResponse({ ok: false, message: "telefone é obrigatório" }, 400);

    const dateParts = data ? parseDateParts(data) : null;
    if (!dateParts) {
      return jsonResponse({ ok: false, message: "Peça pro cliente confirmar a data no formato AAAA-MM-DD." }, 200);
    }
    const timeParts = hora ? parseTimeParts(hora) : null;
    if (!timeParts) {
      return jsonResponse({ ok: false, message: "Peça pro cliente confirmar o horário no formato HH:MM." }, 200);
    }

    const { data: conv, error: convErr } = await admin
      .from("whatsapp_conversations")
      .select("id, instance_id")
      .eq("id", conversation_id.trim())
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) return jsonResponse({ ok: false, message: "Conversa não encontrada" }, 404);

    const { data: instance, error: instErr } = await admin
      .from("whatsapp_instances")
      .select("id, ai_enabled, ai_webhook_secret, company_id")
      .eq("id", conv.instance_id)
      .maybeSingle();
    if (instErr) throw instErr;

    const secretHeader = req.headers.get("x-ai-agent-secret") || "";
    if (!instance?.ai_webhook_secret || secretHeader !== instance.ai_webhook_secret) {
      return jsonResponse({ ok: false, message: "Não autorizado" }, 401);
    }
    if (!instance.ai_enabled) {
      return jsonResponse({ ok: false, message: "IA desabilitada para este número" }, 409);
    }

    // Resolve empresa: prioriza a empresa vinculada ao número; senão, tenta pela cidade.
    let companyId: string | null = instance.company_id ?? null;
    if (!companyId && cidade?.trim()) {
      const { data: routesRaw } = await admin
        .from("campanha_copa_cidade_lojas")
        .select("id, cidade_label, company_id");
      const route = resolveRouteForCity(cidade, (routesRaw ?? []) as CidadeLojaRoute[]);
      companyId = route?.company_id ?? null;
    }
    if (!companyId) {
      return jsonResponse({
        ok: false,
        message: "Não consegui identificar a loja. Pergunte em qual cidade o cliente quer ser atendido.",
      }, 200);
    }

    // Dia da semana em UTC (evita deslocamento de fuso ao parsear "YYYY-MM-DD").
    const dateUtc = new Date(Date.UTC(dateParts.y, dateParts.m - 1, dateParts.d, 12));
    const dayOfWeek = dateUtc.getUTCDay();
    const horaStr = `${String(timeParts.h).padStart(2, "0")}:${String(timeParts.min).padStart(2, "0")}`;

    const { data: hoursRow } = await admin
      .from("company_business_hours")
      .select("is_open, start_time, end_time, slot_duration_minutes")
      .eq("company_id", companyId)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

    let slotDurationMinutes = 30;
    if (hoursRow) {
      slotDurationMinutes = hoursRow.slot_duration_minutes ?? 30;
      if (!hoursRow.is_open) {
        return jsonResponse({
          ok: false,
          message: `A loja não atende ${DAY_LABELS[dayOfWeek]}. Peça pro cliente escolher outro dia.`,
        }, 200);
      }
      const reqMinutes = timeParts.h * 60 + timeParts.min;
      const startMinutes = timeToMinutes(String(hoursRow.start_time).slice(0, 5));
      const endMinutes = timeToMinutes(String(hoursRow.end_time).slice(0, 5));
      if (reqMinutes < startMinutes || reqMinutes >= endMinutes) {
        return jsonResponse({
          ok: false,
          message:
            `Esse horário está fora do funcionamento (${String(hoursRow.start_time).slice(0, 5)} às ` +
            `${String(hoursRow.end_time).slice(0, 5)}). Peça pro cliente escolher outro horário dentro desse intervalo.`,
        }, 200);
      }
    }

    // Dia de exame realmente agendado para essa loja (tela "Dias de Exame").
    // Sem isso, nao existe atendimento de exame de vista nessa data, mesmo
    // que o horario de funcionamento generico esteja "aberto".
    const examDateStr = `${dateParts.y}-${pad2(dateParts.m)}-${pad2(dateParts.d)}`;
    const { data: examDay } = await admin
      .from("company_eye_exam_days")
      .select("id")
      .eq("company_id", companyId)
      .eq("exam_date", examDateStr)
      .maybeSingle();
    if (!examDay) {
      return jsonResponse({
        ok: false,
        message:
          "Não há atendimento de exame de vista agendado para essa data nessa loja. " +
          "Peça pro cliente escolher outra data, ou avise que um atendente vai confirmar a próxima data disponível.",
      }, 200);
    }

    const { data: dayAssignments } = await admin
      .from("company_eye_exam_day_specialists")
      .select("work_period, eye_exam_specialists!inner(name, active)")
      .eq("eye_exam_day_id", examDay.id);
    const activeAssignments = ((dayAssignments ?? []) as { work_period: string; eye_exam_specialists: { active: boolean } }[])
      .filter((a) => a.eye_exam_specialists?.active !== false);

    if (activeAssignments.length === 0) {
      return jsonResponse({
        ok: false,
        message:
          "Ainda não há especialista confirmado para essa data. " +
          "Peça pro cliente escolher outra data ou avise que um atendente vai confirmar.",
      }, 200);
    }

    const hasDiaTodo = activeAssignments.some((a) => a.work_period === "dia_todo");
    const hasManha = hasDiaTodo || activeAssignments.some((a) => a.work_period === "manha");
    const hasTarde = hasDiaTodo || activeAssignments.some((a) => a.work_period === "tarde");
    const requestedPeriod: "manha" | "tarde" = timeParts.h < 12 ? "manha" : "tarde";
    const periodCovered = requestedPeriod === "manha" ? hasManha : hasTarde;
    if (!periodCovered) {
      const periodosDisponiveis = [hasManha ? "manhã" : null, hasTarde ? "tarde" : null].filter(Boolean).join(" e ");
      return jsonResponse({
        ok: false,
        message:
          `Nessa data só tem especialista disponível na ${periodosDisponiveis || "—"}. ` +
          "Peça pro cliente escolher um horário dentro desse período, ou outra data.",
      }, 200);
    }

    // Resolve quem fica responsavel pelo agendamento: vendedor da loja > gerente > algum admin.
    const { data: companyProfiles } = await admin
      .from("profiles")
      .select("user_id")
      .eq("company_id", companyId);
    const companyUserIds = (companyProfiles ?? []).map((p: { user_id: string }) => p.user_id);
    let scheduledBy: string | null = null;
    if (companyUserIds.length > 0) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", companyUserIds);
      const vendedor = (roles ?? []).find((r: { role: string }) => r.role === "vendedor");
      const gerente = (roles ?? []).find((r: { role: string }) => r.role === "gerente");
      scheduledBy = vendedor?.user_id ?? gerente?.user_id ?? companyUserIds[0] ?? null;
    }
    if (!scheduledBy) {
      const { data: anyAdmin } = await admin.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
      scheduledBy = anyAdmin?.user_id ?? null;
    }
    if (!scheduledBy) {
      return jsonResponse({ ok: false, message: "Nenhum responsável disponível para agendar nessa loja." }, 200);
    }

    const scheduledDatetimeIso =
      `${dateParts.y}-${pad2(dateParts.m)}-${pad2(dateParts.d)}T${pad2(timeParts.h)}:${pad2(timeParts.min)}:00-03:00`;

    // Evita dois agendamentos no mesmo horário (mesma loja).
    if (companyUserIds.length > 0) {
      const windowStart = new Date(scheduledDatetimeIso);
      const windowEnd = new Date(windowStart.getTime() + slotDurationMinutes * 60_000);
      const windowStartBefore = new Date(windowStart.getTime() - slotDurationMinutes * 60_000);
      const { data: conflicts } = await admin
        .from("crm_appointments")
        .select("id, scheduled_datetime")
        .in("scheduled_by", companyUserIds)
        .is("deleted_at", null)
        .gte("scheduled_datetime", windowStartBefore.toISOString())
        .lt("scheduled_datetime", windowEnd.toISOString());
      if ((conflicts ?? []).length > 0) {
        return jsonResponse({
          ok: false,
          message: "Esse horário já está ocupado. Peça pro cliente escolher outro horário.",
        }, 200);
      }
    }

    const { data: inserted, error: insertErr } = await admin
      .from("crm_appointments")
      .insert({
        scheduled_by: scheduledBy,
        scheduled_datetime: scheduledDatetimeIso,
        valor: 0,
        canal_agendamento: "Agente IA (WhatsApp)",
        consulta_paga: false,
        consulta_paga_no_agendamento: false,
        nome: nome.trim(),
        telefone: telefone.trim(),
      })
      .select("id")
      .maybeSingle();
    if (insertErr) throw insertErr;

    const dataFormatada = `${pad2(dateParts.d)}/${pad2(dateParts.m)}/${dateParts.y}`;
    return jsonResponse({
      ok: true,
      appointment_id: inserted?.id ?? null,
      message: `Agendamento confirmado para ${dataFormatada} às ${horaStr}.`,
    });
  } catch (error) {
    console.error("ai-agent-schedule-appointment error:", error);
    return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
