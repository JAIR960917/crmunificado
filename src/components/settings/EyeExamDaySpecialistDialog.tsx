import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EyeExamSpecialist } from "@/lib/eyeExamSchedule";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  examDate: string;
  specialists: EyeExamSpecialist[];
  assignedIds: string[];
  eyeExamDayId: string | null;
  onSaved: () => void;
};

export default function EyeExamDaySpecialistDialog({
  open,
  onOpenChange,
  companyId,
  examDate,
  specialists,
  assignedIds,
  eyeExamDayId,
  onSaved,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(assignedIds));
  }, [open, assignedIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      toast.error("Selecione pelo menos um especialista");
      return;
    }
    setSaving(true);
    try {
      let dayId = eyeExamDayId;
      if (!dayId) {
        const { data, error } = await supabase
          .from("company_eye_exam_days")
          .insert({ company_id: companyId, exam_date: examDate })
          .select("id")
          .single();
        if (error) throw error;
        dayId = data.id;
      }

      const { error: delErr } = await supabase
        .from("company_eye_exam_day_specialists")
        .delete()
        .eq("eye_exam_day_id", dayId);
      if (delErr) throw delErr;

      const rows = [...selected].map((specialist_id) => ({
        eye_exam_day_id: dayId!,
        specialist_id,
      }));
      const { error: insErr } = await supabase.from("company_eye_exam_day_specialists").insert(rows);
      if (insErr) throw insErr;

      toast.success("Escala do dia salva");
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error("Erro ao salvar escala do dia");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDay = async () => {
    if (!eyeExamDayId) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("company_eye_exam_days")
        .delete()
        .eq("id", eyeExamDayId);
      if (error) throw error;
      toast.success("Dia removido da escala");
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error("Erro ao remover dia");
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = format(parseISO(`${examDate}T12:00:00`), "dd/MM/yyyy (EEEE)", { locale: ptBR });
  const activeSpecialists = specialists.filter((s) => s.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Especialistas no dia</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>

        {activeSpecialists.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Cadastre especialistas na seção acima antes de marcar dias.
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto py-1">
            {activeSpecialists.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
              >
                <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                <span className="text-sm">{s.name}</span>
              </label>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {eyeExamDayId && (
            <Button type="button" variant="destructive" onClick={() => void handleRemoveDay()} disabled={saving}>
              Remover dia
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || activeSpecialists.length === 0}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
