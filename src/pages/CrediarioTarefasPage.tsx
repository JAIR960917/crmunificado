/**
 * Tarefas — Crediário (usuário financeiro).
 * Calendário mensal para agendar follow-ups com leads: nome, data, telefone, CPF e observação.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, CalendarIcon, ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import CrediarioTasksCalendar, { type CrediarioTask } from "@/components/crediario/CrediarioTasksCalendar";
import CrediarioRenegociacaoPanel, { type RenegociacaoStatus } from "@/components/crediario/CrediarioRenegociacaoPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCalendarQueryRange,
  shiftFocusDate,
  type CalendarViewMode,
} from "@/lib/appointmentCalendarUtils";
import { formatPhoneBR, unformatPhone } from "@/lib/phoneFormat";
import {
  calendarRangeIso,
  mapCobrancaActivityToCalendarTask,
  type CalendarTaskSource,
} from "@/lib/cobrancaCalendarTasks";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type TaskRow = CrediarioTask & {
  source: CalendarTaskSource;
  activityId?: string;
  activityTitle?: string;
  cobrancaId?: string;
  phone: string | null;
  cpf: string | null;
  observacao: string | null;
  renegociacao_status: RenegociacaoStatus;
  renegociacao_comentario: string | null;
  completed_at: string | null;
  parent_task_id: string | null;
};

function formatCpfBR(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function toDateString(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export default function CrediarioTarefasPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [calendarView, setCalendarView] = useState<CalendarViewMode>("month");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formNome, setFormNome] = useState("");
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formTelefone, setFormTelefone] = useState("");
  const [formCpf, setFormCpf] = useState("");
  const [formObservacao, setFormObservacao] = useState("");
  const [formTime, setFormTime] = useState("09:00");
  const [formRenegociou, setFormRenegociou] = useState<RenegociacaoStatus>(null);
  const [formRenegComentario, setFormRenegComentario] = useState("");
  const [formProximaData, setFormProximaData] = useState<Date | undefined>();
  const [formProximaTime, setFormProximaTime] = useState("09:00");

  const { queryStart, queryEnd, label: calendarLabel } = useMemo(
    () => getCalendarQueryRange(focusDate, calendarView),
    [focusDate, calendarView],
  );

  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const start = toDateString(queryStart);
    const end = toDateString(queryEnd);
    const { startIso, endIso } = calendarRangeIso(queryStart, queryEnd);

    const [crediarioRes, activitiesRes] = await Promise.all([
      supabase
        .from("crediario_tasks")
        .select("id, lead_name, scheduled_date, scheduled_time, phone, cpf, observacao, renegociacao_status, renegociacao_comentario, completed_at, parent_task_id")
        .eq("user_id", user.id)
        .gte("scheduled_date", start)
        .lte("scheduled_date", end)
        .order("scheduled_date", { ascending: true })
        .order("lead_name", { ascending: true }),
      supabase
        .from("cobranca_activities")
        .select("id, cobranca_id, title, description, scheduled_date, completed_at")
        .eq("created_by", user.id)
        .gte("scheduled_date", startIso)
        .lte("scheduled_date", endIso)
        .order("scheduled_date", { ascending: true }),
    ]);

    if (crediarioRes.error || activitiesRes.error) {
      toast.error("Erro ao carregar tarefas");
      setLoading(false);
      return;
    }

    const crediarioTasks: TaskRow[] = ((crediarioRes.data || []) as Omit<TaskRow, "source">[]).map(
      (task) => ({ ...task, source: "crediario" as const }),
    );

    const activities = activitiesRes.data || [];
    const cobrancaIds = Array.from(new Set(activities.map((a) => a.cobranca_id)));
    let cobrancaMap = new Map<string, { id: string; data: Record<string, unknown> | null }>();

    if (cobrancaIds.length > 0) {
      const { data: cobs } = await supabase
        .from("crm_cobrancas")
        .select("id, data")
        .in("id", cobrancaIds);
      cobrancaMap = new Map(
        ((cobs || []) as { id: string; data: Record<string, unknown> | null }[]).map((c) => [c.id, c]),
      );
    }

    const cobrancaTasks: TaskRow[] = activities.map((activity) =>
      mapCobrancaActivityToCalendarTask(
        activity,
        cobrancaMap.get(activity.cobranca_id) ?? null,
      ),
    );

    const merged = [...crediarioTasks, ...cobrancaTasks].sort((a, b) => {
      const dateCmp = a.scheduled_date.localeCompare(b.scheduled_date);
      if (dateCmp !== 0) return dateCmp;
      return a.lead_name.localeCompare(b.lead_name, "pt-BR");
    });

    setTasks(merged);
    setLoading(false);
  }, [user, queryStart, queryEnd]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const resetForm = () => {
    setFormNome("");
    setFormDate(undefined);
    setFormTelefone("");
    setFormCpf("");
    setFormObservacao("");
    setFormTime("09:00");
    setFormRenegociou(null);
    setFormRenegComentario("");
    setFormProximaData(undefined);
    setFormProximaTime("09:00");
    setEditing(null);
  };

  const openAdd = (prefillDate?: Date) => {
    resetForm();
    if (prefillDate) setFormDate(prefillDate);
    setDialogOpen(true);
  };

  const openEdit = (task: TaskRow) => {
    setEditing(task);
    setFormNome(task.source === "cobranca" ? task.activityTitle || task.lead_name : task.lead_name);
    setFormDate(parseISO(task.scheduled_date));
    setFormTelefone(task.phone ? formatPhoneBR(task.phone) : "");
    setFormCpf(task.cpf ? formatCpfBR(task.cpf) : "");
    setFormObservacao(task.observacao || "");
    setFormTime((task.scheduled_time || "09:00:00").slice(0, 5));
    setFormRenegociou((task.renegociacao_status as RenegociacaoStatus) || null);
    setFormRenegComentario(task.renegociacao_comentario || "");
    setFormProximaData(undefined);
    setFormProximaTime("09:00");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!user) return;
    const nome = formNome.trim();
    if (!nome) {
      toast.error("Informe o nome do lead");
      return;
    }
    if (!formDate) {
      toast.error("Informe a data do agendamento");
      return;
    }

    if (editing && formRenegociou === "sim") {
      if (!formRenegComentario.trim()) {
        toast.error("Informe os comentários da renegociação");
        return;
      }
      if (!formProximaData) {
        toast.error("Informe a data da próxima renegociação");
        return;
      }
    }

    setSaving(true);

    if (editing?.source === "cobranca" && editing.activityId) {
      const [h, m] = formTime.split(":").map(Number);
      const dt = new Date(formDate!);
      dt.setHours(h || 9, m || 0, 0, 0);

      const { error } = await supabase
        .from("cobranca_activities")
        .update({
          title: nome,
          description: formObservacao.trim() || null,
          scheduled_date: dt.toISOString(),
        })
        .eq("id", editing.activityId);

      if (error) toast.error("Erro ao salvar tarefa");
      else {
        toast.success("Tarefa atualizada");
        setDialogOpen(false);
        resetForm();
        fetchTasks();
      }
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {
      user_id: user.id,
      lead_name: nome,
      scheduled_date: toDateString(formDate),
      scheduled_time: `${formTime}:00`,
      phone: unformatPhone(formTelefone) || null,
      cpf: formCpf.replace(/\D/g, "") || null,
      observacao: formObservacao.trim() || null,
    };

    if (editing && formRenegociou) {
      payload.renegociacao_status = formRenegociou;
      payload.renegociacao_comentario = formRenegComentario.trim() || null;
      payload.completed_at = new Date().toISOString();
    }

    if (editing) {
      const { error } = await supabase
        .from("crediario_tasks")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        toast.error("Erro ao salvar tarefa");
        setSaving(false);
        return;
      }

      if (formRenegociou === "sim" && formProximaData) {
        const { error: followUpErr } = await supabase.from("crediario_tasks").insert({
          user_id: user.id,
          lead_name: nome,
          scheduled_date: toDateString(formProximaData),
          scheduled_time: `${formProximaTime}:00`,
          phone: unformatPhone(formTelefone) || null,
          cpf: formCpf.replace(/\D/g, "") || null,
          observacao: formObservacao.trim() || null,
          parent_task_id: editing.id,
        });
        if (followUpErr) {
          toast.error("Tarefa salva, mas falhou ao agendar a próxima renegociação");
        } else {
          toast.success("Renegociação registrada e próxima tarefa agendada");
        }
      } else if (formRenegociou) {
        toast.success("Renegociação registrada");
      } else {
        toast.success("Tarefa atualizada");
      }

      setDialogOpen(false);
      resetForm();
      fetchTasks();
    } else {
      const { error } = await supabase.from("crediario_tasks").insert(payload);
      if (error) toast.error("Erro ao criar tarefa");
      else {
        toast.success("Tarefa criada");
        setDialogOpen(false);
        resetForm();
        fetchTasks();
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId || !editing) return;

    const error =
      editing.source === "cobranca" && editing.activityId
        ? (await supabase.from("cobranca_activities").delete().eq("id", editing.activityId)).error
        : (await supabase.from("crediario_tasks").delete().eq("id", deleteId)).error;

    if (error) toast.error("Erro ao excluir tarefa");
    else {
      toast.success("Tarefa excluída");
      setDialogOpen(false);
      resetForm();
      fetchTasks();
    }
    setDeleteId(null);
  };

  return (
    <AppLayout>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Tarefas Cobrança</h1>
          </div>
          <p className="text-sm text-muted-foreground">{tasks.length} tarefa(s) no período</p>
        </div>
        <Button size="sm" onClick={() => openAdd()}>
          <Plus className="mr-1 h-4 w-4" /> Nova Tarefa
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setFocusDate(new Date())}>Hoje</Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setFocusDate((d) => shiftFocusDate(d, calendarView, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setFocusDate((d) => shiftFocusDate(d, calendarView, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold capitalize ml-1">{calendarLabel}</span>
          </div>
          <Select value={calendarView} onValueChange={(v) => setCalendarView(v as CalendarViewMode)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Mês</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="day">Dia</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Carregando...</p>
        ) : (
          <CrediarioTasksCalendar
            tasks={tasks}
            view={calendarView}
            focusDate={focusDate}
            onSelectTask={(t) => {
              const full = tasks.find((x) => x.id === t.id);
              if (full) openEdit(full);
            }}
            onDayClick={(d) => {
              setFocusDate(d);
              setCalendarView("day");
            }}
          />
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          setDialogOpen(open);
        }}
      >
        <DialogContent className={cn(
          "max-h-[90vh] overflow-y-auto",
          editing ? "max-w-4xl" : "max-w-md",
        )}>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editing?.source === "cobranca" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                Tarefa vinculada a um card de cobrança. Você pode editar aqui ou abrir a cobrança do cliente.
              </div>
            )}
            <div className={cn(editing ? "grid grid-cols-1 md:grid-cols-2 gap-6" : "space-y-4")}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{editing?.source === "cobranca" ? "Título da tarefa *" : "Nome do lead *"}</Label>
                  <Input
                    value={formNome}
                    onChange={(e) => setFormNome(e.target.value)}
                    placeholder={editing?.source === "cobranca" ? "Ex.: Ligar para confirmar pagamento" : "Nome completo"}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Data do agendamento *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn("w-full justify-start text-left font-normal", !formDate && "text-muted-foreground")}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formDate ? format(formDate, "PPP", { locale: ptBR }) : "Selecione a data"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formDate} onSelect={setFormDate} locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Horário</Label>
                    <Input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input
                    value={formTelefone}
                    onChange={(e) => setFormTelefone(formatPhoneBR(e.target.value))}
                    placeholder="(00) 00000-0000"
                    readOnly={editing?.source === "cobranca"}
                    className={editing?.source === "cobranca" ? "bg-muted" : undefined}
                  />
                </div>

                <div className="space-y-2">
                  <Label>CPF</Label>
                  <Input
                    value={formCpf}
                    onChange={(e) => setFormCpf(formatCpfBR(e.target.value))}
                    placeholder="000.000.000-00"
                    readOnly={editing?.source === "cobranca"}
                    className={editing?.source === "cobranca" ? "bg-muted" : undefined}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Observação</Label>
                  <Textarea
                    value={formObservacao}
                    onChange={(e) => setFormObservacao(e.target.value)}
                    placeholder="O que foi agendado para fazer com o lead"
                    rows={4}
                  />
                </div>
              </div>

              {editing && editing.source === "crediario" && !editing.renegociacao_status && (
                <CrediarioRenegociacaoPanel
                  status={formRenegociou}
                  onStatusChange={setFormRenegociou}
                  comentario={formRenegComentario}
                  onComentarioChange={setFormRenegComentario}
                  proximaData={formProximaData}
                  onProximaDataChange={setFormProximaData}
                  proximaTime={formProximaTime}
                  onProximaTimeChange={setFormProximaTime}
                />
              )}
            </div>

            {editing?.renegociacao_status && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                Renegociação registrada:{" "}
                {editing.renegociacao_status === "sim" ? "Sim, renegociou" : "Não renegociou"}
                {editing.renegociacao_comentario ? ` — ${editing.renegociacao_comentario}` : ""}
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-2">
              {editing?.source === "cobranca" && editing.cobrancaId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    navigate("/cobrancas", { state: { openCobrancaId: editing.cobrancaId } })
                  }
                >
                  <ExternalLink className="mr-1 h-4 w-4" /> Abrir cobrança
                </Button>
              )}
              {editing && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteId(editing.id)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Excluir
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tarefa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A tarefa será removida do calendário.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
