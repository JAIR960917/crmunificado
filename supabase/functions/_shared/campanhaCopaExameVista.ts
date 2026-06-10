/**
 * Converte a faixa informada no formulário público da Copa em data fixa (ISO)
 * para o campo de último exame do CRM — necessário para o funil de leads por coluna.
 */
const EXAME_VISTA_OPTION_DATES: Record<string, string> = {
  "Menos de 6 meses": "2026-02-01",
  "6 meses a 1 ano": "2025-10-01",
  "1 a 2 anos": "2024-03-01",
  "Mais de 2 anos": "2022-01-01",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

export function mapUltimoExameVistaToIsoDate(option: string): string | null {
  const key = (option || "").trim();
  if (!key || key === "Nunca fiz") return null;
  return EXAME_VISTA_OPTION_DATES[key] ?? null;
}

export async function loadLeadLastVisitFieldId(supabase: SupabaseAdmin): Promise<string | null> {
  const { data: marked } = await supabase
    .from("crm_form_fields")
    .select("id")
    .eq("is_last_visit_field", true)
    .limit(1)
    .maybeSingle();

  if (marked?.id) return marked.id as string;

  const { data: fields } = await supabase
    .from("crm_form_fields")
    .select("id, label")
    .eq("field_type", "date");

  for (const field of (fields || []) as { id: string; label: string | null }[]) {
    const label = (field.label || "").toLowerCase();
    if (/exame de vista|último exame|ultimo exame|última consulta|ultima consulta/.test(label)) {
      return field.id;
    }
  }

  return null;
}

export function applyUltimoExameVistaToLeadData(
  leadData: Record<string, unknown>,
  option: string,
  lastVisitFieldId: string | null,
): void {
  const isoDate = mapUltimoExameVistaToIsoDate(option);
  leadData.ultimo_exame_vista = option;
  if (isoDate) {
    leadData.ultimo_exame_vista_data = isoDate;
    if (lastVisitFieldId) {
      leadData[`field_${lastVisitFieldId}`] = isoDate;
    }
  }
}
