import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const CANAIS_AGENDAMENTO = [
  "Ligação Leads", "Ligação Renovação", "Loja", "Rede Social", "Ação Adam",
  "Convênios", "PAP", "Reavaliação", "Recomendação", "Teste de Visão Online",
  "Tráfego Pago", "Cortesia",
];

export const FORMAS_PAGAMENTO_OCULOS = ["Cartão", "Pix/Dinheiro", "Boleto"];

export const FORMAS_PAGAMENTO_CONSULTA = [
  "Cartão",
  "Pix/Dinheiro",
  "Boleto",
  "Cortesia",
  "Reavaliação de Consulta",
  "A definir",
];

/** Formas em que o campo valor da consulta não é exibido (ex.: reavaliação). */
export function formaConsultaSemValor(forma: string): boolean {
  return forma === "Cortesia" || forma === "Reavaliação de Consulta";
}

type FormFieldLike = {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
};

function normalizeCanalText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isCaptacaoFieldLabel(label: string): boolean {
  return /canal|capta[cç][aã]o/i.test(label);
}

/** Converte resposta do formulário (ex.: Indicação) para um canal de agendamento válido. */
export function mapToCanalAgendamento(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (CANAIS_AGENDAMENTO.includes(v)) return v;

  const lower = normalizeCanalText(v);
  if (/recomend|indicac/.test(lower)) return "Recomendação";
  if (/loja/.test(lower)) return "Loja";
  if (/rede social|instagram|facebook|tiktok/.test(lower)) return "Rede Social";
  if (/trafego|trafego pago|ads|anuncio/.test(lower)) return "Tráfego Pago";
  if (/\bpap\b/.test(lower)) return "PAP";
  if (/convenio/.test(lower)) return "Convênios";
  if (/reavali/.test(lower)) return "Reavaliação";
  if (/cortesia/.test(lower)) return "Cortesia";
  if (/teste.*visao|visao online/.test(lower)) return "Teste de Visão Online";
  if (/ligacao.*renov|renovacao/.test(lower)) return "Ligação Renovação";
  if (/ligacao|lead/.test(lower)) return "Ligação Leads";
  if (/acao adam|\badam\b/.test(lower)) return "Ação Adam";

  return "";
}

function valuesFromFormField(formData: Record<string, unknown>, fieldId: string): string[] {
  const raw = formData[`field_${fieldId}`];
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean);
  if (raw === undefined || raw === null || raw === "") return [];
  return [String(raw)];
}

export function resolveCanalFromForm(
  fields: FormFieldLike[],
  formData: Record<string, unknown>,
): string {
  const captaçãoFields = fields.filter(
    (f) => isCaptacaoFieldLabel(f.label) && (f.field_type === "select" || f.field_type === "checkbox_group"),
  );
  for (const f of captaçãoFields) {
    for (const v of valuesFromFormField(formData, f.id)) {
      const mapped = mapToCanalAgendamento(v);
      if (mapped) return mapped;
    }
  }

  for (const f of fields) {
    if (f.field_type !== "select" && f.field_type !== "checkbox_group") continue;
    for (const v of valuesFromFormField(formData, f.id)) {
      const mapped = mapToCanalAgendamento(v);
      if (mapped) return mapped;
    }
  }

  return "";
}

export function resolveCanalFromLeadData(data: Record<string, unknown>): string {
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        const mapped = mapToCanalAgendamento(item);
        if (mapped) return mapped;
      }
      continue;
    }
    const mapped = mapToCanalAgendamento(val);
    if (mapped) return mapped;
  }
  return "Ligação Leads";
}

export const isSameCalendarDay = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return false;
  try {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear()
      && da.getMonth() === db.getMonth()
      && da.getDate() === db.getDate()
    );
  } catch {
    return false;
  }
};

export const VENDA_ORCAMENTO_STATUSES = ["Gerou Orçamento", "Não Gerou Orçamento"] as const;

export type AppointmentColorInput = {
  consulta_paga: boolean | null;
  consulta_paga_em?: string | null;
  created_at: string;
  scheduled_datetime: string;
  forma_pagamento_consulta?: string | null;
  is_reschedule_snapshot?: boolean | null;
  deleted_at?: string | null;
  returned_at?: string | null;
  venda?: string | null;
  fez_orcamento?: boolean | null;
};

export function isFormaConsultaCortesia(forma: string | null | undefined): boolean {
  return forma?.trim() === "Cortesia";
}

export function isFormaConsultaReavaliacao(forma: string | null | undefined): boolean {
  return forma?.trim() === "Reavaliação de Consulta";
}

export function isMovedToOrcamentos(appt: {
  venda?: string | null;
  fez_orcamento?: boolean | null;
}) {
  if (appt.venda === "Gerou Orçamento" || appt.venda === "Não Gerou Orçamento") return true;
  if (appt.fez_orcamento === true) return true;
  return false;
}

export function isAppointmentInactive(appt: Pick<AppointmentColorInput, "deleted_at" | "returned_at">) {
  return !!(appt.returned_at || appt.deleted_at);
}

export function isAppointmentCalendarMuted(appt: Pick<AppointmentColorInput, "deleted_at" | "returned_at" | "venda" | "fez_orcamento">) {
  return isAppointmentInactive(appt) || isMovedToOrcamentos(appt);
}

/** Snapshots na data original do reagendamento — visíveis apenas para administradores. */
export function isRescheduleSnapshotVisibleToUser(
  appt: { is_reschedule_snapshot?: boolean | null },
  isAdmin: boolean,
) {
  if (!appt.is_reschedule_snapshot) return true;
  return isAdmin;
}

