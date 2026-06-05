import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  formatRescheduleNote,
  getAppointmentRowColor,
  glassesPaymentLabel,
} from "@/lib/appointmentUtils";

export type AppointmentListRow = {
  id: string;
  lead_id: string | null;
  renovacao_id: string | null;
  scheduled_by: string;
  scheduled_datetime: string;
  valor: number;
  consulta_paga: boolean | null;
  forma_pagamento_oculos?: string | null;
  forma_pagamento?: string | null;
  canal_agendamento: string;
  confirmacao: string;
  comparecimento: string;
  venda: string;
  resumo: string;
  nome: string;
  telefone: string;
  idade: string;
  deleted_at?: string | null;
  is_reschedule_snapshot?: boolean | null;
  rescheduled_to_datetime?: string | null;
};

type Props = {
  appointments: AppointmentListRow[];
  isAdmin: boolean;
  loading?: boolean;
  getProfileName: (userId: string) => string;
  onUpdateField: (id: string, field: string, value: string) => void;
  onEdit: (appt: AppointmentListRow) => void;
  onDelete: (id: string) => void;
  onReturn: (id: string) => void;
  confirmacaoOptions: string[];
  comparecimentoOptions: string[];
  vendaOptions: string[];
};

export default function AppointmentsListTable({
  appointments,
  isAdmin,
  loading,
  getProfileName,
  onUpdateField,
  onEdit,
  onDelete,
  onReturn,
  confirmacaoOptions,
  comparecimentoOptions,
  vendaOptions,
}: Props) {
  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Carregando...</p>;
  }
  if (appointments.length === 0) {
    return <p className="text-center text-muted-foreground py-8">Nenhum agendamento encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/70 border-b">
            <th className="text-left px-3 py-2.5 font-medium">Nome</th>
            <th className="text-left px-3 py-2.5 font-medium">Telefone</th>
            <th className="text-left px-3 py-2.5 font-medium">Idade</th>
            <th className="text-left px-3 py-2.5 font-medium">Horário</th>
            <th className="text-left px-3 py-2.5 font-medium">Agendado por</th>
            <th className="text-left px-3 py-2.5 font-medium">Valor</th>
            <th className="text-left px-3 py-2.5 font-medium">Consulta paga</th>
            <th className="text-left px-3 py-2.5 font-medium">Forma de pagamento do Óculos</th>
            <th className="text-left px-3 py-2.5 font-medium">Canal de Agendamento</th>
            <th className="text-left px-3 py-2.5 font-medium">Confirmação</th>
            <th className="text-left px-3 py-2.5 font-medium">Comparecimento</th>
            <th className="text-left px-3 py-2.5 font-medium">Venda</th>
            <th className="text-left px-3 py-2.5 font-medium">Resumo</th>
            <th className="text-left px-3 py-2.5 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {appointments.map((appt) => {
            let dtFormatted = "—";
            try {
              dtFormatted = format(new Date(appt.scheduled_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR });
            } catch { /* ignore */ }
            const cpaga = appt.consulta_paga;
            const rowColor = getAppointmentRowColor(appt);
            const consultaPagaLocked = cpaga === true && !isAdmin;
            const rescheduleNote = formatRescheduleNote(appt);
            const isSnapshot = !!appt.is_reschedule_snapshot;

            return (
              <tr
                key={appt.id}
                className={cn(
                  "transition-colors",
                  rowColor,
                  appt.deleted_at && isAdmin ? "opacity-60" : "",
                  isSnapshot && "border-dashed",
                )}
              >
                <td className="px-3 py-2 font-medium">
                  {isSnapshot && <span className="text-violet-400 text-[10px] block">↪ Reagendado</span>}
                  {appt.nome || "—"}
                  {rescheduleNote && !isSnapshot && (
                    <span className="text-[10px] text-muted-foreground block">{rescheduleNote}</span>
                  )}
                  {isSnapshot && appt.rescheduled_to_datetime && (
                    <span className="text-[10px] text-muted-foreground block">
                      Nova data: {format(new Date(appt.rescheduled_to_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{appt.telefone || "—"}</td>
                <td className="px-3 py-2">{appt.idade || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{dtFormatted}</td>
                <td className="px-3 py-2">{getProfileName(appt.scheduled_by)}</td>
                <td className="px-3 py-2">R$ {Number(appt.valor).toFixed(2)}</td>
                <td className="px-3 py-2">
                  {isSnapshot ? (
                    <span className="text-xs">{cpaga === true ? "Sim" : cpaga === false ? "Não" : "—"}</span>
                  ) : (
                    <Select
                      value={cpaga === true ? "sim" : cpaga === false ? "nao" : ""}
                      onValueChange={(v) => onUpdateField(appt.id, "consulta_paga", v)}
                      disabled={consultaPagaLocked}
                    >
                      <SelectTrigger className="h-8 text-xs w-[100px]"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{glassesPaymentLabel(appt)}</td>
                <td className="px-3 py-2">{appt.canal_agendamento}</td>
                <td className="px-3 py-2">
                  {isSnapshot ? appt.confirmacao : (
                    <Select value={appt.confirmacao} onValueChange={(v) => onUpdateField(appt.id, "confirmacao", v)}>
                      <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {confirmacaoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isSnapshot ? appt.comparecimento : (
                    <Select value={appt.comparecimento} onValueChange={(v) => onUpdateField(appt.id, "comparecimento", v)}>
                      <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {comparecimentoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isSnapshot ? appt.venda : (
                    <Select value={appt.venda} onValueChange={(v) => onUpdateField(appt.id, "venda", v)}>
                      <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {vendaOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isSnapshot ? (
                    <span className="text-xs">{appt.resumo || "—"}</span>
                  ) : (
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-xs w-[150px] bg-background"
                      defaultValue={appt.resumo}
                      onBlur={(e) => {
                        if (e.target.value !== appt.resumo) onUpdateField(appt.id, "resumo", e.target.value);
                      }}
                      placeholder="Observações..."
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {!isSnapshot && appt.venda !== "Vendido" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={appt.renovacao_id ? "Retornar para Renovações" : "Retornar para Leads"}
                        onClick={() => onReturn(appt.id)}
                      >
                        <Undo2 className="h-3.5 w-3.5 text-primary" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(appt)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!isSnapshot && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(appt.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
