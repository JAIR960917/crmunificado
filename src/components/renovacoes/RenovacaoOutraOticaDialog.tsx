import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Store } from "lucide-react";
import { parseStoredDate } from "@/lib/kanbanCardSort";
import {
  RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS,
  buildOutraOticaFollowupDate,
  formatDateForDb,
  getOutraOticaFields,
  mergeOutraOticaIntoData,
  resolveStatusAfterOutraOtica,
  type RenovacaoFlowItem,
} from "@/lib/renovacaoFlow";
import { syncRenovacaoOutraOticaFollowup } from "@/lib/renovacaoOutraOticaSave";
import RenovacaoOutraOticaFields from "./RenovacaoOutraOticaFields";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: RenovacaoFlowItem & { id: string; data?: Record<string, unknown> };
  clientName?: string;
  userId?: string;
  onSaved: () => void;
};

export default function RenovacaoOutraOticaDialog({
  open,
  onOpenChange,
  item,
  clientName,
  userId,
  onSaved,
}: Props) {
  const [renovou, setRenovou] = useState(false);
  const [examDate, setExamDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const { renovou: r, dataExame } = getOutraOticaFields(item);
    setRenovou(r);
    setExamDate(dataExame ? parseStoredDate(dataExame) : undefined);
  }, [open, item]);

  const handleSave = async () => {
    if (renovou && !examDate) {
      toast.error("Informe a data do último exame na outra ótica.");
      return;
    }

    setSaving(true);
    try {
      const dateStr = renovou && examDate ? formatDateForDb(examDate) : null;
      const prev = getOutraOticaFields(item);

      const mergedData = mergeOutraOticaIntoData(
        (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>,
        renovou,
        dateStr,
      );

      const nextItem: RenovacaoFlowItem = {
        ...item,
        data: mergedData,
        renovou_outra_otica: renovou,
        data_exame_outra_otica: dateStr,
      };
      const resolvedStatus = resolveStatusAfterOutraOtica(nextItem);

      const payload: Record<string, unknown> = {
        data: mergedData,
        status: resolvedStatus,
      };

      const { error } = await supabase
        .from("crm_renovacoes")
        .update(payload)
        .eq("id", item.id);

      if (error) throw error;

      // Colunas dedicadas (quando a migration já estiver aplicada no servidor).
      await supabase
        .from("crm_renovacoes")
        .update({
          renovou_outra_otica: renovou,
          data_exame_outra_otica: dateStr,
        } as Record<string, unknown>)
        .eq("id", item.id);

      await syncRenovacaoOutraOticaFollowup({
        renovacaoId: item.id,
        renovou,
        examDate: examDate ?? null,
        dateStr,
        previousRenovou: prev.renovou,
        previousDateStr: prev.dataExame,
        userId,
        clientName,
      });

      if (renovou && dateStr) {
        toast.success(
          `Registrado. Card reposicionado no fluxo e tarefa agendada para ${format(buildOutraOticaFollowupDate(examDate!), "dd/MM/yyyy", { locale: ptBR })}.`,
        );
      } else if (!renovou) {
        toast.success("Marcação de outra ótica removida.");
      } else {
        toast.success("Salvo com sucesso.");
      }

      onOpenChange(false);
      onSaved();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Renovação em outra ótica
          </DialogTitle>
          <DialogDescription>
            {clientName ? (
              <>
                Cliente: <strong>{clientName}</strong>. A coluna do card passará a considerar a data do
                exame na outra ótica. Uma tarefa será criada para daqui a {RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS}{" "}
                dias.
              </>
            ) : (
              <>
                A coluna do card passará a considerar a nova data. Tarefa automática em{" "}
                {RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS} dias.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <RenovacaoOutraOticaFields
          renovou={renovou}
          onRenovouChange={(v) => {
            setRenovou(v);
            if (!v) setExamDate(undefined);
          }}
          examDate={examDate}
          onExamDateChange={setExamDate}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
