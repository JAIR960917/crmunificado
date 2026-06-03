import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import WhatsAppInboxTaskForm from "@/components/whatsapp/WhatsAppInboxTaskForm";

export type InboxLinkedRecord = {
  module: "leads" | "renovacoes";
  id: string;
  nome: string;
  empresaNome: string | null;
  statusLabel?: string | null;
  telefone?: string | null;
  valorLabel?: string | null;
};

type Props = {
  record: InboxLinkedRecord;
  displayPhone: string;
};

export default function WhatsAppInboxLinkedCard({ record, displayPhone }: Props) {
  const navigate = useNavigate();
  const isRenovacao = record.module === "renovacoes";
  const telefone = record.telefone?.trim() || displayPhone;

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {isRenovacao ? "Renovação no CRM" : "Lead no CRM"}
      </p>
      <p className="font-semibold leading-snug break-words">{record.nome}</p>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Telefone</dt>
          <dd className="mt-0.5 font-medium text-amber-700 dark:text-amber-300 break-words">{telefone}</dd>
        </div>
        {record.empresaNome ? (
          <div>
            <dt className="text-xs text-muted-foreground">Empresa</dt>
            <dd className="mt-0.5 text-xs break-words">{record.empresaNome}</dd>
          </div>
        ) : null}
        {record.statusLabel ? (
          <div>
            <dt className="text-xs text-muted-foreground">Coluna</dt>
            <dd className="mt-0.5 text-xs font-medium break-words">{record.statusLabel}</dd>
          </div>
        ) : null}
        {record.valorLabel ? (
          <div>
            <dt className="text-xs text-muted-foreground">Valor</dt>
            <dd className="mt-0.5 text-xs font-medium break-words">{record.valorLabel}</dd>
          </div>
        ) : null}
      </dl>

      <WhatsAppInboxTaskForm module={record.module} recordId={record.id} />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => navigate(isRenovacao ? "/clientes-ativos" : `/?edit=${record.id}`)}
      >
        <ExternalLink className="h-4 w-4" />
        {isRenovacao ? "Abrir tela de renovação" : "Abrir na tela de leads"}
      </Button>
    </div>
  );
}
