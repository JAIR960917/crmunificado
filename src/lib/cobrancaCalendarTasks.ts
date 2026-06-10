import { format, parseISO } from "date-fns";
import { extractPhoneFromCobrancaData } from "@/lib/phoneFormat";

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

export type CalendarTaskSource = "crediario" | "cobranca";

export function cobrancaActivityDisplayName(
  title: string,
  cobData: Record<string, unknown> | null | undefined,
): string {
  const nome = String(cobData?.nome ?? "").trim();
  const taskTitle = title.trim();
  if (nome && taskTitle && taskTitle !== nome) return `${nome} — ${taskTitle}`;
  return taskTitle || nome || "Tarefa";
}

export function mapCobrancaActivityToCalendarTask(
  activity: CobrancaActivityRow,
  cobranca?: CobrancaDataRow | null,
) {
  const data = cobranca?.data ?? null;
  const scheduled = parseISO(activity.scheduled_date);
  const cpfRaw = data?.documento ?? data?.cpf;
  const cpfDigits = cpfRaw ? String(cpfRaw).replace(/\D/g, "") : "";

  return {
    id: `cobranca-activity-${activity.id}`,
    source: "cobranca" as const,
    activityId: activity.id,
    activityTitle: activity.title,
    cobrancaId: activity.cobranca_id,
    lead_name: cobrancaActivityDisplayName(activity.title, data),
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

export function calendarRangeIso(queryStart: Date, queryEnd: Date) {
  const start = new Date(queryStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(queryEnd);
  end.setHours(23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
