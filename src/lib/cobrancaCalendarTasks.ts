import { format, parseISO } from "date-fns";
import { isManualCobrancaActivity } from "@/lib/cobrancaActivities";
import { resolveLeadIdentity } from "@/lib/leadIdentity";
import { extractPhoneFromCobrancaData } from "@/lib/phoneFormat";

export { isManualCobrancaActivity };

export type CobrancaActivityRow = {
  id: string;
  cobranca_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  completed_at: string | null;
};

export type CobrancaDataRow = {
  id: string;
  data: Record<string, unknown> | null;
};

export type LeadActivityRow = {
  id: string;
  lead_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  completed_at: string | null;
};

export type CalendarTaskSource = "crediario" | "cobranca" | "lead";

export function cobrancaClientName(cobData: Record<string, unknown> | null | undefined): string {
  return String(cobData?.nome ?? "").trim() || "—";
}

export function mapCobrancaActivityToCalendarTask(
  activity: CobrancaActivityRow,
  cobranca?: CobrancaDataRow | null,
) {
  const data = cobranca?.data ?? null;
  const scheduled = parseISO(activity.scheduled_date);
  const cpfRaw = data?.documento ?? data?.cpf;
  const cpfDigits = cpfRaw ? String(cpfRaw).replace(/\D/g, "") : "";
  const clientName = cobrancaClientName(data);

  return {
    id: `cobranca-activity-${activity.id}`,
    source: "cobranca" as const,
    activityId: activity.id,
    activityTitle: activity.title,
    clientName,
    cobrancaId: activity.cobranca_id,
    lead_name: clientName,
    scheduled_date: format(scheduled, "yyyy-MM-dd"),
    scheduled_time: format(scheduled, "HH:mm:ss"),
    phone: extractPhoneFromCobrancaData(data) || null,
    cpf: cpfDigits || null,
    observacao: activity.description,
    renegociacao_status: null as null,
    renegociacao_comentario: null as null,
    completed_at: activity.completed_at,
    parent_task_id: null as null,
  };
}

export function mapLeadActivityToCalendarTask(
  activity: LeadActivityRow,
  leadData: Record<string, unknown> | null | undefined,
) {
  const { nome, telefone } = resolveLeadIdentity((leadData || {}) as Record<string, unknown>);
  const clientName = nome || "Lead";
  const scheduled = parseISO(activity.scheduled_date);
  const displayName = activity.title ? `${clientName} — ${activity.title}` : clientName;

  return {
    id: `lead-activity-${activity.id}`,
    source: "lead" as const,
    activityId: activity.id,
    leadId: activity.lead_id,
    activityTitle: activity.title,
    clientName,
    lead_name: displayName,
    scheduled_date: format(scheduled, "yyyy-MM-dd"),
    scheduled_time: format(scheduled, "HH:mm:ss"),
    phone: telefone || null,
    cpf: null as null,
    observacao: activity.description,
    renegociacao_status: null as null,
    renegociacao_comentario: null as null,
    completed_at: activity.completed_at,
    parent_task_id: null as null,
  };
}

export function calendarRangeIso(queryStart: Date, queryEnd: Date) {
  const start = new Date(queryStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(queryEnd);
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
