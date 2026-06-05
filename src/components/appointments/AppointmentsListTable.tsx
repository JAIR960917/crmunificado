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
    <div className="overflow-x-auto rounded-lg border w-fit max-w-full">
      <table className="text-xs w-auto table-fixed">
        <thead>
          <tr className="bg-muted/70 border-b">
            <th className="text-left px-2 py-1.5 font-medium w-[120px]">Nome</th>
            <th className="text-left px-2 py-1.5 font-medium w-[100px]">Telefone</th>
            <th className="text-left px-2 py-1.5 font-medium w-[40px]">Idade</th>
            <th className="text-left px-2 py-1.5 font-medium w-[110px]">Horário</th>
            <th className="text-left px-2 py-1.5 font-medium w-[90px]">Agendado por</th>
            <th className="text-left px-2 py-1.5 font-medium w-[70px]">Valor</th>
            <th className="text-left px-2 py-1.5 font-medium w-[90px]">Consulta paga</th>
            <th className="text-left px-2 py-1.5 font-medium w-[100px]">Pag. Óculos</th>
            <th className="text-left px-2 py-1.5 font-medium w-[50px]">Canal</th>
            <th className="text-left px-2 py-1.5 font-medium w-[100px]">Confirmação</th>
            <th className="text-left px-2 py-1.5 font-medium w-[110px]">Comparecimento</th>
            <th className="text-left px-2 py-1.5 font-medium w-[100px]">Venda</th>
            <th className="text-left px-2 py-1.5 font-medium w-[100px]">Resumo</th>
            <th className="text-left px-2 py-1.5 font-medium w-[80px]">Ações</th>
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
            const nameTitle = [
              appt.nome,
              isSnapshot ? "Reagendado" : null,
              rescheduleNote,
              isSnapshot && appt.rescheduled_to_datetime
                ? `Nova data: ${format(new Date(appt.rescheduled_to_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR })}`
                : null,
            ]
              .filter(Boolean)
              .join(" — ");

            return (
              <tr
                key={appt.id}
                className={cn(
                  "h-9 transition-colors",
                  rowColor,
                  appt.deleted_at && isAdmin ? "opacity-60" : "",
                  isSnapshot && "border-dashed",
                )}
              >
                <td className="px-2 py-0 align-middle overflow-hidden" title={nameTitle}>
                  <div className="flex items-center gap-1 min-w-0">
                    {isSnapshot && <span className="text-violet-400 shrink-0">↪</span>}
                    <span className="truncate">{appt.nome || "—"}</span>
                  </div>
                </td>
                <td className="px-2 py-0 align-middle truncate max-w-0" title={appt.telefone || undefined}>{appt.telefone || "—"}</td>
                <td className="px-2 py-0 align-middle">{appt.idade || "—"}</td>
                <td className="px-2 py-0 align-middle whitespace-nowrap">{dtFormatted}</td>
                <td className="px-2 py-0 align-middle truncate max-w-0" title={getProfileName(appt.scheduled_by)}>{getProfileName(appt.scheduled_by)}</td>
                <td className="px-2 py-0 align-middle whitespace-nowrap">R$ {Number(appt.valor).toFixed(2)}</td>
                <td className="px-2 py-0 align-middle">
                  {isSnapshot ? (
                    <span>{cpaga === true ? "Sim" : cpaga === false ? "Não" : "—"}</span>
                  ) : (
                    <Select
                      value={cpaga === true ? "sim" : cpaga === false ? "nao" : ""}
                      onValueChange={(v) => onUpdateField(appt.id, "consulta_paga", v)}
                      disabled={consultaPagaLocked}
                    >
                      <SelectTrigger className="h-7 text-[11px] w-[72px] px-2"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-2 py-0 align-middle truncate max-w-0" title={glassesPaymentLabel(appt)}>{glassesPaymentLabel(appt)}</td>
                <td className="px-2 py-0 align-middle">{appt.canal_agendamento}</td>
                <td className="px-2 py-0 align-middle">
                  {isSnapshot ? appt.confirmacao : (
                    <Select value={appt.confirmacao} onValueChange={(v) => onUpdateField(appt.id, "confirmacao", v)}>
                      <SelectTrigger className="h-7 text-[11px] w-[88px] px-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {confirmacaoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-2 py-0 align-middle">
                  {isSnapshot ? appt.comparecimento : (
                    <Select value={appt.comparecimento} onValueChange={(v) => onUpdateField(appt.id, "comparecimento", v)}>
                      <SelectTrigger className="h-7 text-[11px] w-[100px] px-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {comparecimentoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-2 py-0 align-middle">
                  {isSnapshot ? appt.venda : (
                    <Select value={appt.venda} onValueChange={(v) => onUpdateField(appt.id, "venda", v)}>
                      <SelectTrigger className="h-7 text-[11px] w-[88px] px-2"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {vendaOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-2 py-0 align-middle">
                  {isSnapshot ? (
                    <span className="truncate block max-w-[100px]" title={appt.resumo || undefined}>{appt.resumo || "—"}</span>
                  ) : (
                    <input
                      type="text"
                      className="border rounded px-1.5 h-7 text-[11px] w-[100px] bg-background"
                      defaultValue={appt.resumo}
                      onBlur={(e) => {
                        if (e.target.value !== appt.resumo) onUpdateField(appt.id, "resumo", e.target.value);
                      }}
                      placeholder="Obs..."
                    />
                  )}
                </td>
                <td className="px-2 py-0 align-middle">
                  <div className="flex gap-0.5">
                    {!isSnapshot && appt.venda !== "Vendido" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={appt.renovacao_id ? "Retornar para Renovações" : "Retornar para Leads"}
                        onClick={() => onReturn(appt.id)}
                      >
                        <Undo2 className="h-3 w-3 text-primary" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(appt)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {!isSnapshot && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(appt.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
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
