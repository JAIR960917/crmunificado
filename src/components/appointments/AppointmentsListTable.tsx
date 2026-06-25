import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  consultaPaymentLabel,
  FORMAS_PAGAMENTO_CONSULTA,
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
  forma_pagamento_consulta?: string | null;
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
  canEditValor?: boolean;
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

function formatApptDateTime(datetime: string) {
  try {
    return format(new Date(datetime), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

const TH = "text-left px-2 py-2 font-medium whitespace-nowrap";

export default function AppointmentsListTable({
  appointments,
  isAdmin,
  canEditValor,
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

  const renderActions = (appt: AppointmentListRow, isSnapshot: boolean) => (
    <div className="flex gap-0.5 shrink-0">
      {!isSnapshot && appt.venda !== "Vendido" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title={appt.renovacao_id ? "Retornar para Renovações" : "Retornar para Leads"}
          onClick={() => onReturn(appt.id)}
        >
          <Undo2 className="h-3.5 w-3.5 text-primary" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onEdit(appt)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      {!isSnapshot && (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onDelete(appt.id)}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-w-0 w-full">
      <p className="sm:hidden text-[11px] text-muted-foreground mb-1.5">
        Deslize para o lado para ver todas as colunas →
      </p>
      <div
        className="overflow-x-auto overscroll-x-contain rounded-lg border w-full max-w-full [webkit-overflow-scrolling:touch]"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <table className="text-xs w-max border-collapse">
          <thead>
            <tr className="bg-muted/70 border-b">
              <th className={cn(TH, "min-w-[120px] sticky left-0 z-20 bg-muted/70 border-r")}>Nome</th>
              <th className={cn(TH, "min-w-[105px]")}>Telefone</th>
              <th className={cn(TH, "min-w-[44px]")}>Idade</th>
              <th className={cn(TH, "min-w-[128px]")}>Horário</th>
              <th className={cn(TH, "min-w-[130px]")}>Agendado por</th>
              <th className={cn(TH, "min-w-[72px]")}>Valor</th>
              <th className={cn(TH, "min-w-[96px]")}>Pag. Consulta</th>
              <th className={cn(TH, "min-w-[108px]")}>Consulta paga</th>
              <th className={cn(TH, "min-w-[96px]")}>Pag. Óculos</th>
              <th className={cn(TH, "min-w-[88px]")}>Canal</th>
              <th className={cn(TH, "min-w-[112px]")}>Confirmação</th>
              <th className={cn(TH, "min-w-[120px]")}>Comparecimento</th>
              <th className={cn(TH, "min-w-[96px]")}>Venda</th>
              <th className={cn(TH, "min-w-[100px]")}>Resumo</th>
              <th className={cn(TH, "min-w-[96px]")}>Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {appointments.map((appt) => {
              const dtFormatted = formatApptDateTime(appt.scheduled_datetime);
              const cpaga = appt.consulta_paga;
              const rowColor = getAppointmentRowColor(appt);
              const consultaPagaLocked = cpaga === true && !isAdmin;
              const rescheduleNote = formatRescheduleNote(appt);
              const isSnapshot = !!appt.is_reschedule_snapshot;
              const scheduledByName = (appt.canal_agendamento || "").toLowerCase().includes("agente ia")
                ? "Agente de IA"
                : getProfileName(appt.scheduled_by);
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
                    "transition-colors",
                    rowColor,
                    appt.deleted_at && isAdmin ? "opacity-60" : "",
                    isSnapshot && "border-dashed",
                  )}
                >
                  <td
                    className="p-0 align-middle relative sticky left-0 z-10 border-r bg-background"
                    title={nameTitle}
                  >
                    {/* Camada sólida (bg-background) + camada com a MESMA cor translúcida da
                        linha, as duas confinadas dentro da própria célula — fica idêntica ao
                        resto da linha (mesmo tom), mas sem deixar o conteúdo que passa por
                        baixo "vazar" através dela ao rolar a tabela (célula fixa). */}
                    <div className={cn("absolute inset-0", rowColor)} />
                    <div className="relative px-2 py-1.5 whitespace-nowrap flex items-center gap-1">
                      {isSnapshot && <span className="text-violet-400 shrink-0">↪</span>}
                      <span>{appt.nome || "—"}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap" title={appt.telefone || undefined}>
                    {appt.telefone || "—"}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">{appt.idade || "—"}</td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">{dtFormatted}</td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap" title={scheduledByName}>
                    {scheduledByName}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {canEditValor && !isSnapshot ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="border rounded px-1.5 h-7 text-[11px] w-[72px] shrink-0 bg-background"
                        defaultValue={Number(appt.valor).toFixed(2)}
                        onBlur={(e) => {
                          const next = parseFloat(e.target.value.replace(",", "."));
                          const current = Number(appt.valor);
                          if (!Number.isNaN(next) && next !== current) {
                            onUpdateField(appt.id, "valor", String(next));
                          }
                        }}
                        title="Valor da consulta"
                      />
                    ) : (
                      <>R$ {Number(appt.valor).toFixed(2)}</>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? (
                      <span title={consultaPaymentLabel(appt)}>{consultaPaymentLabel(appt)}</span>
                    ) : (
                      <Select
                        value={appt.forma_pagamento_consulta || ""}
                        onValueChange={(v) => onUpdateField(appt.id, "forma_pagamento_consulta", v)}
                      >
                        <SelectTrigger className="h-7 text-[11px] w-[96px] shrink-0 px-2">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAS_PAGAMENTO_CONSULTA.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? (
                      <span>{cpaga === true ? "Sim" : cpaga === false ? "Não" : "—"}</span>
                    ) : (
                      <Select
                        value={cpaga === true ? "sim" : cpaga === false ? "nao" : ""}
                        onValueChange={(v) => onUpdateField(appt.id, "consulta_paga", v)}
                        disabled={consultaPagaLocked}
                      >
                        <SelectTrigger className="h-7 text-[11px] w-[96px] shrink-0 px-2">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sim">Sim</SelectItem>
                          <SelectItem value="nao">Não</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap" title={glassesPaymentLabel(appt)}>
                    {glassesPaymentLabel(appt)}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">{appt.canal_agendamento}</td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? appt.confirmacao : (
                      <Select value={appt.confirmacao} onValueChange={(v) => onUpdateField(appt.id, "confirmacao", v)}>
                        <SelectTrigger className="h-7 text-[11px] w-[104px] shrink-0 px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {confirmacaoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? appt.comparecimento : (
                      <Select value={appt.comparecimento} onValueChange={(v) => onUpdateField(appt.id, "comparecimento", v)}>
                        <SelectTrigger className="h-7 text-[11px] w-[112px] shrink-0 px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {comparecimentoOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? appt.venda : (
                      <Select value={appt.venda} onValueChange={(v) => onUpdateField(appt.id, "venda", v)}>
                        <SelectTrigger className="h-7 text-[11px] w-[96px] shrink-0 px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {vendaOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {isSnapshot ? (
                      <span title={appt.resumo || undefined}>{appt.resumo || "—"}</span>
                    ) : (
                      <input
                        type="text"
                        className="border rounded px-1.5 h-7 text-[11px] w-[100px] shrink-0 bg-background"
                        defaultValue={appt.resumo}
                        onBlur={(e) => {
                          if (e.target.value !== appt.resumo) onUpdateField(appt.id, "resumo", e.target.value);
                        }}
                        placeholder="Obs..."
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                    {renderActions(appt, isSnapshot)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
