import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { X, Plus, Trash2, CheckCircle2, Clock, FileText, CalendarIcon, AlertTriangle, CalendarClock, Pencil, CalendarHeart, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/lib/phoneFormat";
import ClientProductsTab from "@/components/ClientProductsTab";
import { recordCardOpen } from "@/lib/cardOpens";
import RenovacaoContactAttemptForm from "./RenovacaoContactAttemptForm";

type Profile = { user_id: string; full_name: string; avatar_url?: string | null };
type CrmStatus = { id: string; key: string; label: string };

type FormField = {
  id: string; label: string; field_type: string; options: string[] | null; position: number;
  is_required: boolean; is_name_field: boolean; is_phone_field: boolean; is_last_visit_field: boolean;
  show_on_card: boolean; parent_field_id: string | null; parent_trigger_value: string | null;
};

type Activity = {
  id: string; renovacao_id: string; title: string; description: string | null;
  scheduled_date: string; completed_at: string | null; created_by: string; created_at: string;
};
type Note = { id: string; renovacao_id: string; user_id: string; content: string; created_at: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  renovacaoId: string | null;
  formData: Record<string, any>;
  setFormData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  formStatus: string;
  setFormStatus: (s: string) => void;
  formAssigned: string;
  setFormAssigned: (s: string) => void;
  formValor: string;
  setFormValor: (s: string) => void;
  statuses: CrmStatus[];
  profiles: Profile[];
  fields: FormField[];
  saving: boolean;
  onSave: (e: React.FormEvent) => void;
  canReassign: boolean;
  ssoticaClienteId?: number | null;
  ssoticaCompanyId?: string | null;
};

const parseStoredDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const p = new Date(`${raw}T12:00:00`);
    return Number.isNaN(p.getTime()) ? undefined : p;
  }
  const p = new Date(raw);
  return Number.isNaN(p.getTime()) ? undefined : p;
};
const normalizePhoneDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(0, 11);

