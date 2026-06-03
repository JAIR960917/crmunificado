/** Ordenação de cards nos kanbans: exame/parcela mais antigo no topo; tratativa na coluna atual vai ao fim. */

export function parseStoredDate(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    if (!isNaN(d.getTime())) return d;
  }
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;
  return undefined;
}

export type FormFieldLike = {
  id: string;
  label?: string | null;
  is_last_visit_field?: boolean;
};

export function getLeadExamTimestamp(
  data: Record<string, unknown> | null | undefined,
  formFields: FormFieldLike[],
): number {
  if (!data) return Number.POSITIVE_INFINITY;
  const lastVisit = formFields.find((f) => f.is_last_visit_field);
  if (lastVisit) {
    const t = parseStoredDate(data[`field_${lastVisit.id}`])?.getTime();
    if (t != null && !isNaN(t)) return t;
  }
  for (const f of formFields) {
    const label = (f.label || "").toLowerCase();
    if (/último exame|ultimo exame|exame de vista/.test(label)) {
      const t = parseStoredDate(data[`field_${f.id}`])?.getTime();
      if (t != null && !isNaN(t)) return t;
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function getRenovacaoExamTimestamp(
  item: { data?: unknown; data_ultima_compra?: string | null },
  lastVisitField?: FormFieldLike | null,
): number {
  const d = (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>;
  if (item.data_ultima_compra) {
    const t = parseStoredDate(item.data_ultima_compra)?.getTime();
    if (t != null && !isNaN(t)) return t;
  }
  if (lastVisitField) {
    const t = parseStoredDate(d[`field_${lastVisitField.id}`])?.getTime();
    if (t != null && !isNaN(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

/** Menor timestamp de vencimento entre parcelas atrasadas (ou fallback no card). */
export function getOldestOverdueParcelTimestamp(
  data: Record<string, unknown> | null | undefined,
): number {
  if (!data) return Number.POSITIVE_INFINITY;
  const parcelas = Array.isArray(data.parcelas_atrasadas) ? data.parcelas_atrasadas : [];
  let min = Number.POSITIVE_INFINITY;
  for (const p of parcelas) {
    if (!p || typeof p !== "object") continue;
    const v = (p as Record<string, unknown>).vencimento ?? (p as Record<string, unknown>).data_vencimento;
    if (!v) continue;
    const t = new Date(String(v)).getTime();
    if (!isNaN(t) && t < min) min = t;
  }
  if (min !== Number.POSITIVE_INFINITY) return min;
  const fallback = data.vencimento ?? data.data_boleto_mais_antigo;
  if (fallback) {
    const t = new Date(String(fallback)).getTime();
    if (!isNaN(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

function tratativaTimestamp(
  data: Record<string, unknown> | null | undefined,
  currentStatus: string,
  requireStatusMatch: boolean,
): number {
  if (!data?.tratativa_em) return 0;
  if (requireStatusMatch) {
    const key = data.tratativa_status_key;
    if (key && key !== currentStatus) return 0;
  }
  const t = new Date(String(data.tratativa_em)).getTime();
  return !isNaN(t) ? t : 0;
}

export function sortKanbanByExamAndTratativa<T extends { id: string; status: string; data?: unknown }>(
  items: T[],
  options: {
    getExamTs: (item: T) => number;
    taskPriority?: Map<string, number>;
    /** Cobrança/Renovação: só manda ao fim se a tratativa foi nesta coluna. */
    requireTratativaStatusMatch?: boolean;
  },
): T[] {
  const { getExamTs, taskPriority, requireTratativaStatusMatch = false } = options;
  return [...items].sort((a, b) => {
    const ad = (a.data as Record<string, unknown>) || {};
    const bd = (b.data as Record<string, unknown>) || {};
    const ta = tratativaTimestamp(ad, a.status, requireTratativaStatusMatch);
    const tb = tratativaTimestamp(bd, b.status, requireTratativaStatusMatch);
    const aHas = ta > 0 ? 1 : 0;
    const bHas = tb > 0 ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    if (aHas && bHas && ta !== tb) return ta - tb;

    if (taskPriority) {
      const ap = taskPriority.get(a.id) || 0;
      const bp = taskPriority.get(b.id) || 0;
      if (ap !== bp) return bp - ap;
    }

    const ea = getExamTs(a);
    const eb = getExamTs(b);
    if (ea !== eb) return ea - eb;
    return 0;
  });
}
