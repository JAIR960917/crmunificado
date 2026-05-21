import { useEffect, useState, useCallback, useMemo } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Phone, UserCheck, CalendarHeart, AlertTriangle, CalendarClock, Clock, CheckCircle2, Shuffle, Loader2, CalendarPlus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPhoneBR } from "@/lib/phoneFormat";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import RenovacaoEditSheet from "@/components/renovacoes/RenovacaoEditSheet";
import ScheduleLeadDialog from "@/components/leads/ScheduleLeadDialog";
import { usePaginatedColumns } from "@/hooks/use-paginated-columns";
import { logTransition } from "@/lib/transitionLogs";

type Renovacao = {
  id: string;
  data: Record<string, any>;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
  valor: number;
  data_ultima_compra: string | null;
  created_at: string;
  updated_at: string;
  ssotica_cliente_id?: number | null;
  ssotica_company_id?: string | null;
};

type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";
type CrmStatus = { id: string; key: string; label: string; position: number; color: string };
type Profile = { user_id: string; full_name: string; avatar_url?: string | null };
type Company = { id: string; name: string };
type UserRole = { user_id: string; role: AppRole };
type RenovacaoActivity = { id: string; renovacao_id: string; title: string; scheduled_date: string; completed_at: string | null };

type FormField = {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
  position: number;
  is_required: boolean;
  is_name_field: boolean;
  is_phone_field: boolean;
  is_last_visit_field: boolean;
  is_cpf_field?: boolean;
  show_on_card: boolean;
  parent_field_id: string | null;
  parent_trigger_value: string | null;
};

