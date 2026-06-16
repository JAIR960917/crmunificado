import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveCanalFromLeadData, logAppointmentHistory } from "@/lib/appointmentUtils";
import TratativaContatoForm, {
  consultaPagaFromForma,
  type TratativaSavePayload,
} from "@/components/shared/TratativaContatoForm";

type Props = {
  leadId: string;
  userId: string;
  leadStatus: string;
  leadSnapshot: { nome: string; telefone: string; idade: string };
  onSaved?: () => void;
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

export default function ContactAttemptForm({
  leadId,
  userId,
  leadStatus,
  leadSnapshot,
  onSaved,
  onDirtyChange,
}: Props) {
  const [canalAgendamento, setCanalAgendamento] = useState("Ligação Leads");

  useEffect(() => {
    if (!leadId) return;
    supabase.from("crm_leads").select("data").eq("id", leadId).maybeSingle().then(({ data }) => {
      if (data?.data) {
        setCanalAgendamento(resolveCanalFromLeadData(data.data as Record<string, unknown>));
      }
    });
  }, [leadId]);

  const handleSave = async (payload: TratativaSavePayload) => {
    const noteContent = buildNoteContent(payload);
    const { error: noteErr } = await supabase.from("crm_lead_notes").insert({
      lead_id: leadId,
      user_id: userId,
      content: noteContent,
    });
    if (noteErr) throw noteErr;

    const { data: cur } = await supabase
      .from("crm_leads")
      .select("data")
      .eq("id", leadId)
      .maybeSingle();
    const curData = ((cur?.data as Record<string, unknown>) || {});
    await supabase.from("crm_leads").update({
      data: {
        ...curData,
        tratativa_em: new Date().toISOString(),
        tratativa_status_key: leadStatus,
        tratativa_atendeu: payload.atendeu,
        tratativa_by: userId,
      },
    }).eq("id", leadId);

    if (payload.atendeu === "sim" && payload.marcou === "sim" && payload.scheduledDatetime) {
      const nowIso = new Date().toISOString();
      const pagaNoAgendamento = consultaPagaFromForma(payload.formaPagamentoConsulta);
      const { data: newAppt, error: apptErr } = await supabase.from("crm_appointments").insert({
        lead_id: leadId,
        scheduled_by: userId,
        scheduled_datetime: payload.scheduledDatetime,
        valor: payload.valorConsulta,
        forma_pagamento: payload.formaPagamentoOculos,
        forma_pagamento_oculos: payload.formaPagamentoOculos,
        forma_pagamento_consulta: payload.formaPagamentoConsulta,
        canal_agendamento: canalAgendamento,
        consulta_paga: pagaNoAgendamento,
        consulta_paga_no_agendamento: pagaNoAgendamento,
        consulta_paga_em: pagaNoAgendamento ? nowIso : null,
        consulta_paga_por: pagaNoAgendamento ? userId : null,
        previous_status: leadStatus,
        nome: leadSnapshot.nome,
        telefone: leadSnapshot.telefone,
        idade: leadSnapshot.idade,
      } as any).select("id").single();
      if (apptErr) throw apptErr;
      if (newAppt?.id) {
        await logAppointmentHistory(newAppt.id, userId, "created", `Agendamento criado para ${leadSnapshot.nome}`);
      }
      toast.success("Contato registrado e consulta agendada!");
    } else {
      toast.success("Contato registrado!");
    }

    onSaved?.();
  };

  return (
    <TratativaContatoForm
      onSave={handleSave}
      onDirtyChange={onDirtyChange}
    />
  );
}
