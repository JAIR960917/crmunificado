import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAppointmentHistory } from "@/lib/appointmentUtils";
import TratativaContatoForm, {
  consultaPagaFromForma,
  type TratativaSavePayload,
} from "@/components/shared/TratativaContatoForm";

type Props = {
  renovacaoId: string;
  userId: string;
  renovacaoStatus: string;
  renovacaoSnapshot: { nome: string; telefone: string; idade: string };
  onSaved?: (updatedData?: Record<string, unknown>) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function buildNoteContent(payload: TratativaSavePayload) {
  const lines: string[] = [];
  lines.push(`📞 Tentativa de contato — Cliente ${payload.atendeu === "sim" ? "ATENDEU" : "NÃO ATENDEU"}`);
  if (payload.atendeu === "sim") {
    if (payload.tratativa) lines.push(`Tratativa: ${payload.tratativa}`);
    if (payload.marcou === "sim" && payload.scheduledDatetime) {
      const d = new Date(payload.scheduledDatetime);
      const dt = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      lines.push(`✅ Consulta marcada para ${dt}`);
      if (payload.formaPagamentoConsulta) {
        lines.push(`Pagamento da consulta: ${payload.formaPagamentoConsulta}`);
      }
    } else if (payload.marcou === "nao") {
      lines.push("❌ Consulta NÃO marcada");
    }
  } else if (payload.tentativasObs) {
    lines.push(`Tentativas de contato: ${payload.tentativasObs}`);
  }
  return lines.join("\n");
}

export default function RenovacaoContactAttemptForm({
  renovacaoId,
  userId,
  renovacaoStatus,
  renovacaoSnapshot,
  onSaved,
  onDirtyChange,
}: Props) {
  const handleSave = async (payload: TratativaSavePayload) => {
    const noteContent = buildNoteContent(payload);
    const { error: noteErr } = await supabase.from("crm_renovacao_notes" as any).insert({
      renovacao_id: renovacaoId,
      user_id: userId,
      content: noteContent,
    } as any);
    if (noteErr) throw noteErr;

    const { data: cur } = await supabase
      .from("crm_renovacoes")
      .select("data")
      .eq("id", renovacaoId)
      .maybeSingle();
    const curData = ((cur?.data as Record<string, unknown>) || {});
    const nowIso = new Date().toISOString();
    const newData = {
      ...curData,
      tratativa_em: nowIso,
      tratativa_status_key: renovacaoStatus,
      tratativa_atendeu: payload.atendeu,
      tratativa_by: userId,
    };
    await supabase.from("crm_renovacoes").update({ data: newData }).eq("id", renovacaoId);

    if (payload.atendeu === "sim" && payload.marcou === "sim" && payload.scheduledDatetime) {
      const pagaNoAgendamento = consultaPagaFromForma(payload.formaPagamentoConsulta);
      const { data: newAppt, error: apptErr } = await supabase.from("crm_appointments").insert({
        renovacao_id: renovacaoId,
        scheduled_by: userId,
        scheduled_datetime: payload.scheduledDatetime,
        valor: payload.valorConsulta,
        forma_pagamento: payload.formaPagamentoOculos,
        forma_pagamento_oculos: payload.formaPagamentoOculos,
        forma_pagamento_consulta: payload.formaPagamentoConsulta,
        canal_agendamento: "Ligação Renovação",
        consulta_paga: pagaNoAgendamento,
        consulta_paga_no_agendamento: pagaNoAgendamento,
        consulta_paga_em: pagaNoAgendamento ? nowIso : null,
        consulta_paga_por: pagaNoAgendamento ? userId : null,
        previous_status: renovacaoStatus,
        nome: renovacaoSnapshot.nome,
        telefone: renovacaoSnapshot.telefone,
        idade: renovacaoSnapshot.idade,
      } as any).select("id").single();
      if (apptErr) throw apptErr;
      if (newAppt?.id) {
        await logAppointmentHistory(newAppt.id, userId, "created", `Agendamento criado para ${renovacaoSnapshot.nome}`);
      }

      await supabase
        .from("crm_renovacoes")
        .update({ status: "agendado" })
        .eq("id", renovacaoId);

      toast.success("Contato registrado e consulta agendada!");
      onSaved?.(newData);
    } else {
      toast.success("Contato registrado!");
      onSaved?.(newData);
    }
  };

  return (
    <TratativaContatoForm
      onSave={handleSave}
      onDirtyChange={onDirtyChange}
    />
  );
}