const colorMap: Record<string, { header: string; badge: string }> = {
  blue:    { header: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 border-blue-300" },
  amber:   { header: "bg-amber-500",   badge: "bg-amber-500/15 text-amber-700 border-amber-300" },
  violet:  { header: "bg-violet-500",  badge: "bg-violet-500/15 text-violet-700 border-violet-300" },
  cyan:    { header: "bg-cyan-500",    badge: "bg-cyan-500/15 text-cyan-700 border-cyan-300" },
  emerald: { header: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-300" },
  red:     { header: "bg-red-500",     badge: "bg-red-500/15 text-red-700 border-red-300" },
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

const DIRECIONAMENTO_STATUS = "fazer_direcionamento_para_o_vendedor";

const statusKeyForRenovacao = (diasDesdeUltimaCompra: number | null): string => {
  if (diasDesdeUltimaCompra === null) return "novo";
  if (diasDesdeUltimaCompra < 365) return "em_contato";
  if (diasDesdeUltimaCompra < 730) return "agendado";
  if (diasDesdeUltimaCompra < 1095) return "renovado";
  return "mais_de_3_anos";
};

const getRenovacaoFlowStatus = (lastPurchaseDate: unknown): string => {
  const parsedDate = parseStoredDate(lastPurchaseDate);
  if (!parsedDate) return "novo";
  const diasDesdeUltimaCompra = Math.floor((Date.now() - parsedDate.getTime()) / 86400000);
  return statusKeyForRenovacao(diasDesdeUltimaCompra);
};

export default function ActiveClientsPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[] | null>(null); // null = no restriction (admin)
  const [fields, setFields] = useState<FormField[]>([]);
  const [activities, setActivities] = useState<RenovacaoActivity[]>([]);
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Renovacao | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formStatus, setFormStatus] = useState("");
  const [formAssigned, setFormAssigned] = useState("");
  const [formValor, setFormValor] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("all");
  const [filterAssignedTo, setFilterAssignedTo] = useState("all");
  const [mobileTab, setMobileTab] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const confirmBulkDelete = async () => {
    setBulkDeleting(true);
    let q = supabase.from("crm_renovacoes").delete().not("id", "is", null);
    if (filterCompanyId !== "all") q = q.eq("ssotica_company_id", filterCompanyId);
    const { error } = await q;
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (error) toast.error("Erro ao excluir todos");
    else {
      toast.success("Renovações excluídas");
      setRefreshKey((k) => k + 1);
    }
  };
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignConfirm, setAutoAssignConfirm] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulingItem, setSchedulingItem] = useState<Renovacao | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const statusKeys = useMemo(() => statuses.map((s) => s.key), [statuses]);

  // Filter applied to every column query (server-side)
  const columnFilter = useMemo(() => ({
    apply: (q: any) => {
      let res = q;
      if (filterCompanyId !== "all") {
        res = res.eq("ssotica_company_id", filterCompanyId);
      } else if (allowedCompanyIds && allowedCompanyIds.length > 0) {
        res = res.in("ssotica_company_id", allowedCompanyIds);
      }
      if (filterAssignedTo === "__unassigned__") res = res.is("assigned_to", null);
      else if (filterAssignedTo !== "all") res = res.eq("assigned_to", filterAssignedTo);
      return res;
    },
  }), [filterCompanyId, filterAssignedTo, allowedCompanyIds]);

  // ilike search across name/phone in jsonb
  const buildSearchOr = useCallback((q: string) => {
    const safe = q.replace(/[%,()]/g, "");
    if (!safe) return null;
    return `data->>nome.ilike.%${safe}%,data->>telefone.ilike.%${safe}%`;
  }, []);

  const {
    columns: paginatedColumns,
    loadMore,
    refetch,
    updateItemStatus,
    removeItem,
    searchResults,
    searching,
    isSearching,
  } = usePaginatedColumns<Renovacao>({
    table: "crm_renovacoes",
    statusKeys,
    filter: columnFilter,
    searchQuery,
    buildSearchOr,
    refreshKey,
  });

  // Load static data once (statuses, profiles, fields, etc.)
  const loadMeta = useCallback(async () => {
    const [stsRes, profsRes, rolesRes, compsRes, ffRes, actsRes, notesRes] = await Promise.allSettled([
      supabase.from("crm_renovacao_statuses").select("*").order("position"),
      supabase.rpc("get_profile_names"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("crm_renovacao_form_fields").select("*").order("position"),
      supabase.from("renovacao_activities").select("id,renovacao_id,title,scheduled_date,completed_at"),
      supabase.from("crm_renovacao_notes").select("renovacao_id"),
    ]);

    const unwrap = <T,>(result: PromiseSettledResult<{ data: T; error: any }>, label: string, fallback: T): T => {
      if (result.status !== "fulfilled") {
        console.error(`[Renovação] Falha ao carregar ${label}`, result.reason);
        return fallback;
      }
      if (result.value.error) {
        console.error(`[Renovação] Erro ao carregar ${label}`, result.value.error);
        return fallback;
      }
      return (result.value.data ?? fallback) as T;
    };

    const sts = unwrap(stsRes, "status", [] as CrmStatus[]);
    const profs = unwrap(profsRes, "perfis", [] as Profile[]);
    const roles = unwrap(rolesRes, "papéis", [] as UserRole[]);
    const comps = unwrap(compsRes, "empresas", [] as Company[]);
    const ff = unwrap<any[]>(ffRes as PromiseSettledResult<{ data: any[]; error: any }>, "campos do formulário", []);
    const acts = unwrap(actsRes, "atividades", [] as RenovacaoActivity[]);
    const notes = unwrap<any[]>(notesRes as PromiseSettledResult<{ data: any[]; error: any }>, "notas", []);

    setStatuses(sts);
    setProfiles(profs);
    setUserRoles(roles);
    setFields(ff as unknown as FormField[]);
    setActivities(acts);
    setNoteIds(new Set((notes || []).map((n: any) => n.renovacao_id)));

    // For gerente: restrict allowed companies to their own (profile + manager_companies)
    if (isGerente && !isAdmin && user?.id) {
      const [myProfileRes, mgrCompaniesRes] = await Promise.allSettled([
        supabase.from("profiles").select("company_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("manager_companies").select("company_id").eq("user_id", user.id),
      ]);

      const myProfile = myProfileRes.status === "fulfilled" && !myProfileRes.value.error ? myProfileRes.value.data : null;
      const mgrCompanies = mgrCompaniesRes.status === "fulfilled" && !mgrCompaniesRes.value.error ? (mgrCompaniesRes.value.data || []) : [];

      if (myProfileRes.status !== "fulfilled" || myProfileRes.value.error) {
        console.error("[Renovação] Erro ao carregar perfil do gerente", myProfileRes.status === "fulfilled" ? myProfileRes.value.error : myProfileRes.reason);
      }
      if (mgrCompaniesRes.status !== "fulfilled" || mgrCompaniesRes.value.error) {
        console.error("[Renovação] Erro ao carregar empresas do gerente", mgrCompaniesRes.status === "fulfilled" ? mgrCompaniesRes.value.error : mgrCompaniesRes.reason);
      }

      const ids = new Set<string>();
      if (myProfile?.company_id) ids.add(myProfile.company_id);
      (mgrCompanies || []).forEach((m: any) => m?.company_id && ids.add(m.company_id));
      const allowed = Array.from(ids);
      setAllowedCompanyIds(allowed);
      setCompanies((comps || []).filter((c) => allowed.includes(c.id)));
    } else {
      setAllowedCompanyIds(null);
      setCompanies(comps || []);
    }
  }, [isGerente, isAdmin, user?.id]);

  // Count unassigned (server-side)
  const refreshUnassignedCount = useCallback(async () => {
    try {
      let q = supabase
        .from("crm_renovacoes")
        .select("id", { count: "exact", head: true })
        .is("assigned_to", null)
        .not("ssotica_company_id", "is", null);
      if (filterCompanyId !== "all") q = q.eq("ssotica_company_id", filterCompanyId);
      else if (allowedCompanyIds && allowedCompanyIds.length > 0) q = q.in("ssotica_company_id", allowedCompanyIds);
      const { count, error } = await q;
      if (error) throw error;
      setUnassignedCount(count || 0);
    } catch (error) {
      console.error("[Renovação] Erro ao contar cards sem responsável", error);
      setUnassignedCount(0);
    }
  }, [filterCompanyId, allowedCompanyIds]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { refreshUnassignedCount(); }, [refreshUnassignedCount, refreshKey]);

  useEffect(() => {
    if (statuses.length > 0 && !mobileTab) setMobileTab(statuses[0].key);
  }, [statuses, mobileTab]);

  const statusOptions = statuses.map(s => s.key);
  const vendedorIds = useMemo(
    () => new Set(userRoles.filter((entry) => entry.role === "vendedor").map((entry) => entry.user_id)),
    [userRoles],
  );
  const nameField = useMemo(() => fields.find(f => f.is_name_field), [fields]);
  const phoneField = useMemo(() => fields.find(f => f.is_phone_field), [fields]);
  const lastVisitField = useMemo(() => fields.find(f => f.is_last_visit_field), [fields]);
  const cpfField = useMemo(
    () => fields.find(f => f.is_cpf_field) || fields.find(f => /cpf/i.test(f.label)),
    [fields],
  );

  const runAutoAssign = async () => {
    setAutoAssigning(true);
    try {
      const body: any = {};
      if (filterCompanyId !== "all") body.company_id = filterCompanyId;
      const { data, error } = await supabase.functions.invoke("auto-assign-renovacoes", { body });
      if (error) throw error;
      const total = (data as any)?.total_assigned ?? 0;
      toast.success(`${total} lead${total !== 1 ? "s" : ""} distribuído${total !== 1 ? "s" : ""} entre os vendedores`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao distribuir leads");
    } finally {
      setAutoAssigning(false);
      setAutoAssignConfirm(false);
    }
  };

  const openCreate = (status?: string) => {
    setEditingItem(null);
    setFormData({});
    setFormStatus(status || statusOptions[0] || "novo");
    setFormAssigned("");
    setFormValor("");
    setDialogOpen(true);
  };

  const openEdit = (item: Renovacao) => {
    setEditingItem(item);
    const initial: Record<string, any> = typeof item.data === "object" && item.data ? { ...item.data } : {};
    if (nameField && !initial[`field_${nameField.id}`] && initial.nome) initial[`field_${nameField.id}`] = initial.nome;
    if (phoneField && !initial[`field_${phoneField.id}`] && initial.telefone) initial[`field_${phoneField.id}`] = initial.telefone;
    if (cpfField && !initial[`field_${cpfField.id}`] && (initial.documento || initial.cpf)) {
      initial[`field_${cpfField.id}`] = initial.documento || initial.cpf;
    }
    if (lastVisitField && item.data_ultima_compra) {
      initial[`field_${lastVisitField.id}`] = item.data_ultima_compra;
    }
    setFormData(initial);
    setFormStatus(item.status);
    setFormAssigned(item.assigned_to || "");
    setFormValor(String(item.valor || ""));
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const valor = parseFloat(formValor) || 0;
    const dataToSave: Record<string, any> = { ...formData };
    if (nameField) dataToSave.nome = formData[`field_${nameField.id}`] || "";
    if (phoneField) dataToSave.telefone = formData[`field_${phoneField.id}`] || "";
    const lastVisitValue = lastVisitField ? formData[`field_${lastVisitField.id}`] : null;
    const assignedTo = formAssigned || null;
    const hasAssignedUser = !!assignedTo;
    const flowStatus = getRenovacaoFlowStatus(lastVisitValue || editingItem?.data_ultima_compra || null);

    let resolvedStatus = formStatus;
    if (!hasAssignedUser) {
      resolvedStatus = DIRECIONAMENTO_STATUS;
    } else if (formStatus === DIRECIONAMENTO_STATUS || editingItem?.status === DIRECIONAMENTO_STATUS) {
      resolvedStatus = flowStatus;
    }

    const payload: any = {
      data: dataToSave,
      status: resolvedStatus,
      assigned_to: assignedTo,
      valor,
      data_ultima_compra: lastVisitValue || null,
    };

    if (editingItem) {
      const { error } = await supabase.from("crm_renovacoes").update(payload).eq("id", editingItem.id);
      if (error) toast.error("Erro ao atualizar"); else toast.success("Renovação atualizada");
    } else {
      const { data: created, error } = await supabase
        .from("crm_renovacoes")
        .insert({ ...payload, created_by: user?.id })
        .select()
        .single();
      if (error) toast.error("Erro ao criar renovação");
      else {
        toast.success("Renovação criada");
        const statusLabel = statuses.find((s) => s.key === resolvedStatus)?.label ?? resolvedStatus;
        await logTransition({
          cliente_nome: String((dataToSave as any)?.nome ?? "Cliente"),
          from_module: "none",
          to_module: "renovacao",
          to_status_key: resolvedStatus,
          to_status_label: statusLabel,
          target_record_id: (created as any)?.id ?? null,
          triggered_by: user?.id ?? null,
          trigger_source: "manual",
        });
      }
    }
    setSaving(false);
    setDialogOpen(false);
    setRefreshKey((k) => k + 1);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    let snapshot: Renovacao | null = null;
    for (const k of Object.keys(paginatedColumns)) {
      const found = paginatedColumns[k]?.items.find((it) => it.id === deleteConfirmId);
      if (found) { snapshot = found as Renovacao; break; }
    }
    const { error } = await supabase.from("crm_renovacoes").delete().eq("id", deleteConfirmId);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Renovação excluída");
      const statusLabel = statuses.find((s) => s.key === snapshot?.status)?.label ?? snapshot?.status ?? null;
      await logTransition({
        cliente_nome: String((snapshot?.data as any)?.nome ?? "Cliente"),
        from_module: "renovacao",
        to_module: "none",
        to_status_key: snapshot?.status ?? null,
        to_status_label: statusLabel,
        source_record_id: deleteConfirmId,
        ssotica_cliente_id: snapshot?.ssotica_cliente_id ?? null,
        company_id: snapshot?.ssotica_company_id ?? null,
        triggered_by: user?.id ?? null,
        trigger_source: "manual",
      });
    }
    removeItem(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  const openScheduleDialog = (item: Renovacao) => {
    setSchedulingItem(item);
    setScheduleOpen(true);
  };

  const handleScheduleSubmit = async (schedData: { scheduled_datetime: string; valor: number; forma_pagamento: string; canal_agendamento: string }) => {
    if (!schedulingItem || !user) return;
    setScheduleSaving(true);
    const d = (schedulingItem.data || {}) as Record<string, any>;
    const nome = String(d.nome || "Cliente");
    const telefone = String(d.telefone || "");
    const { error } = await supabase.from("crm_appointments").insert({
      lead_id: null,
      renovacao_id: schedulingItem.id,
      scheduled_by: user.id,
      scheduled_datetime: schedData.scheduled_datetime,
      valor: schedData.valor,
      forma_pagamento: schedData.forma_pagamento,
      canal_agendamento: schedData.canal_agendamento,
      previous_status: schedulingItem.status,
      nome,
      telefone,
      idade: "",
    } as any);
    if (error) {
      toast.error("Erro ao agendar");
      setScheduleSaving(false);
      return;
    }
    const { error: updErr } = await supabase
      .from("crm_renovacoes")
      .update({ status: "agendado" } as any)
      .eq("id", schedulingItem.id);
    if (updErr) toast.error("Agendamento criado, mas falhou ao mover para Agendados");
    else toast.success("Renovação agendada com sucesso!");
    setScheduleSaving(false);
    setScheduleOpen(false);
    setSchedulingItem(null);
    setRefreshKey((k) => k + 1);
  };


  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const itemId = result.draggableId;
    const fromStatus = result.source.droppableId;
    if (newStatus === fromStatus) return;

    // Apenas administradores podem mover renovações manualmente entre colunas.
    if (!isAdmin) {
      toast.error("Apenas administradores podem mover renovações entre colunas.");
      return;
    }

    // find item in source column or search results
    const fromCol = paginatedColumns[fromStatus];
    const currentItem = fromCol?.items.find((it) => it.id === itemId)
      || (searchResults || []).find((it) => it.id === itemId);
    if (!currentItem) return;

    const hasAssignedUser = !!currentItem.assigned_to;
    let resolvedStatus = newStatus;

    if (!hasAssignedUser) {
      resolvedStatus = DIRECIONAMENTO_STATUS;
      if (newStatus !== DIRECIONAMENTO_STATUS) {
        toast.info("Cards sem responsável ficam em 'Fazer direcionamento para o vendedor'.");
      }
    } else if (newStatus === DIRECIONAMENTO_STATUS) {
      resolvedStatus = getRenovacaoFlowStatus(currentItem.data_ultima_compra);
    }

    updateItemStatus(itemId, fromStatus, resolvedStatus, currentItem);
    await supabase.from("crm_renovacoes").update({ status: resolvedStatus }).eq("id", itemId);
  };

  const getProfileName = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || "") : "";

  // Compute task priority per renovacao: 3=overdue, 2=today, 1=future pending, 0=none
  const renovacaoTaskPriority = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    const todayStr = now.toDateString();
    activities.forEach((a) => {
      if (a.completed_at) return;
      const dt = new Date(a.scheduled_date);
      let prio = 1;
      if (dt < now) prio = 3;
      else if (dt.toDateString() === todayStr) prio = 2;
      const current = map.get(a.renovacao_id) || 0;
      if (prio > current) map.set(a.renovacao_id, prio);
    });
    return map;
  }, [activities]);

  // Renovacoes with recent interaction (completed task or notes) — go to the END when no pending task
  const renovacoesWithRecentActivity = useMemo(() => {
    const ids = new Set<string>();
    activities.filter(a => a.completed_at).forEach(a => ids.add(a.renovacao_id));
    noteIds.forEach(id => ids.add(id));
    return ids;
  }, [activities, noteIds]);

  const sortByTaskPriority = useCallback((items: Renovacao[]) => {
    return [...items].sort((a, b) => {
      // 1) Pending task always dominates: cards with pending tasks go to the TOP
      const aPrio = renovacaoTaskPriority.get(a.id) || 0;
      const bPrio = renovacaoTaskPriority.get(b.id) || 0;
      if (aPrio !== bPrio) return bPrio - aPrio;
      // 2) When no pending task, cards with recent interaction go to the END
      const aHasRecent = renovacoesWithRecentActivity.has(a.id) ? 1 : 0;
      const bHasRecent = renovacoesWithRecentActivity.has(b.id) ? 1 : 0;
      return aHasRecent - bHasRecent;
    });
  }, [renovacaoTaskPriority, renovacoesWithRecentActivity]);

  // Build per-status item list (paginated or filtered from search)
  const getByStatus = useCallback((key: string): { items: Renovacao[]; total: number; hasMore: boolean; loading: boolean } => {
    if (isSearching) {
      const filtered = (searchResults || []).filter((r) => r.status === key);
      return { items: sortByTaskPriority(filtered), total: filtered.length, hasMore: false, loading: searching };
    }
    const col = paginatedColumns[key];
    const items = col?.items || [];
    return {
      items: sortByTaskPriority(items),
      total: col?.total || 0,
      hasMore: col?.hasMore || false,
      loading: col?.loading || false,
    };
  }, [paginatedColumns, isSearching, searchResults, searching, sortByTaskPriority]);

  const totalDisplayed = useMemo(() => {
    if (isSearching) return searchResults?.length || 0;
    return Object.values(paginatedColumns).reduce((acc, col) => acc + col.total, 0);
  }, [paginatedColumns, isSearching, searchResults]);

  const handleColumnScroll = (e: React.UIEvent<HTMLDivElement>, statusKey: string) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore(statusKey);
  };

  const renderCard = (item: Renovacao) => {
    const d = item.data as Record<string, any>;
    const lastVisit = item.data_ultima_compra
      ? parseStoredDate(item.data_ultima_compra)
      : (lastVisitField ? parseStoredDate(d[`field_${lastVisitField.id}`]) : undefined);

    const cardFields = fields.filter(f => f.show_on_card && !f.is_name_field && !f.is_phone_field && !f.is_last_visit_field);

    const itemActivities = activities.filter(a => a.renovacao_id === item.id);
    const pending = itemActivities.filter(a => !a.completed_at);
    const overdue = pending.filter(a => new Date(a.scheduled_date) < new Date());
    const today = pending.filter(a => {
      const dt = new Date(a.scheduled_date);
      const now = new Date();
      return dt.toDateString() === now.toDateString() && dt >= now;
    });
    const hasOverdue = overdue.length > 0;
    const hasToday = today.length > 0;
    const hasPending = pending.length > 0 && !hasOverdue && !hasToday;

    let cardBorderClass = "";
    if (hasOverdue) cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
    else if (hasToday) cardBorderClass = "border-amber-400 bg-amber-500/5";
    else if (hasPending) cardBorderClass = "border-blue-400/50 bg-blue-500/5";

    const nextActivity = [...pending].sort(
      (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
    )[0];

    return (
      <div className={`bg-card border rounded-xl p-3 space-y-2 shadow-sm ${cardBorderClass}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{d.nome || "Sem nome"}</p>
            {/* Telefone removido para forçar abertura do lead na edição */}
          </div>
          {Number(item.valor || 0) > 0 && (
            <Badge variant="outline" className="text-xs shrink-0">
              R$ {Number(item.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </Badge>
          )}
        </div>

        {lastVisit && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 border border-primary/30">
            <CalendarHeart className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase font-bold text-primary leading-none">Última receita</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{format(lastVisit, "dd/MM/yyyy", { locale: ptBR })}</p>
            </div>
          </div>
        )}

        {cardFields.map(f => {
          const v = d[`field_${f.id}`];
          if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
          const display = Array.isArray(v) ? v.join(", ") : (f.field_type === "date" ? (parseStoredDate(v) ? format(parseStoredDate(v)!, "dd/MM/yyyy", { locale: ptBR }) : String(v)) : String(v));
          return (
            <div key={f.id} className="text-xs">
              <span className="text-muted-foreground">{f.label}: </span>
              <span className="font-medium">{display}</span>
            </div>
          );
        })}

        {item.assigned_to && (() => {
          const ap = profiles.find(p => p.user_id === item.assigned_to);
          if (!ap) return null;
          return (
            <div className="pt-1">
              <p className="text-[11px] text-muted-foreground leading-tight">Pessoa responsável</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Avatar className="h-5 w-5 text-[9px]">
                  <AvatarImage src={ap.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-[9px]">
                    {(ap.full_name || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium text-foreground truncate">{ap.full_name}</span>
              </div>
            </div>
          );
        })()}

        <div className="pt-2 border-t">
          {hasOverdue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-red-500 px-2 py-0.5 rounded-full uppercase">
              <AlertTriangle className="h-3 w-3" />Atrasada
            </span>
          )}
          {hasToday && !hasOverdue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
              <CalendarClock className="h-3 w-3" />Hoje
            </span>
          )}
          {hasPending && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
              <Clock className="h-3 w-3" />Pendente
            </span>
          )}
          {!hasOverdue && !hasToday && !hasPending && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded-full uppercase">
              <CheckCircle2 className="h-3 w-3" />Em dia
            </span>
          )}

          {nextActivity && (
            <div className={`text-xs mt-1.5 ${hasOverdue ? "text-red-600" : hasToday ? "text-amber-600" : "text-muted-foreground"}`}>
              <p className="font-medium truncate">{nextActivity.title}</p>
              <p className="text-[10px]">
                {(() => {
                  try { return format(new Date(nextActivity.scheduled_date), "dd/MM 'às' HH:mm", { locale: ptBR }); }
                  catch { return ""; }
                })()}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-1 justify-end pt-1">
          {item.status !== "agendado" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
              title="Agendar"
              onClick={() => openScheduleDialog(item)}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
            <Pencil className="h-3 w-3" />
          </Button>
          {(isAdmin || isGerente) && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteConfirmId(item.id)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Renovação</h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {totalDisplayed} registro{totalDisplayed !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(isAdmin || isGerente) && companies.length > 1 && (
            <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
              <SelectTrigger className="h-9 w-full sm:w-56">
                <SelectValue placeholder="Filtrar por empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isGerente && !isAdmin ? "Minhas empresas" : "Todas as empresas"}</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name.trim()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(isAdmin || isGerente) && profiles.length > 0 && (
            <Select value={filterAssignedTo} onValueChange={setFilterAssignedTo}>
              <SelectTrigger className="h-9 w-full sm:w-56">
                <SelectValue placeholder="Filtrar por vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                <SelectItem value="__unassigned__">— Sem responsável —</SelectItem>
                {[...profiles]
                  .filter(p => p.full_name?.trim() && (isAdmin || vendedorIds.has(p.user_id)))
                  .sort((a, b) => a.full_name.localeCompare(b.full_name))
                  .map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
          {(isAdmin || isGerente) && unassignedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAutoAssignConfirm(true)}
              disabled={autoAssigning}
              className="border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              {autoAssigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />}
              Distribuir {unassignedCount} sem responsável
            </Button>
          )}
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-9 w-full sm:w-48" />
          </div>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" />Nova Renovação
          </Button>
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />Excluir todos
            </Button>
          )}
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="lg:hidden mb-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {statuses.map(status => {
            const { total } = getByStatus(status.key);
            const colors = colorMap[status.color] || colorMap.blue;
            return (
              <button key={status.key} onClick={() => setMobileTab(status.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  mobileTab === status.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                <div className={`h-2 w-2 rounded-full ${colors.header}`} />
                {status.label}
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  mobileTab === status.key ? "bg-primary-foreground/20 text-primary-foreground" : colors.badge
                }`}>{total}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:hidden space-y-2 mb-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}
           onScroll={(e) => mobileTab && handleColumnScroll(e, mobileTab)}>
        {statuses.filter(s => s.key === mobileTab).map(status => {
          const { items, total, hasMore, loading } = getByStatus(status.key);
          return (
            <div key={status.key}>
              {items.length === 0 && !loading && <p className="text-center text-sm text-muted-foreground py-8">Nenhuma renovação nesta coluna</p>}
              {items.map(r => <div key={r.id} className="mb-2">{renderCard(r)}</div>)}
              {hasMore && (
                <button
                  onClick={() => loadMore(status.key)}
                  disabled={loading}
                  className="w-full py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg border border-dashed border-primary/40 transition-colors mb-2"
                >
                  {loading ? "Carregando..." : `Carregar mais (${total - items.length} restantes)`}
                </button>
              )}
              <button onClick={() => openCreate(status.key)} className="w-full py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors">
                + Adicionar renovação
              </button>
            </div>
          );
        })}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="hidden lg:flex gap-3 overflow-x-auto pb-4" style={{ height: "calc(100vh - 200px)" }}>
          {statuses.map(status => {
            const { items, total, hasMore, loading } = getByStatus(status.key);
            const colors = colorMap[status.color] || colorMap.blue;
            return (
              <div key={status.key} className="flex-shrink-0 w-[280px] flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 px-1 flex-shrink-0">
                  <div className={`h-2.5 w-2.5 rounded-full ${colors.header}`} />
                  <h3 className="font-semibold text-sm text-foreground">{status.label}</h3>
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>{total}</span>
                </div>
                <Droppable droppableId={status.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      onScroll={(e) => handleColumnScroll(e, status.key)}
                      className={`flex-1 rounded-xl p-2 space-y-2 transition-colors overflow-y-auto min-h-0 ${
                        snapshot.isDraggingOver ? "bg-primary/5 border-2 border-dashed border-primary/30" : "bg-muted/50 border border-transparent"
                      }`}
                    >
                      {items.map((r, index) => (
                        <Draggable key={r.id} draggableId={r.id} index={index}>
                          {(provided, snapshot) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                              className={snapshot.isDragging ? "opacity-90 rotate-2" : ""}>
                              {renderCard(r)}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {loading && items.length === 0 && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {hasMore && (
                        <button
                          onClick={() => loadMore(status.key)}
                          disabled={loading}
                          className="w-full py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg border border-dashed border-primary/40 transition-colors"
                        >
                          {loading ? "Carregando..." : `Carregar mais (${total - items.length} restantes)`}
                        </button>
                      )}
                      <button onClick={() => openCreate(status.key)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors">
                        + Adicionar renovação
                      </button>
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <RenovacaoEditSheet
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) loadMeta(); }}
        renovacaoId={editingItem?.id || null}
        formData={formData}
        setFormData={setFormData}
        formStatus={formStatus}
        setFormStatus={setFormStatus}
        formAssigned={formAssigned}
        setFormAssigned={setFormAssigned}
        formValor={formValor}
        setFormValor={setFormValor}
        statuses={statuses}
        profiles={profiles}
        fields={fields}
        saving={saving}
        onSave={handleSave}
        canReassign={isAdmin || isGerente}
        ssoticaClienteId={editingItem?.ssotica_cliente_id ?? null}
        ssoticaCompanyId={editingItem?.ssotica_company_id ?? null}
      />

      <ScheduleLeadDialog
        open={scheduleOpen}
        onOpenChange={(open) => { setScheduleOpen(open); if (!open) setSchedulingItem(null); }}
        leadName={String((schedulingItem?.data as any)?.nome || "")}
        leadPhone={String((schedulingItem?.data as any)?.telefone || "")}
        saving={scheduleSaving}
        onSubmit={handleScheduleSubmit}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={open => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir renovação permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={autoAssignConfirm} onOpenChange={open => !autoAssigning && setAutoAssignConfirm(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Distribuir {unassignedCount} lead{unassignedCount !== 1 ? "s" : ""} sem responsável?</AlertDialogTitle>
            <AlertDialogDescription>
              Os leads serão divididos em partes iguais (round-robin) entre os vendedores ativos de cada loja.
              {filterCompanyId !== "all" ? " Apenas a loja filtrada será afetada." : " Todas as lojas serão processadas."}
              {" "}Daqui pra frente, novos leads vindos do SSótica também recebem vendedor automaticamente quando não houver mapeamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={autoAssigning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runAutoAssign} disabled={autoAssigning}>
              {autoAssigning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Distribuindo...</> : "Distribuir agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !bulkDeleting && setBulkDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir TODAS as renovações?</AlertDialogTitle>
            <AlertDialogDescription>
              {filterCompanyId === "all"
                ? "Todos os cards de renovação de todas as empresas serão removidos permanentemente."
                : "Todos os cards de renovação da empresa filtrada serão removidos permanentemente."}
              {" "}Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Excluindo...</> : "Excluir todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
