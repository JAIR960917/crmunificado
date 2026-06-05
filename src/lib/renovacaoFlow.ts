import { parseStoredDate } from "@/lib/kanbanCardSort";

export const RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS = 320;
export const RENOVACAO_OUTRA_OTICA_TASK_TITLE =
  "Retornar contato — renovou consulta em outra ótica";

export const DIRECIONAMENTO_STATUS = "fazer_direcionamento_para_o_vendedor";

export type RenovacaoFlowItem = {
  data?: unknown;
  data_ultima_compra?: string | null;
  renovou_outra_otica?: boolean | null;
  data_exame_outra_otica?: string | null;
  assigned_to?: string | null;
  status?: string;
};

export type LastVisitFieldLike = { id: string } | null | undefined;

/** Lê campos de outra ótica das colunas dedicadas ou do jsonb `data` (compatível sem migration). */
export function getOutraOticaFields(item: RenovacaoFlowItem): {
  renovou: boolean;
  dataExame: string | null;
} {
  const d = (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>;
  const renovou = item.renovou_outra_otica === true || d.renovou_outra_otica === true;
  const raw = item.data_exame_outra_otica ?? d.data_exame_outra_otica;
  const dataExame = raw != null && String(raw).trim() ? String(raw).trim() : null;
  return { renovou, dataExame: renovou ? dataExame : null };
}

export function mergeOutraOticaIntoData(
  data: Record<string, unknown> | null | undefined,
  renovou: boolean,
  dataExame: string | null,
): Record<string, unknown> {
  const base = data && typeof data === "object" ? { ...data } : {};
  return {
    ...base,
    renovou_outra_otica: renovou,
    data_exame_outra_otica: dataExame,
  };
}

export function statusKeyForRenovacao(diasDesdeUltimaCompra: number | null): string {
  if (diasDesdeUltimaCompra === null) return "novo";
  if (diasDesdeUltimaCompra < 365) return "em_contato";
  if (diasDesdeUltimaCompra < 730) return "agendado";
  if (diasDesdeUltimaCompra < 1095) return "renovado";
  return "mais_de_3_anos";
}

export function getRenovacaoFlowStatus(lastPurchaseDate: unknown): string {
  const parsedDate = parseStoredDate(lastPurchaseDate);
  if (!parsedDate) return "novo";
  const diasDesdeUltimaCompra = Math.floor((Date.now() - parsedDate.getTime()) / 86400000);
  return statusKeyForRenovacao(diasDesdeUltimaCompra);
}

/** Data efetiva para coluna do kanban: exame em outra ótica tem prioridade. */
export function getEffectiveRenovacaoExamDate(
  item: RenovacaoFlowItem,
  lastVisitField?: LastVisitFieldLike,
): string | null {
  const { renovou, dataExame } = getOutraOticaFields(item);
  if (renovou && dataExame) return dataExame;
  if (item.data_ultima_compra) return item.data_ultima_compra;
  const d = (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>;
  if (lastVisitField) {
    const v = d[`field_${lastVisitField.id}`];
    if (v != null && String(v).trim()) return String(v);
  }
  return null;
}

export function getRenovacaoFlowStatusFromItem(
  item: RenovacaoFlowItem,
  lastVisitField?: LastVisitFieldLike,
): string {
  return getRenovacaoFlowStatus(getEffectiveRenovacaoExamDate(item, lastVisitField));
}

export function getRenovacaoExamTimestampFromItem(
  item: RenovacaoFlowItem,
  lastVisitField?: LastVisitFieldLike,
): number {
  const effective = getEffectiveRenovacaoExamDate(item, lastVisitField);
  if (effective) {
    const t = parseStoredDate(effective)?.getTime();
    if (t != null && !isNaN(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

export function buildOutraOticaFollowupDate(examDate: Date): Date {
  const scheduled = new Date(examDate);
  scheduled.setDate(scheduled.getDate() + RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS);
  scheduled.setHours(9, 0, 0, 0);
  return scheduled;
}

/** Recalcula status após marcar/desmarcar exame em outra ótica. */
export function resolveStatusAfterOutraOtica(
  item: RenovacaoFlowItem,
  lastVisitField?: LastVisitFieldLike,
): string {
  if (!item.assigned_to) return DIRECIONAMENTO_STATUS;
  if (item.status === "excluidos") return "excluidos";
  return getRenovacaoFlowStatusFromItem(item, lastVisitField);
}

export function formatDateForDb(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
