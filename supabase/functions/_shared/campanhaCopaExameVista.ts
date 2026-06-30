/**
 * Converte a faixa informada no formulário público da Copa numa data
 * aproximada (ISO) para o campo de último exame do CRM — necessário para o
 * funil de leads por coluna. A data é aleatória dentro da janela da faixa,
 * sempre relativa a hoje (não fixa), para que a coluna continue coerente com
 * o período informado conforme o tempo passa.
 */
const EXAME_VISTA_OPTION_RANGES_DAYS: Record<string, [number, number]> = {
  "Menos de 6 meses": [1, 180],
  "6 meses a 1 ano": [181, 365],
  "1 a 2 anos": [366, 730],
  "Mais de 2 anos": [731, 1825],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

export function mapUltimoExameVistaToIsoDate(option: string, now: Date = new Date()): string | null {
  const key = (option || "").trim();
  if (!key || key === "Nunca fiz") return null;
  const range = EXAME_VISTA_OPTION_RANGES_DAYS[key];
  if (!range) return null;
  const [minDays, maxDays] = range;
  const daysAgo = minDays + Math.floor(Math.random() * (maxDays - minDays + 1));
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export async function loadLeadLastVisitFieldId(supabase: SupabaseAdmin): Promise<string | null> {
  // crm_form_fields (formulário de Leads) não tem coluna is_last_visit_field
  // (essa flag só existe em crm_renovacao_form_fields) — identifica o campo
  // pelo tipo + rótulo.
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

/**
 * Campo "Já fez exame de vista?" (Sim/Não) — controla a exibição do campo de
 * data acima. Sem marcar "Sim" aqui, a data do último exame fica preenchida
 * nos bastidores mas escondida na tela, porque o campo de data só aparece
 * condicionado a essa resposta.
 */
export async function loadJaFezExameVistaFieldId(supabase: SupabaseAdmin): Promise<{ id: string; simValue: string } | null> {
  const { data: fields } = await supabase
    .from("crm_form_fields")
    .select("id, label, options");

  for (const field of (fields || []) as { id: string; label: string | null; options: unknown }[]) {
    const label = (field.label || "").toLowerCase();
    if (/j[áa]\s+fez\s+exame\s+de\s+vista/.test(label)) {
      const options = Array.isArray(field.options) ? (field.options as unknown[]).map(String) : [];
      const simValue = options.find((o) => o.trim().toLowerCase() === "sim") ?? "Sim";
      return { id: field.id, simValue };
    }
  }

  return null;
}

export function applyUltimoExameVistaToLeadData(
  leadData: Record<string, unknown>,
  option: string,
  lastVisitFieldId: string | null,
  jaFezExameVistaField: { id: string; simValue: string } | null = null,
): void {
  const isoDate = mapUltimoExameVistaToIsoDate(option);
  leadData.ultimo_exame_vista = option;
  if (isoDate) {
    leadData.ultimo_exame_vista_data = isoDate;
    if (lastVisitFieldId) {
      leadData[`field_${lastVisitFieldId}`] = isoDate;
    }
    if (jaFezExameVistaField) {
      leadData[`field_${jaFezExameVistaField.id}`] = jaFezExameVistaField.simValue;
    }
  }
}