export default function RenovacaoEditSheet(props: Props) {
  const {
    open, onOpenChange, renovacaoId, formData, setFormData,
    formStatus, setFormStatus, formAssigned, setFormAssigned,
    formValor, setFormValor, statuses, profiles, fields, saving, onSave, canReassign,
    ssoticaClienteId, ssoticaCompanyId,
  } = props;
  const { user, isAdmin } = useAuth();

  const [tab, setTab] = useState("atividade");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDate, setTaskDate] = useState<Date | undefined>(undefined);
  const [taskTime, setTaskTime] = useState("09:00");
  const [savingTask, setSavingTask] = useState(false);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [editTaskDate, setEditTaskDate] = useState<Date | undefined>(undefined);
  const [editTaskTime, setEditTaskTime] = useState("09:00");
  const [savingEditTask, setSavingEditTask] = useState(false);

  const isEditing = !!renovacaoId;

  // Mandatory tratativa: enforced for non-admin users
  const [tratativaRegistrada, setTratativaRegistrada] = useState(false);
  const [contactDirty, setContactDirty] = useState(false);
  const requiresTratativa = isEditing && !isAdmin;

  const fetchTimeline = async () => {
    if (!renovacaoId) return;
    const [{ data: acts }, { data: ns }] = await Promise.all([
      supabase.from("renovacao_activities" as any).select("*").eq("renovacao_id", renovacaoId).order("scheduled_date", { ascending: false }),
      supabase.from("crm_renovacao_notes" as any).select("*").eq("renovacao_id", renovacaoId).order("created_at", { ascending: false }),
    ]);
    setActivities((acts || []) as unknown as Activity[]);
    setNotes((ns || []) as unknown as Note[]);
  };

  useEffect(() => {
    if (open && renovacaoId) {
      fetchTimeline();
      setTab("atividade");
      setNewComment("");
      setTaskOpen(false);
      setTratativaRegistrada(false);
      // Track card open for daily salesperson report
      if (user?.id) {
        recordCardOpen({ userId: user.id, cardType: "renovacao", renovacaoId });
      }
    }
  }, [open, renovacaoId]);

  const handleOpenChange = (next: boolean) => {
    if (!next && contactDirty) {
      toast.error("Você iniciou uma tratativa. Clique em \"Salvar contato\" para concluir antes de fechar.");
      return;
    }
    if (!next && requiresTratativa && !tratativaRegistrada) {
      toast.error("Registre uma tratativa antes de fechar esta renovação.");
      return;
    }
    onOpenChange(next);
  };

  const timeline = useMemo(() => {
    const items = [
      ...activities.map(a => ({ id: a.id, type: "activity" as const, date: a.scheduled_date, data: a })),
      ...notes.map(n => ({ id: n.id, type: "note" as const, date: n.created_at, data: n })),
    ];
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activities, notes]);

  const handlePostComment = async () => {
    if (!renovacaoId || !newComment.trim() || !user) return;
    setPostingComment(true);
    const { error } = await supabase.from("crm_renovacao_notes" as any).insert({
      renovacao_id: renovacaoId, user_id: user.id, content: newComment.trim(),
    } as any);
    if (error) toast.error("Erro ao adicionar comentário");
    else { setNewComment(""); fetchTimeline(); }
    setPostingComment(false);
  };

  const handleCreateTask = async () => {
    if (!renovacaoId || !taskTitle.trim() || !taskDate || !user) {
      toast.error("Preencha título e data"); return;
    }
    setSavingTask(true);
    const [h, m] = taskTime.split(":").map(Number);
    const dt = new Date(taskDate); dt.setHours(h || 9, m || 0, 0, 0);
    const { error } = await supabase.from("renovacao_activities" as any).insert({
      renovacao_id: renovacaoId, created_by: user.id,
      title: taskTitle.trim(), description: taskDescription.trim() || null,
      scheduled_date: dt.toISOString(),
    } as any);
    if (error) toast.error("Erro ao criar tarefa");
    else {
      toast.success("Tarefa criada");
      setTaskOpen(false); setTaskTitle(""); setTaskDescription(""); setTaskDate(undefined); setTaskTime("09:00");
      fetchTimeline();
      setTratativaRegistrada(true);
    }
    setSavingTask(false);
  };

  const toggleTaskComplete = async (a: Activity) => {
    const newVal = a.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("renovacao_activities" as any).update({ completed_at: newVal } as any).eq("id", a.id);
    if (error) toast.error("Erro"); else fetchTimeline();
  };

  const deleteActivity = async (id: string) => {
    const { error } = await supabase.from("renovacao_activities" as any).delete().eq("id", id);
    if (error) toast.error("Erro ao excluir"); else fetchTimeline();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("crm_renovacao_notes" as any).delete().eq("id", id);
    if (error) toast.error("Erro ao excluir"); else fetchTimeline();
  };

  const getProfile = (uid: string) => profiles.find(p => p.user_id === uid);

  const startEditTask = (a: Activity) => {
    setEditingTaskId(a.id);
    setEditTaskTitle(a.title);
    setEditTaskDescription(a.description || "");
    const d = new Date(a.scheduled_date);
    setEditTaskDate(d);
    setEditTaskTime(format(d, "HH:mm"));
  };

  const handleUpdateTask = async () => {
    if (!editingTaskId || !editTaskTitle.trim() || !editTaskDate) return;
    setSavingEditTask(true);
    const [h, m] = editTaskTime.split(":").map(Number);
    const dt = new Date(editTaskDate); dt.setHours(h || 9, m || 0, 0, 0);
    const { error } = await supabase.from("renovacao_activities" as any).update({
      title: editTaskTitle.trim(),
      description: editTaskDescription.trim() || null,
      scheduled_date: dt.toISOString(),
    } as any).eq("id", editingTaskId);
    if (error) toast.error("Erro ao atualizar tarefa");
    else { toast.success("Tarefa atualizada"); setEditingTaskId(null); fetchTimeline(); setTratativaRegistrada(true); }
    setSavingEditTask(false);
  };

  const getTaskStatus = (a: Activity): "completed" | "overdue" | "today" | "pending" => {
    if (a.completed_at) return "completed";
    const now = new Date();
    const d = new Date(a.scheduled_date);
    if (d < now) return "overdue";
    if (d.toDateString() === now.toDateString()) return "today";
    return "pending";
  };

  // Form rendering helpers
  const set = (key: string, val: any) => setFormData((p) => ({ ...p, [key]: val }));
  const toggleArray = (key: string, item: string) => {
    const arr: string[] = formData[key] || [];
    set(key, arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  };

  const isFieldVisible = (field: FormField): boolean => {
    if (!field.parent_field_id) return true;
    const parent = fields.find(f => f.id === field.parent_field_id);
    if (!parent || !isFieldVisible(parent)) return false;
    if (!field.parent_trigger_value) return true;
    let triggers: string[];
    try {
      const p = JSON.parse(field.parent_trigger_value);
      triggers = Array.isArray(p) ? p : [field.parent_trigger_value];
    } catch { triggers = [field.parent_trigger_value]; }
    const pv = formData[`field_${parent.id}`];
    if (Array.isArray(pv)) return pv.some((v: string) => triggers.includes(v));
    return triggers.includes(pv);
  };

  const renderFormField = (field: FormField) => {
    if (!isFieldVisible(field)) return null;
    const fieldKey = `field_${field.id}`;
    const rawValue = formData[fieldKey];
    const value = typeof rawValue === "string" ? rawValue : rawValue == null ? "" : String(rawValue);
    const checkboxValues: string[] = Array.isArray(rawValue) ? rawValue : [];
    const selectedDate = parseStoredDate(rawValue);
    const isLastVisit = field.is_last_visit_field;

    return (
      <div key={field.id} className={cn("space-y-2", field.parent_field_id && "ml-4 pl-3 border-l-2 border-primary/20", isLastVisit && "p-3 rounded-lg bg-primary/5 border border-primary/30")}>
        <Label className="text-xs flex items-center gap-1.5">
          {isLastVisit && <CalendarHeart className="h-3.5 w-3.5 text-primary" />}
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
          {isLastVisit && <span className="ml-1 text-[10px] uppercase font-bold text-primary">principal</span>}
        </Label>
        {field.field_type === "text" && (
          <Input value={value} onChange={(e) => set(fieldKey, e.target.value)} required={field.is_required} className="h-9 text-sm" />
        )}
        {field.field_type === "number" && (
          <Input type="number" value={value} onChange={(e) => set(fieldKey, e.target.value)} required={field.is_required} className="h-9 text-sm" />
        )}
        {field.field_type === "email" && (
          <Input type="email" value={value} onChange={(e) => set(fieldKey, e.target.value)} required={field.is_required} className="h-9 text-sm" />
        )}
        {(field.field_type === "phone" || field.is_phone_field) && (
          <Input type="tel" inputMode="numeric" placeholder="(00) 00000-0000"
            value={formatPhoneBR(normalizePhoneDigits(rawValue))}
            onChange={(e) => set(fieldKey, normalizePhoneDigits(e.target.value))}
            required={field.is_required} maxLength={16} className="h-9 text-sm" />
        )}
        {field.field_type === "textarea" && (
          <Textarea value={value} onChange={(e) => set(fieldKey, e.target.value)} rows={3} className="text-sm" />
        )}
        {field.field_type === "select" && field.options && (
          <Select value={value} onValueChange={(v) => set(fieldKey, v)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {field.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {field.field_type === "checkbox_group" && field.options && (
          <div className="flex flex-wrap gap-1.5">
            {field.options.map(opt => {
              const checked = checkboxValues.includes(opt);
              return (
                <label key={opt} className={cn("flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors", checked ? "bg-primary/10 border-primary text-primary" : "bg-muted/50 border-border text-foreground hover:bg-muted")}>
                  <Checkbox checked={checked} onCheckedChange={() => toggleArray(fieldKey, opt)} className="h-3 w-3" />
                  {opt}
                </label>
              );
            })}
          </div>
        )}
        {field.field_type === "date" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-9 text-sm", !value && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? format(selectedDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={selectedDate} onSelect={(d) => set(fieldKey, d ? format(d, "yyyy-MM-dd") : "")} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );
  };

  const rootFields = fields.filter(f => !f.parent_field_id).sort((a, b) => a.position - b.position);
  const childrenOf = (id: string) => fields.filter(f => f.parent_field_id === id).sort((a, b) => a.position - b.position);
  const renderFieldTree = (field: FormField): JSX.Element[] => {
    const result: JSX.Element[] = [];
    const node = renderFormField(field);
    if (node) result.push(node);
    childrenOf(field.id).forEach(c => result.push(...renderFieldTree(c)));
    return result;
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1100px] p-0 flex flex-col sm:flex-row gap-0 overflow-y-auto sm:overflow-hidden">
        {/* LEFT: Form */}
        <div className="w-full sm:w-[420px] sm:border-r border-b sm:border-b-0 border-border flex flex-col bg-card sm:overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="font-semibold text-lg">{isEditing ? "Editar Renovação" : "Nova Renovação"}</h2>
          </div>
          <ScrollArea className="sm:flex-1">
            <form onSubmit={(e) => {
              if (requiresTratativa && !tratativaRegistrada) {
                e.preventDefault();
                toast.error("Registre uma tratativa antes de salvar esta renovação.");
                return;
              }
              onSave(e);
            }} id="renovacao-form" className="p-5 space-y-4">
              {fields.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhuma pergunta configurada. Configure em <strong>Formulário Renovação</strong>.
                </p>
              )}
              {rootFields.flatMap(f => renderFieldTree(f))}

              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input type="number" step="0.01" value={formValor} onChange={e => setFormValor(e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {canReassign && (
                <div className="space-y-2">
                  <Label>Responsável</Label>
                  <Select value={formAssigned} onValueChange={setFormAssigned}>
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" form="renovacao-form" className="w-full" disabled={saving}>
                {saving ? "Salvando..." : isEditing ? "Atualizar" : "Criar"}
              </Button>
            </form>
          </ScrollArea>
        </div>

        {/* RIGHT: Timeline */}
        <div className="flex-1 flex flex-col bg-background min-w-0 sm:overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <Tabs value={tab} onValueChange={setTab} className="flex-1">
              <TabsList className="bg-transparent">
                <TabsTrigger value="atividade" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">Atividade</TabsTrigger>
                <TabsTrigger value="comentario">Comentário</TabsTrigger>
                <TabsTrigger value="tarefa">Tarefa</TabsTrigger>
                <TabsTrigger value="produtos" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
                  <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                  Produtos
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="ghost" size="icon" onClick={() => handleOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!isEditing ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
              Salve a renovação primeiro para adicionar comentários e tarefas.
            </div>
          ) : tab === "produtos" ? (
            (() => {
              const cpfField = fields.find((f: any) => f.is_cpf_field);
              const cpfFromForm = cpfField ? String(formData[`field_${cpfField.id}`] || "") : "";
              const cpfFallback = String(formData?.documento ?? formData?.cpf ?? "");
              return (
                <ClientProductsTab
                  ssoticaClienteId={ssoticaClienteId ?? null}
                  ssoticaCompanyId={ssoticaCompanyId ?? null}
                  cpf={cpfFromForm || cpfFallback || null}
                />
              );
            })()
          ) : (
            <>
              <div className="px-5 py-3 border-b flex items-center gap-2">
                <Input
                  placeholder="Adicionar comentário..."
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handlePostComment(); } }}
                />
                <Button onClick={handlePostComment} disabled={postingComment || !newComment.trim()} variant="destructive">
                  Enviar
                </Button>
                <Popover open={taskOpen} onOpenChange={setTaskOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Tarefa
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">Nova Tarefa</h4>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Título</Label>
                        <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ligar para cliente..." />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Descrição (opcional)</Label>
                        <Textarea rows={2} value={taskDescription} onChange={e => setTaskDescription(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Data</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className={cn("w-full justify-start", !taskDate && "text-muted-foreground")}>
                                <CalendarIcon className="h-3 w-3 mr-1" />
                                {taskDate ? format(taskDate, "dd/MM/yy") : "Selecionar"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar mode="single" selected={taskDate} onSelect={setTaskDate} locale={ptBR} />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Hora</Label>
                          <Input type="time" value={taskTime} onChange={e => setTaskTime(e.target.value)} />
                        </div>
                      </div>
                      <Button onClick={handleCreateTask} disabled={savingTask} className="w-full" size="sm">
                        {savingTask ? "Criando..." : "Criar tarefa"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Tentativa de contato — visível para todos os usuários (admin, gerente, vendedor) */}
              {tab === "atividade" && renovacaoId && user && (
                <div className="px-5 py-3 border-b">
                  {requiresTratativa && !tratativaRegistrada && (
                    <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>É obrigatório registrar uma tratativa antes de fechar ou salvar esta renovação.</span>
                    </div>
                  )}
                  <RenovacaoContactAttemptForm
                    renovacaoId={renovacaoId}
                    userId={user.id}
                    renovacaoStatus={formStatus}
                    renovacaoSnapshot={(() => {
                      const nameField = fields.find(f => f.is_name_field);
                      const phoneField = fields.find(f => f.is_phone_field);
                      const nome = nameField ? String(formData[`field_${nameField.id}`] || "Cliente") : "Cliente";
                      const telefone = phoneField ? String(formData[`field_${phoneField.id}`] || "") : "";
                      return { nome, telefone, idade: "" };
                    })()}
                    onSaved={() => {
                      setTratativaRegistrada(true);
                      setContactDirty(false);
                      fetchTimeline();
                    }}
                    onDirtyChange={setContactDirty}
                  />
                </div>
              )}

              <ScrollArea className="sm:flex-1">
                <div className="p-5 space-y-3">
                  {tab === "atividade" && timeline.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-12">Nenhuma atividade registrada ainda.</p>
                  )}
                  {tab === "comentario" && notes.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-12">Nenhum comentário ainda.</p>
                  )}
                  {tab === "tarefa" && activities.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-12">Nenhuma tarefa criada.</p>
                  )}

                  {(tab === "atividade" ? timeline
                    : tab === "comentario" ? timeline.filter(t => t.type === "note")
                    : timeline.filter(t => t.type === "activity")
                  ).map(item => {
                    if (item.type === "note") {
                      const n = item.data as Note;
                      const p = getProfile(n.user_id);
                      return (
                        <div key={n.id} className="flex gap-3 group">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarImage src={p?.avatar_url || ""} />
                            <AvatarFallback className="text-xs">{(p?.full_name || "?").charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                              <span className="font-medium text-foreground">{p?.full_name || "Usuário"}</span>
                              <FileText className="h-3 w-3" />
                              <span>comentou {formatDistanceToNow(new Date(n.created_at), { locale: ptBR, addSuffix: true })}</span>
                            </div>
                            <div className="bg-card border rounded-lg p-3 text-sm whitespace-pre-wrap">{n.content}</div>
                          </div>
                          {(n.user_id === user?.id || isAdmin) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => deleteNote(n.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      );
                    } else {
                      const a = item.data as Activity;
                      const p = getProfile(a.created_by);
                      const status = getTaskStatus(a);
                      const canEdit = a.created_by === user?.id || isAdmin;

                      let iconBg = "bg-muted text-muted-foreground";
                      let labelClass = "text-muted-foreground bg-muted";
                      let label = "PENDENTE";
                      let cardClass = "border-border bg-card";

                      if (status === "completed") {
                        iconBg = "bg-emerald-500/20 text-emerald-500";
                        labelClass = "text-emerald-500 bg-emerald-500/15";
                        label = "CONCLUÍDA";
                        cardClass = "border-emerald-500/30 bg-emerald-500/5";
                      } else if (status === "overdue") {
                        iconBg = "bg-red-500/20 text-red-500";
                        labelClass = "text-red-500 bg-red-500/15";
                        label = "ATRASADA";
                        cardClass = "border-red-500/40 bg-red-500/5";
                      } else if (status === "today") {
                        iconBg = "bg-amber-500/20 text-amber-500";
                        labelClass = "text-amber-500 bg-amber-500/15";
                        label = "HOJE";
                        cardClass = "border-amber-500/40 bg-amber-500/5";
                      } else {
                        iconBg = "bg-blue-500/20 text-blue-500";
                        labelClass = "text-blue-500 bg-blue-500/15";
                      }

                      let scheduledFmt = "";
                      try { scheduledFmt = format(new Date(a.scheduled_date), "EEE, dd 'de' MMM, HH:mm", { locale: ptBR }); }
                      catch { scheduledFmt = a.scheduled_date; }

                      return (
                        <div key={a.id} className="relative pl-10 group">
                          <div className={cn("absolute left-1 top-1 w-7 h-7 rounded-full flex items-center justify-center", iconBg)}>
                            {status === "completed" ? <CheckCircle2 className="h-4 w-4" /> :
                             status === "overdue" ? <AlertTriangle className="h-4 w-4" /> :
                             <CalendarClock className="h-4 w-4" />}
                          </div>

                          <div className={cn("rounded-lg border p-3", cardClass)}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-foreground">Tarefa</span>
                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", labelClass)}>{label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(a.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {p && (
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={p.avatar_url ?? undefined} />
                                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                      {(p.full_name || "?").slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                )}
                                {canEdit && (
                                  <>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => startEditTask(a)}>
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => deleteActivity(a.id)}>
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>

                            {editingTaskId === a.id ? (
                              <div className="mt-2 rounded-md bg-background/60 p-2.5 space-y-2">
                                <Input value={editTaskTitle} onChange={e => setEditTaskTitle(e.target.value)} placeholder="Título..." className="h-8 text-sm" />
                                <Textarea value={editTaskDescription} onChange={e => setEditTaskDescription(e.target.value)} placeholder="Descrição (opcional)..." rows={2} className="text-sm" />
                                <div className="flex gap-2">
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button variant="outline" className="flex-1 justify-start text-left h-8 text-sm">
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                        {editTaskDate ? format(editTaskDate, "dd/MM/yyyy", { locale: ptBR }) : "Data"}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                      <Calendar mode="single" selected={editTaskDate} onSelect={setEditTaskDate} locale={ptBR} className="p-3 pointer-events-auto" />
                                    </PopoverContent>
                                  </Popover>
                                  <div className="relative">
                                    <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input type="time" value={editTaskTime} onChange={e => setEditTaskTime(e.target.value)} className="h-8 text-sm pl-8 w-[110px]" />
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingTaskId(null)}>Cancelar</Button>
                                  <Button size="sm" className="text-xs h-7" onClick={handleUpdateTask} disabled={savingEditTask || !editTaskTitle.trim() || !editTaskDate}>
                                    {savingEditTask ? "Salvando..." : "Salvar"}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="mt-2 rounded-md bg-background/40 p-2.5">
                                  <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                      <span className="text-muted-foreground text-xs">Prazo</span>
                                      <p className={cn("font-medium text-xs", status === "overdue" && "text-red-500")}>{scheduledFmt}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground text-xs">Título</span>
                                      <p className={cn("font-medium text-xs", status === "completed" && "line-through text-muted-foreground")}>{a.title}</p>
                                    </div>
                                  </div>
                                  {a.description && (
                                    <p className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap">{a.description}</p>
                                  )}
                                  {p && (
                                    <div className="mt-1.5">
                                      <span className="text-muted-foreground text-xs">Responsável</span>
                                      <p className="text-xs font-medium text-primary">{p.full_name}</p>
                                    </div>
                                  )}
                                </div>

                                <div className="flex gap-2 mt-2">
                                  <Button
                                    size="sm"
                                    variant={status === "completed" ? "outline" : "destructive"}
                                    className="text-xs h-7"
                                    onClick={() => toggleTaskComplete(a)}
                                  >
                                    {status === "completed" ? "Reabrir" : "Concluir"}
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
