import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CalendarClock, CalendarIcon, Loader2 } from "lucide-react";

type InboxTaskModule = "leads" | "renovacoes";

type Props = {
  module: InboxTaskModule;
  recordId: string;
};

export default function WhatsAppInboxTaskForm({ module, recordId }: Props) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskDate, setTaskDate] = useState<Date | undefined>();
  const [taskTime, setTaskTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!user?.id) {
      toast.error("Faça login para agendar tarefa.");
      return;
    }
    if (!title.trim() || !taskDate) {
      toast.error("Preencha título e data da tarefa.");
      return;
    }
    setSaving(true);
    const [h, m] = taskTime.split(":").map(Number);
    const dt = new Date(taskDate);
    dt.setHours(h || 9, m || 0, 0, 0);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      scheduled_date: dt.toISOString(),
      created_by: user.id,
    };

    const { error } =
      module === "leads"
        ? await supabase.from("lead_activities").insert({ ...payload, lead_id: recordId })
        : await supabase.from("renovacao_activities").insert({ ...payload, renovacao_id: recordId });

    setSaving(false);
    if (error) {
      toast.error("Erro ao criar tarefa: " + error.message);
      return;
    }
    toast.success("Tarefa agendada com sucesso!");
    setTitle("");
    setDescription("");
    setTaskDate(undefined);
    setTaskTime("09:00");
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full gap-2"
        onClick={() => setExpanded(true)}
      >
        <CalendarClock className="h-4 w-4" />
        Agendar tarefa
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border bg-background/60 p-3">
      <p className="text-xs font-medium text-muted-foreground">Nova tarefa</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Título</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ligar / retorno WhatsApp…"
          className="h-9 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Descrição (opcional)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="resize-none text-sm"
          placeholder="Detalhes do follow-up"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Data</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("w-full justify-start h-9", !taskDate && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {taskDate ? format(taskDate, "dd/MM/yy", { locale: ptBR }) : "Data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={taskDate} onSelect={setTaskDate} locale={ptBR} />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Horário</Label>
          <Input
            type="time"
            value={taskTime}
            onChange={(e) => setTaskTime(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setExpanded(false)}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1 gap-1"
          disabled={saving || !title.trim() || !taskDate}
          onClick={() => void handleCreate()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  );
}
