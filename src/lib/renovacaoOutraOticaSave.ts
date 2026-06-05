import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS,
  RENOVACAO_OUTRA_OTICA_TASK_TITLE,
  buildOutraOticaFollowupDate,
} from "@/lib/renovacaoFlow";

export async function syncRenovacaoOutraOticaFollowup(params: {
  renovacaoId: string;
  renovou: boolean;
  examDate: Date | null;
  dateStr: string | null;
  previousRenovou: boolean;
  previousDateStr: string | null;
  userId?: string;
  clientName?: string;
}): Promise<void> {
  const {
    renovacaoId,
    renovou,
    examDate,
    dateStr,
    previousRenovou,
    previousDateStr,
    userId,
    clientName,
  } = params;

  const dateChanged = dateStr !== previousDateStr;
  const toggledOn = renovou && !previousRenovou;

  if (!renovou || !dateStr || !examDate || !userId || (!dateChanged && !toggledOn)) {
    return;
  }

  const followup = buildOutraOticaFollowupDate(examDate);
  const followupIso = followup.toISOString();

  const { data: existing } = await supabase
    .from("renovacao_activities")
    .select("id")
    .eq("renovacao_id", renovacaoId)
    .is("completed_at", null)
    .ilike("title", "%outra ótica%")
    .maybeSingle();

  const taskBody = {
    scheduled_date: followupIso,
    title: RENOVACAO_OUTRA_OTICA_TASK_TITLE,
    description: `Exame em outra ótica em ${format(examDate, "dd/MM/yyyy", { locale: ptBR })}. Retornar ${RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS} dias antes da próxima renovação estimada.`,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("renovacao_activities")
      .update(taskBody as Record<string, unknown>)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("renovacao_activities").insert({
      renovacao_id: renovacaoId,
      ...taskBody,
      created_by: userId,
    } as Record<string, unknown>);
    if (error) throw error;
  }

  const nome = clientName || "Cliente";
  await supabase.from("crm_renovacao_notes").insert({
    renovacao_id: renovacaoId,
    user_id: userId,
    content: `🏪 ${nome} renovou consulta em outra ótica (${format(examDate, "dd/MM/yyyy", { locale: ptBR })}). Tarefa de retorno em ${format(followup, "dd/MM/yyyy", { locale: ptBR })}.`,
  } as Record<string, unknown>);
}
