import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { X, Plus, Trash2, CheckCircle2, Clock, FileText, CalendarIcon, AlertTriangle, CalendarClock, Pencil, Receipt, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import ClientProductsTab from "@/components/ClientProductsTab";
import CobrancaContactAttemptForm from "@/components/cobrancas/CobrancaContactAttemptForm";
import { recordCardOpen } from "@/lib/cardOpens";

type Profile = { user_id: string; full_name: string; avatar_url?: string | null };
type Company = { id: string; name: string };
type CrmStatus = { id: string; key: string; label: string };

type Activity = {
  id: string; cobranca_id: string; title: string; description: string | null;
  scheduled_date: string; completed_at: string | null; created_by: string; created_at: string;
};
type Note = {
  id: string; cobranca_id: string; user_id: string; content: string; created_at: string;
};

type ParcelaInfo = {
  id: string;
  numero_parcela: number | null;
  vencimento: string | null;
  valor: number;
  dias_atraso: number | null;
  status: string;
  is_current: boolean;
  loja_nome?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cobrancaId: string | null;
  ssoticaClienteId?: number | null;
  ssoticaCompanyId?: string | null;
  formData: Record<string, any>;
  setFormData: (d: Record<string, any>) => void;
  formStatus: string;
  setFormStatus: (s: string) => void;
  formAssigned: string;
  setFormAssigned: (s: string) => void;
  formValor: string;
  setFormValor: (s: string) => void;
  formCompanyId: string;
  setFormCompanyId: (s: string) => void;
  statuses: CrmStatus[];
  profiles: Profile[];
  companies: Company[];
  saving: boolean;
  onSave: (e: React.FormEvent) => void;
  canReassign: boolean;
};

function parseSafeDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dmy = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let [, day, month, year] = dmy;
    const yearNum = Number(year.length === 2 ? `20${year}` : year);
    const parsed = new Date(Date.UTC(yearNum, Number(month) - 1, Number(day), 12));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSafeDate(value: string | null | undefined): string {
  const parsed = parseSafeDate(value);
  return parsed ? format(parsed, "dd/MM/yyyy", { locale: ptBR }) : "—";
}

export default function CobrancaEditSheet(props: Props) {
  const {
    open, onOpenChange, cobrancaId, ssoticaClienteId, ssoticaCompanyId,
    formData, setFormData,
    formStatus, setFormStatus, formAssigned, setFormAssigned,
    formValor, setFormValor, formCompanyId, setFormCompanyId,
    statuses, profiles, companies, saving, onSave, canReassign,
  } = props;
  const { user, isAdmin, isFinanceiro } = useAuth();

  const [tab, setTab] = useState("atividade");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaInfo[]>([]);
  const [loadingParcelas, setLoadingParcelas] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  // Tracks whether a contact attempt was registered during this open session.
  // Required for "financeiro" role to be able to close / save the card.
  const [contactRegisteredInSession, setContactRegisteredInSession] = useState(false);

  // Task creation
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDate, setTaskDate] = useState<Date | undefined>(undefined);
  const [taskTime, setTaskTime] = useState("09:00");
  const [savingTask, setSavingTask] = useState(false);

  // Edit task inline
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [editTaskDate, setEditTaskDate] = useState<Date | undefined>(undefined);
  const [editTaskTime, setEditTaskTime] = useState("09:00");
  const [savingEditTask, setSavingEditTask] = useState(false);

  const isEditing = !!cobrancaId;

  const fetchTimeline = async () => {
    if (!cobrancaId) return;
    const [{ data: acts }, { data: ns }] = await Promise.all([
      supabase.from("cobranca_activities").select("*").eq("cobranca_id", cobrancaId).order("scheduled_date", { ascending: false }),
      supabase.from("crm_cobranca_notes").select("*").eq("cobranca_id", cobrancaId).order("created_at", { ascending: false }),
    ]);
    setActivities((acts || []) as Activity[]);
    setNotes((ns || []) as Note[]);
  };

  const fetchParcelas = async () => {
    setLoadingParcelas(true);
    const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
    const cpfDigits = onlyDigits(formData.documento || formData.cpf || "");
    const nome = (formData.nome || "").trim();

    // Estratégia 1 (preferida): se vinculado ao SSótica, lê a lista completa de parcelas
    // que o sync já gravou no JSON `data.parcelas_atrasadas` deste card.
    if (ssoticaClienteId && ssoticaCompanyId && cobrancaId) {
      const { data: card, error } = await supabase
        .from("crm_cobrancas")
        .select("data, ssotica_parcela_id")
        .eq("id", cobrancaId)
        .maybeSingle();

      const lista = (card as any)?.data?.parcelas_atrasadas as any[] | undefined;
      const currentParcelaId = (card as any)?.ssotica_parcela_id;
      if (!error && Array.isArray(lista) && lista.length > 0) {
        // Mapa de empresas para mostrar a loja em cada parcela quando o card foi mesclado entre lojas
        const companiesById = new Map((companies ?? []).map((c: any) => [String(c.id), c.name as string]));
        const parcelasInfo: ParcelaInfo[] = lista.map((p: any, idx: number) => ({
          id: String(p.parcela_id ?? `${p.titulo_id ?? "tit"}-${p.numero_parcela ?? idx}`),
          numero_parcela: p.numero_parcela != null ? Number(p.numero_parcela) : null,
          vencimento: p.vencimento,
          valor: Number(p.valor || 0),
          dias_atraso: p.dias_atraso ?? null,
          status: null,
          is_current: currentParcelaId != null && String(p.parcela_id) === String(currentParcelaId),
          loja_nome: p.ssotica_company_id ? (companiesById.get(String(p.ssotica_company_id)) ?? null) : null,
        }));
        // Ordena por vencimento (mais antiga primeiro)
        parcelasInfo.sort((a, b) =>
          (a.vencimento ?? "") < (b.vencimento ?? "") ? -1 : (a.vencimento ?? "") > (b.vencimento ?? "") ? 1 : 0
        );
        setParcelas(parcelasInfo);
        setLoadingParcelas(false);
        return;
      }
    }

    // Fallback: agrupa cards do mesmo cliente (manual / sem SSótica)
    let query = supabase
      .from("crm_cobrancas")
      .select("id, valor, vencimento, dias_atraso, status, data, ssotica_cliente_id")
      .order("vencimento", { ascending: true });

    if (ssoticaClienteId && ssoticaCompanyId) {
      query = query.eq("ssotica_cliente_id", ssoticaClienteId).eq("ssotica_company_id", ssoticaCompanyId);
    } else if (cpfDigits.length >= 11) {
      query = query.or(`data->>documento.eq.${cpfDigits},data->>cpf.eq.${cpfDigits}`);
    } else if (nome) {
      query = query.eq("data->>nome", nome);
    } else {
      setParcelas([]);
      setLoadingParcelas(false);
      return;
    }

    const { data, error } = await query;
    if (!error && data) {
      const list: ParcelaInfo[] = (data as any[]).map((p: any) => ({
        id: p.id,
        numero_parcela: p.data?.numero_parcela ? Number(p.data.numero_parcela) : null,
        vencimento: p.vencimento,
        valor: Number(p.valor || 0),
        dias_atraso: p.dias_atraso ?? null,
        status: p.status,
        is_current: p.id === cobrancaId,
      }));
      setParcelas(list);
    } else {
      setParcelas([]);
    }
    setLoadingParcelas(false);
  };

  useEffect(() => {
    if (open && cobrancaId) {
      fetchTimeline();
      fetchParcelas();
      setTab("atividade");
      setNewComment("");
      setTaskOpen(false);
      setContactRegisteredInSession(false);
      // Registra abertura do card de cobrança (atualiza dashboard em tempo real)
      if (user?.id) {
        recordCardOpen({
          userId: user.id,
          cardType: "cobranca",
          cobrancaId,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cobrancaId, ssoticaClienteId, ssoticaCompanyId]);

  // Financeiro must register a contact attempt in this session before closing/saving.
  const requiresContactRegistration = isFinanceiro && !isAdmin && !!cobrancaId;
  const canCloseOrSave = !requiresContactRegistration || contactRegisteredInSession;

  const handleSheetOpenChange = (v: boolean) => {
    if (!v && !canCloseOrSave) {
      toast.error("Registre uma tentativa de contato antes de fechar este card.");
      return;
    }
    onOpenChange(v);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    if (!canCloseOrSave) {
      e.preventDefault();
      toast.error("Registre uma tentativa de contato antes de salvar.");
      return;
    }
    onSave(e);
  };

  const timeline = useMemo(() => {
    const items = [
      ...activities.map(a => ({ id: a.id, type: "activity" as const, date: a.scheduled_date, data: a })),
      ...notes.map(n => ({ id: n.id, type: "note" as const, date: n.created_at, data: n })),
    ];
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activities, notes]);

  const handlePostComment = async () => {
    if (!cobrancaId || !newComment.trim() || !user) return;
    setPostingComment(true);
    const { error } = await supabase.from("crm_cobranca_notes").insert({
      cobranca_id: cobrancaId, user_id: user.id, content: newComment.trim(),
    });
    if (error) { toast.error("Erro ao adicionar comentário"); }
    else { setNewComment(""); fetchTimeline(); }
    setPostingComment(false);
  };

  const handleCreateTask = async () => {
    if (!cobrancaId || !taskTitle.trim() || !taskDate || !user) {
      toast.error("Preencha título e data"); return;
    }
    setSavingTask(true);
    const [h, m] = taskTime.split(":").map(Number);
    const dt = new Date(taskDate); dt.setHours(h || 9, m || 0, 0, 0);
    const { error } = await supabase.from("cobranca_activities").insert({
      cobranca_id: cobrancaId, created_by: user.id,
      title: taskTitle.trim(), description: taskDescription.trim() || null,
      scheduled_date: dt.toISOString(),
    });
    if (error) toast.error("Erro ao criar tarefa");
    else {
      toast.success("Tarefa criada");
      setTaskOpen(false); setTaskTitle(""); setTaskDescription(""); setTaskDate(undefined); setTaskTime("09:00");
      fetchTimeline();
    }
    setSavingTask(false);
  };

  const toggleTaskComplete = async (a: Activity) => {
    const newVal = a.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("cobranca_activities")
      .update({ completed_at: newVal }).eq("id", a.id);
    if (error) toast.error("Erro");
    else fetchTimeline();
  };

  const deleteActivity = async (id: string) => {
    const { error } = await supabase.from("cobranca_activities").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir"); else fetchTimeline();
  };

  const deleteNote = async (id: string) => {
    const { error } = await supabase.from("crm_cobranca_notes").delete().eq("id", id);
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
    const { error } = await supabase.from("cobranca_activities").update({
      title: editTaskTitle.trim(),
      description: editTaskDescription.trim() || null,
      scheduled_date: dt.toISOString(),
    }).eq("id", editingTaskId);
    if (error) toast.error("Erro ao atualizar tarefa");
    else {
      toast.success("Tarefa atualizada");
      setEditingTaskId(null);
      fetchTimeline();
    }
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

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[1100px] p-0 flex flex-col sm:flex-row gap-0 overflow-y-auto sm:overflow-hidden"
      >
        {/* LEFT: Form */}
        <div className="w-full sm:w-[420px] sm:border-r border-border flex flex-col bg-card sm:h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-card z-10 sm:static">
            <h2 className="font-semibold text-lg">
              {isEditing ? "Editar Cobrança" : "Nova Cobrança"}
            </h2>
          </div>
          <ScrollArea className="flex-1 max-sm:[&_[data-radix-scroll-area-viewport]]:!overflow-visible max-sm:[&>[data-radix-scroll-area-viewport]]:max-h-none">
            <form onSubmit={handleFormSubmit} id="cobranca-form" className="p-5 space-y-4">
              <div className="space-y-2">
                <Label>Empresa</Label>
                <Select value={formCompanyId} onValueChange={setFormCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Selecionar empresa..." /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Coluna (Status)</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {canReassign && (
                <div className="space-y-2">
                  <Label>Atribuído a</Label>
                  <Select value={formAssigned} onValueChange={setFormAssigned}>
                    <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                    <SelectContent>
                      {profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Nome <span className="text-destructive">*</span></Label>
                <Input value={formData.nome || ""} required
                  onChange={e => setFormData({ ...formData, nome: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={formData.telefone || ""} placeholder="(00) 00000-0000"
                  onChange={e => setFormData({ ...formData, telefone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CPF</Label>
                <Input value={formData.documento || formData.cpf || ""} placeholder="000.000.000-00"
                  onChange={e => setFormData({ ...formData, documento: e.target.value, cpf: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <Input type="number" step="0.01" value={formValor} placeholder="0,00"
                  onChange={e => setFormValor(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea rows={3} value={formData.descricao || ""}
                  onChange={e => setFormData({ ...formData, descricao: e.target.value })} />
              </div>
              {requiresContactRegistration && !contactRegisteredInSession && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Antes de salvar ou fechar este card, registre uma{" "}
                    <strong>tentativa de contato</strong> na aba <strong>Atividade</strong>.
                  </span>
                </div>
              )}
              <Button
                type="submit"
                form="cobranca-form"
                className="w-full"
                disabled={saving || !formData.nome?.trim() || !canCloseOrSave}
                title={!canCloseOrSave ? "Registre uma tentativa de contato antes de salvar" : undefined}
              >
                {saving ? "Salvando..." : isEditing ? "Atualizar" : "Criar"}
              </Button>
            </form>
          </ScrollArea>
        </div>

        {/* RIGHT: Timeline */}
        <div className="flex-1 flex flex-col bg-background min-w-0 sm:h-full border-t sm:border-t-0">
          <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-background z-10 sm:static gap-2 overflow-x-auto">
            <Tabs value={tab} onValueChange={setTab} className="flex-1">
              <TabsList className="bg-transparent">
                <TabsTrigger value="atividade" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">Atividade</TabsTrigger>
                <TabsTrigger value="comentario">Comentário</TabsTrigger>
                <TabsTrigger value="tarefa">Tarefa</TabsTrigger>
                <TabsTrigger value="parcelas" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
                  Parcelas
                  {parcelas.filter(p => (p.dias_atraso ?? 0) > 0).length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500/20 text-red-500 text-[10px] font-bold h-4 min-w-4 px-1">
                      {parcelas.filter(p => (p.dias_atraso ?? 0) > 0).length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="produtos" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">
                  <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                  Produtos
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="ghost" size="icon" onClick={() => handleSheetOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!isEditing ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
              Salve a cobrança primeiro para adicionar comentários e tarefas.
            </div>
          ) : (
            <>
              {/* Comment / Task input bar - hidden on Parcelas / Produtos tabs */}
              {tab !== "parcelas" && tab !== "produtos" && (
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
              )}

              {/* Parcelas content */}
              {tab === "parcelas" && (
                <ScrollArea className="flex-1 max-sm:[&_[data-radix-scroll-area-viewport]]:!overflow-visible max-sm:[&>[data-radix-scroll-area-viewport]]:max-h-none">
                  <div className="p-5 space-y-4">
                    {loadingParcelas ? (
                      <p className="text-center text-sm text-muted-foreground py-12">Carregando parcelas...</p>
                    ) : parcelas.length === 0 ? (
                      <div className="text-center text-sm text-muted-foreground py-12">
                        Nenhuma outra parcela encontrada para este cliente.
                        <br />
                        <span className="text-xs">Cadastre o CPF ou sincronize com o SSótica para agrupar parcelas do mesmo cliente.</span>
                      </div>
                    ) : (
                      <>
                        {/* Summary cards */}
                        {(() => {
                          const atrasadas = parcelas.filter(p => (p.dias_atraso ?? 0) > 0);
                          const totalAtraso = atrasadas.reduce((s, p) => s + p.valor, 0);
                          const totalGeral = parcelas.reduce((s, p) => s + p.valor, 0);
                          return (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                                <div className="text-[10px] uppercase font-bold text-red-500">Em atraso</div>
                                <div className="text-2xl font-bold text-red-500 mt-1">{atrasadas.length}</div>
                                <div className="text-[11px] text-muted-foreground">parcelas</div>
                              </div>
                              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                                <div className="text-[10px] uppercase font-bold text-red-500">Valor atrasado</div>
                                <div className="text-base font-bold text-red-500 mt-1">
                                  R$ {totalAtraso.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="rounded-lg border bg-card p-3">
                                <div className="text-[10px] uppercase font-bold text-muted-foreground">Total cliente</div>
                                <div className="text-base font-bold text-foreground mt-1">
                                  R$ {totalGeral.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                <div className="text-[11px] text-muted-foreground">{parcelas.length} parcela(s)</div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Parcelas list */}
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground uppercase mt-2">Parcelas em atraso</div>
                          {parcelas.filter(p => (p.dias_atraso ?? 0) > 0).length === 0 && (
                            <p className="text-sm text-muted-foreground italic">Nenhuma parcela em atraso.</p>
                          )}
                          {parcelas.filter(p => (p.dias_atraso ?? 0) > 0).map(p => {
                            const venc = formatSafeDate(p.vencimento);
                            return (
                              <div
                                key={p.id}
                                className={cn(
                                  "rounded-lg border p-3 flex items-center justify-between gap-3",
                                  p.is_current ? "border-red-500 bg-red-500/10" : "border-red-500/30 bg-red-500/5"
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-9 w-9 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                                    <Receipt className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                                      Parcela {p.numero_parcela ?? "—"}
                                      {p.is_current && (
                                        <span className="text-[9px] font-bold uppercase bg-red-500 text-white px-1.5 py-0.5 rounded">Atual</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Venceu em {venc} · <span className="text-red-500 font-semibold">{p.dias_atraso} dia(s) em atraso</span>
                                    </div>
                                    {p.loja_nome && (
                                      <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80 mt-0.5">
                                        Loja: {p.loja_nome}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-sm font-bold text-red-500">
                                    R$ {p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {parcelas.filter(p => (p.dias_atraso ?? 0) <= 0).length > 0 && (
                            <>
                              <div className="text-xs font-semibold text-muted-foreground uppercase mt-4">Outras parcelas</div>
                              {parcelas.filter(p => (p.dias_atraso ?? 0) <= 0).map(p => {
                                const venc = formatSafeDate(p.vencimento);
                                return (
                                  <div key={p.id} className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="h-9 w-9 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                                        <Receipt className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="text-sm font-semibold text-foreground">Parcela {p.numero_parcela ?? "—"}</div>
                                        <div className="text-xs text-muted-foreground">Vence em {venc}</div>
                                        {p.loja_nome && (
                                          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80 mt-0.5">
                                            Loja: {p.loja_nome}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-sm font-bold text-foreground">
                                      R$ {p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              )}

              {/* Produtos content */}
              {tab === "produtos" && (
                <ClientProductsTab
                  ssoticaClienteId={ssoticaClienteId ?? null}
                  ssoticaCompanyId={ssoticaCompanyId ?? null}
                  cpf={formData?.documento ?? formData?.cpf ?? null}
                />
              )}

              {/* Timeline */}
              {tab !== "parcelas" && tab !== "produtos" && (
              <ScrollArea className="flex-1 max-sm:[&_[data-radix-scroll-area-viewport]]:!overflow-visible max-sm:[&>[data-radix-scroll-area-viewport]]:max-h-none">
                <div className="p-5 space-y-3">
                  {tab === "atividade" && cobrancaId && user && (
                    <CobrancaContactAttemptForm
                      cobrancaId={cobrancaId}
                      userId={user.id}
                      userName={getProfile(user.id)?.full_name}
                      cobrancaData={formData}
                      onSaved={() => { setContactRegisteredInSession(true); fetchTimeline(); }}
                    />
                  )}
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
                          {/* Timeline dot */}
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
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