export function getAppointmentRowColor(appt: AppointmentColorInput): string {
  if (appt.is_reschedule_snapshot) {
    return "bg-violet-700/35 border-violet-500/50 hover:bg-violet-700/45";
  }
  if (isFormaConsultaReavaliacao(appt.forma_pagamento_consulta)) {
    return "bg-indigo-700/35 border-indigo-500/40 hover:bg-indigo-700/45";
  }
  if (isFormaConsultaCortesia(appt.forma_pagamento_consulta)) {
    return "bg-amber-700/35 border-amber-500/40 hover:bg-amber-700/45";
  }
  if (appt.consulta_paga !== true) {
    return "bg-red-700/30 hover:bg-red-700/40";
  }
  const paidAt = appt.consulta_paga_em || new Date().toISOString();
  if (isSameCalendarDay(paidAt, appt.created_at)) {
    return "bg-green-700/40 hover:bg-green-700/50";
  }
  if (isSameCalendarDay(paidAt, appt.scheduled_datetime)) {
    return "bg-cyan-600/30 hover:bg-cyan-600/40";
  }
  return "bg-green-700/40 hover:bg-green-700/50";
}

/** Cores sólidas no calendário — evita transparência misturando eventos lado a lado */
export function getAppointmentCalendarColor(appt: AppointmentColorInput): string {
  if (isAppointmentCalendarMuted(appt)) {
    return "bg-zinc-700 text-zinc-200 border-zinc-500 hover:bg-zinc-600";
  }
  if (appt.is_reschedule_snapshot) {
    return "bg-violet-900 text-violet-50 border-violet-700 hover:bg-violet-800";
  }
  if (isFormaConsultaReavaliacao(appt.forma_pagamento_consulta)) {
    return "bg-indigo-900 text-indigo-50 border-indigo-700 hover:bg-indigo-800";
  }
  if (isFormaConsultaCortesia(appt.forma_pagamento_consulta)) {
    return "bg-amber-900 text-amber-50 border-amber-700 hover:bg-amber-800";
  }
  if (appt.consulta_paga !== true) {
    return "bg-red-950 text-red-50 border-red-800 hover:bg-red-900";
  }
  const paidAt = appt.consulta_paga_em || new Date().toISOString();
  if (isSameCalendarDay(paidAt, appt.created_at)) {
    return "bg-emerald-900 text-emerald-50 border-emerald-700 hover:bg-emerald-800";
  }
  if (isSameCalendarDay(paidAt, appt.scheduled_datetime)) {
    return "bg-cyan-900 text-cyan-50 border-cyan-700 hover:bg-cyan-800";
  }
  return "bg-emerald-900 text-emerald-50 border-emerald-700 hover:bg-emerald-800";
}

export function glassesPaymentLabel(appt: {
  forma_pagamento_oculos?: string | null;
  forma_pagamento?: string | null;
}): string {
  return appt.forma_pagamento_oculos || appt.forma_pagamento || "—";
}

export function consultaPaymentLabel(appt: {
  forma_pagamento_consulta?: string | null;
}): string {
  return appt.forma_pagamento_consulta?.trim() || "—";
}

export function formatRescheduleNote(appt: {
  rescheduled_from_datetime?: string | null;
  original_scheduled_datetime?: string | null;
  is_reschedule_snapshot?: boolean | null;
  rescheduled_to_datetime?: string | null;
  scheduled_datetime: string;
}): string | null {
  if (appt.is_reschedule_snapshot && appt.rescheduled_to_datetime) {
    try {
      const nova = format(new Date(appt.rescheduled_to_datetime), "dd/MM/yyyy");
      return `Reagendado — nova data: ${nova}`;
    } catch {
      return "Reagendado";
    }
  }
  const from = appt.rescheduled_from_datetime || appt.original_scheduled_datetime;
  if (from) {
    try {
      const original = format(new Date(from), "dd/MM/yyyy");
      const atual = format(new Date(appt.scheduled_datetime), "dd/MM/yyyy");
      return `Agendado originalmente para ${original}, reagendado para ${atual}`;
    } catch {
      return null;
    }
  }
  return null;
}

export async function logAppointmentHistory(
  appointmentId: string,
  userId: string,
  action: string,
  summary: string,
  details: Record<string, unknown> = {},
) {
  await supabase.from("crm_appointment_history").insert({
    appointment_id: appointmentId,
    user_id: userId,
    action,
    summary,
    details,
  });
}

/** Lead IDs com agendamento ativo (ainda na tela de Agendamentos). */
export async function fetchActiveAppointedLeadIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("crm_appointments")
    .select("lead_id")
    .eq("status", "agendado")
    .is("deleted_at", null)
    .is("returned_at", null)
    .or("is_reschedule_snapshot.is.null,is_reschedule_snapshot.eq.false")
    .not("lead_id", "is", null);
  if (error) return new Set();
  return new Set(
    (data || [])
      .map((row) => row.lead_id)
      .filter((id): id is string => !!id),
  );
}

/** Encerra snapshots de reagendamento vinculados ao agendamento principal. */
export async function closeAppointmentRescheduleSnapshots(
  appointmentId: string,
  userId: string,
  whenIso: string,
) {
  await supabase
    .from("crm_appointments")
    .update({
      deleted_at: whenIso,
      deleted_by: userId,
      returned_at: whenIso,
      returned_by: userId,
    })
    .eq("snapshot_of_appointment_id", appointmentId)
    .eq("is_reschedule_snapshot", true);
}
