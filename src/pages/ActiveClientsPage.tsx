import { useEffect, useState, useCallback, useMemo } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, Pencil, Trash2, Phone, UserCheck, CalendarHeart, AlertTriangle, CalendarClock, Clock, CheckCircle2, Shuffle, Loader2, CalendarPlus, RotateCcw, ArrowRightLeft, Store } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPhoneBR } from "@/lib/phoneFormat";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import RenovacaoEditSheet from "@/components/renovacoes/RenovacaoEditSheet";
import ScheduleLeadDialog from "@/components/leads/ScheduleLeadDialog";
import { usePaginatedColumns } from "@/hooks/use-paginated-columns";
import { useVisibleStatusKeys } from "@/hooks/use-visible-status-keys";
import { formatVisualAcuityDisplay } from "@/lib/visualAcuity";
import { logTransition } from "@/lib/transitionLogs";
import { sortKanbanByExamAndTratativa } from "@/lib/kanbanCardSort";
import { resolveCanalFromLeadData, logAppointmentHistory } from "@/lib/appointmentUtils";
import BulkTransferDialog from "@/components/crm/BulkTransferDialog";
import RenovacaoOutraOticaDialog from "@/components/renovacoes/RenovacaoOutraOticaDialog";
import {
  DIRECIONAMENTO_STATUS,
  getOutraOticaFields,
  getRenovacaoExamTimestampFromItem,
  getRenovacaoFlowStatusFromItem,
  mergeOutraOticaIntoData,
  RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS,
} from "@/lib/renovacaoFlow";
import { syncRenovacaoOutraOticaFollowup } from "@/lib/renovacaoOutraOticaSave";
import { isOpenCobrancaStatus } from "@/lib/cobrancaStatus";

type Renovacao = {
  id: string;
  data: Record<string, any>;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
  valor: number;
  data_ultima_compra: string | null;
  renovou_outra_otica?: boolean;
  data_exame_outra_otica?: string | null;
  created_at: string;
  updated_at: string;
  ssotica_cliente_id?: number | null;
  ssotica_company_id?: string | null;
};

type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";
type CrmStatus = { id: string; key: string; label: string; position: number; color: string; is_system_excluded?: boolean };
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

export default function ActiveClientsPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[] | null>(null); // null = no restriction (admin)
  const [assignableUserIds, setAssignableUserIds] = useState<Set<string> | null>(null); // null = no restriction (admin)
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
  const [restoreItem, setRestoreItem] = useState<Renovacao | null>(null);
  const [restoreAssignee, setRestoreAssignee] = useState<string>("");
  const [restoring, setRestoring] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [outraOticaItem, setOutraOticaItem] = useState<Renovacao | null>(null);

  const confirmBulkDelete = async () => {
    setBulkDeleting(true);
    setBulkDeleteOpen(false);
    try {
      // Exclui em lotes de 500 para evitar timeout em tabelas grandes
      let deleted = 0;
      while (true) {
        let idQ = supabase.from("crm_renovacoes").select("id").limit(500);
        if (filterCompanyId !== "all") idQ = idQ.eq("ssotica_company_id", filterCompanyId);
        const { data: batch, error: selErr } = await idQ;
        if (selErr) throw selErr;
        if (!batch || batch.length === 0) break;
        const ids = batch.map((r: { id: string }) => r.id);
        const { error: delErr } = await supabase.from("crm_renovacoes").delete().in("id", ids);
        if (delErr) throw delErr;
        deleted += ids.length;
        if (ids.length < 500) break;
      }
      toast.success(`${deleted} renovação(ões) excluída(s)`);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast.error("Erro ao excluir", { description: err?.message ?? String(err) });
    } finally {
      setBulkDeleting(false);
    }
  };
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignConfirm, setAutoAssignConfirm] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [metaReady, setMetaReady] = useState(false);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulingItem, setSchedulingItem] = useState<Renovacao | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const { isVisible: isStatusVisible } = useVisibleStatusKeys("renovacao");
  const visibleStatuses = useMemo(
    () => statuses.filter((s) => isStatusVisible(s.key, s.is_system_excluded)),
    [statuses, isStatusVisible],
  );
  const statusKeys = useMemo(() => visibleStatuses.map((s) => s.key), [visibleStatuses]);

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
    const digits = safe.replace(/\D/g, "");
    const parts = [
      `data->>nome.ilike.%${safe}%`,
      `data->>telefone.ilike.%${safe}%`,
    ];
    // telefone_digits é uma coluna gerada (somente dígitos) — necessária
    // porque o telefone no JSONB tem formatação variada (ex.: "(84) 9.2000-7039")
    // e o ilike não consegue normalizar isso a partir de uma expressão JSON.
    if (digits) parts.push(`telefone_digits.ilike.%${digits}%`);
    return parts.join(",");
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
    pollingIntervalMs: 30000,
    select: "id,data,status,assigned_to,created_by,valor,data_ultima_compra,created_at,updated_at,ssotica_cliente_id,ssotica_company_id",
  });

  const loadActivityMeta = useCallback(async () => {
    setActivitiesLoading(true);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const [actsRes, notesRes] = await Promise.allSettled([
      supabase
        .from("renovacao_activities")
        .select("id,renovacao_id,title,scheduled_date,completed_at")
        .or(`completed_at.is.null,completed_at.gte.${cutoff.toISOString()}`),
      supabase.from("crm_renovacao_notes").select("renovacao_id"),
    ]);

    const unwrap = <T,>(result: PromiseSettledResult<{ data: T; error: unknown }>, fallback: T): T => {
      if (result.status !== "fulfilled" || result.value.error) return fallback;
      return (result.value.data ?? fallback) as T;
    };

    setActivities(unwrap(actsRes as PromiseSettledResult<{ data: RenovacaoActivity[]; error: unknown }>, []));
    const notes = unwrap(notesRes as PromiseSettledResult<{ data: { renovacao_id: string }[]; error: unknown }>, []);
    setNoteIds(new Set(notes.map((n) => n.renovacao_id)));
    setActivitiesLoading(false);
  }, []);

  // Metadados essenciais primeiro; atividades/notas em segundo plano (não bloqueiam o kanban).
  const loadMeta = useCallback(async () => {
    setMetaReady(false);
    const [stsRes, profsRes, rolesRes, compsRes, ffRes] = await Promise.allSettled([
      supabase.from("crm_renovacao_statuses").select("*").order("position"),
      supabase.rpc("get_profile_names"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("crm_renovacao_form_fields").select("*").order("position"),
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

    const rawSts = unwrap(stsRes, "status", [] as CrmStatus[]);
    // Deduplica por key (pode haver duplicatas na tabela caso a migration rode mais de uma vez)
    const seenSts = new Set<string>();
    const sts = rawSts.filter((s) => { if (seenSts.has(s.key)) return false; seenSts.add(s.key); return true; });
    const profs = unwrap(profsRes, "perfis", [] as Profile[]);
    const roles = unwrap(rolesRes, "papéis", [] as UserRole[]);
    const comps = unwrap(compsRes, "empresas", [] as Company[]);
    const ff = unwrap<any[]>(ffRes as PromiseSettledResult<{ data: any[]; error: any }>, "campos do formulário", []);

    setStatuses(sts);
    setProfiles(profs);
    setUserRoles(roles);
    setFields(ff as unknown as FormField[]);

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

      // Restrict assignable users to those whose primary company belongs to the gerente's allowed companies
      if (allowed.length > 0) {
        const { data: companyProfiles } = await supabase
          .from("profiles")
          .select("user_id, company_id")
          .in("company_id", allowed);
        setAssignableUserIds(new Set((companyProfiles || []).map((p: any) => p.user_id)));
      } else {
        setAssignableUserIds(new Set());
      }
    } else {
      setAllowedCompanyIds(null);
      setCompanies(comps || []);
      setAssignableUserIds(null);
    }
    setMetaReady(true);
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
  useEffect(() => {
    if (!metaReady) return;
    void loadActivityMeta();
  }, [refreshKey, metaReady, loadActivityMeta]);
  useEffect(() => { refreshUnassignedCount(); }, [refreshUnassignedCount, refreshKey]);

  useEffect(() => {
    if (visibleStatuses.length > 0 && !mobileTab) setMobileTab(visibleStatuses[0].key);
  }, [visibleStatuses, mobileTab]);

  const statusOptions = statuses.map(s => s.key);
  const vendedorIds = useMemo(
    () => new Set(userRoles.filter((entry) => entry.role === "vendedor").map((entry) => entry.user_id)),
    [userRoles],
  );
  const assignableProfiles = useMemo(
    () => profiles.filter(p => p.full_name?.trim() && (isAdmin || vendedorIds.has(p.user_id)) && (assignableUserIds === null || assignableUserIds.has(p.user_id))),
    [profiles, isAdmin, vendedorIds, assignableUserIds],
  );

  const bulkTransferSourceProfiles = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    if (isAdmin) return profiles.filter((p) => p.full_name?.trim());
    const companyUsers = profiles.filter(
      (p) => p.full_name?.trim() && (assignableUserIds === null || assignableUserIds.has(p.user_id)),
    );
    const me = profiles.find((p) => p.user_id === user?.id);
    if (me?.full_name?.trim() && !companyUsers.some((p) => p.user_id === me.user_id)) {
      return [...companyUsers, me];
    }
    return companyUsers;
  }, [profiles, isAdmin, isGerente, assignableUserIds, user?.id]);

  const bulkTransferDestProfiles = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    if (isAdmin) return profiles.filter((p) => p.full_name?.trim());
    return assignableProfiles;
  }, [profiles, isAdmin, isGerente, assignableProfiles]);
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
      const fixed = (data as any)?.total_flow_fixed ?? 0;
      const parts: string[] = [];
      if (total > 0) parts.push(`${total} lead${total !== 1 ? "s" : ""} distribuído${total !== 1 ? "s" : ""}`);
      if (fixed > 0) parts.push(`${fixed} movido${fixed !== 1 ? "s" : ""} para o fluxo normal`);
      toast.success(parts.length > 0 ? parts.join("; ") : "Nenhum lead pendente de distribuição ou correção");
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
    const outraOtica = getOutraOticaFields(item);
    initial.renovou_outra_otica = outraOtica.renovou;
    initial.data_exame_outra_otica = outraOtica.dataExame || "";
    setFormData(initial);
    setFormStatus(item.status);
    setFormAssigned(item.assigned_to || "");
    setFormValor(String(item.valor || ""));
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const renovouOutra = !!formData.renovou_outra_otica;
    const outraDateRaw = formData.data_exame_outra_otica
      ? String(formData.data_exame_outra_otica).trim()
      : "";
    const outraDateStr = renovouOutra && outraDateRaw ? outraDateRaw : null;

    if (renovouOutra && !outraDateStr) {
      toast.error("Informe a data do último exame na outra ótica.");
      return;
    }

    setSaving(true);
    const valor = parseFloat(formValor) || 0;
    const dataToSave: Record<string, any> = mergeOutraOticaIntoData(
      { ...formData },
      renovouOutra,
      outraDateStr,
    );
    if (nameField) dataToSave.nome = formData[`field_${nameField.id}`] || "";
    if (phoneField) dataToSave.telefone = formData[`field_${phoneField.id}`] || "";
    const lastVisitValue = lastVisitField
      ? (formData[`field_${lastVisitField.id}`] ?? editingItem?.data_ultima_compra ?? null)
      : null;
    const assignedTo = formAssigned || null;
    const hasAssignedUser = !!assignedTo;

    const flowItem = {
      ...editingItem,
      data: dataToSave,
      renovou_outra_otica: renovouOutra,
      data_exame_outra_otica: outraDateStr,
      data_ultima_compra: lastVisitValue || editingItem?.data_ultima_compra || null,
      assigned_to: assignedTo,
    };
    const flowStatus = getRenovacaoFlowStatusFromItem(flowItem, lastVisitField);

    let resolvedStatus = formStatus;
    if (!hasAssignedUser) {
      resolvedStatus = DIRECIONAMENTO_STATUS;
    } else if (
      formStatus === DIRECIONAMENTO_STATUS
      || editingItem?.status === DIRECIONAMENTO_STATUS
      || (editingItem && renovouOutra && outraDateStr && editingItem.status !== "excluidos")
    ) {
      resolvedStatus = flowStatus;
    }

    const payload: any = {
      data: dataToSave,
      status: resolvedStatus,
      assigned_to: assignedTo,
      valor,
      data_ultima_compra: lastVisitValue || null,
      renovou_outra_otica: renovouOutra,
      data_exame_outra_otica: outraDateStr,
    };

    const prevOutra = editingItem ? getOutraOticaFields(editingItem) : { renovou: false, dataExame: null };
    const clientName = String(dataToSave.nome || (editingItem?.data as Record<string, unknown>)?.nome || "");

    if (editingItem) {
      const { error } = await supabase.from("crm_renovacoes").update(payload).eq("id", editingItem.id);
      if (error) {
        toast.error("Erro ao atualizar");
      } else {
        try {
          await syncRenovacaoOutraOticaFollowup({
            renovacaoId: editingItem.id,
            renovou: renovouOutra,
            examDate: outraDateStr ? parseStoredDate(outraDateStr) ?? null : null,
            dateStr: outraDateStr,
            previousRenovou: prevOutra.renovou,
            previousDateStr: prevOutra.dataExame,
            userId: user?.id,
            clientName,
          });
        } catch {
          toast.error("Salvo, mas falhou ao criar tarefa de retorno");
        }
        toast.success("Renovação atualizada");
      }
    } else {
      const phoneForCheck = String(dataToSave.telefone ?? "").trim();
      if (phoneForCheck) {
        const { data: cobMatch } = await supabase.rpc("find_cobranca_by_phone", { p_phone: phoneForCheck });
        const cob = Array.isArray(cobMatch) ? cobMatch[0] : cobMatch;
        if (cob && isOpenCobrancaStatus(cob.status)) {
          toast.error("Este cliente já está na Cobrança (dívida em aberto). Atenda-o na tela de Cobranças.");
          setSaving(false);
          return;
        }
      }

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
    // Soft-delete: move para coluna "Excluídos"
    const { error } = await supabase.rpc("soft_delete_renovacao", { _renovacao_id: deleteConfirmId });
    if (error) toast.error("Erro ao excluir");
    else {
      const myName = profiles.find((p) => p.user_id === user?.id)?.full_name || "usuário";
      await supabase.from("crm_renovacao_notes").insert({
        renovacao_id: deleteConfirmId,
        user_id: user!.id,
        content: `🗑️ Card excluído por ${myName}`,
      } as any);
      toast.success("Renovação movida para Excluídos");
      await logTransition({
        cliente_nome: String((snapshot?.data as any)?.nome ?? "Cliente"),
        from_module: "renovacao",
        to_module: "none",
        to_status_key: snapshot?.status ?? null,
        to_status_label: statuses.find((s) => s.key === snapshot?.status)?.label ?? null,
        source_record_id: deleteConfirmId,
        ssotica_cliente_id: snapshot?.ssotica_cliente_id ?? null,
        company_id: snapshot?.ssotica_company_id ?? null,
        triggered_by: user?.id ?? null,
        trigger_source: "manual",
      });
      removeItem(deleteConfirmId);
      setRefreshKey((k) => k + 1);
    }
    setDeleteConfirmId(null);
  };

  const confirmRestore = async () => {
    if (!restoreItem || !restoreAssignee) {
      toast.error("Selecione um responsável");
      return;
    }
    setRestoring(true);
    const previous = (restoreItem as any).previous_status_before_exclude as string | null;
    const newStatus = previous && previous !== "excluidos" ? previous : "novo";
    const { error } = await supabase.from("crm_renovacoes").update({
      status: newStatus,
      assigned_to: restoreAssignee,
      excluded_at: null,
      excluded_by: null,
      previous_status_before_exclude: null,
      previous_assigned_before_exclude: null,
    } as any).eq("id", restoreItem.id);
    if (error) {
      toast.error("Erro ao restaurar");
    } else {
      const myName = profiles.find((p) => p.user_id === user?.id)?.full_name || "admin";
      const assigneeName = profiles.find((p) => p.user_id === restoreAssignee)?.full_name || "responsável";
      await supabase.from("crm_renovacao_notes").insert({
        renovacao_id: restoreItem.id,
        user_id: user!.id,
        content: `♻️ Card restaurado por ${myName} e atribuído a ${assigneeName}`,
      } as any);
      toast.success("Renovação restaurada");
      setRefreshKey((k) => k + 1);
    }
    setRestoring(false);
    setRestoreItem(null);
    setRestoreAssignee("");
  };


  const openScheduleDialog = (item: Renovacao) => {
    setSchedulingItem(item);
    setScheduleOpen(true);
  };

  const handleScheduleSubmit = async (schedData: {
    scheduled_datetime: string;
    forma_pagamento: string;
    forma_pagamento_oculos: string;
    canal_agendamento: string;
    consulta_paga: boolean;
    consulta_paga_no_agendamento: boolean;
  }) => {
    if (!schedulingItem || !user) return;
    setScheduleSaving(true);
    const d = (schedulingItem.data || {}) as Record<string, any>;
    const nome = String(d.nome || "Cliente");
    const telefone = String(d.telefone || "");
    const nowIso = new Date().toISOString();
    const userName = profiles.find((p) => p.user_id === user.id)?.full_name || "Usuário";
    const { data: newAppt, error } = await supabase.from("crm_appointments").insert({
      lead_id: null,
      renovacao_id: schedulingItem.id,
      scheduled_by: user.id,
      scheduled_datetime: schedData.scheduled_datetime,
      valor: 0,
      forma_pagamento: schedData.forma_pagamento,
      forma_pagamento_oculos: schedData.forma_pagamento_oculos,
      canal_agendamento: schedData.canal_agendamento,
      consulta_paga: schedData.consulta_paga,
      consulta_paga_no_agendamento: schedData.consulta_paga_no_agendamento,
      consulta_paga_em: schedData.consulta_paga ? nowIso : null,
      consulta_paga_por: schedData.consulta_paga ? user.id : null,
      previous_status: schedulingItem.status,
      nome,
      telefone,
      idade: "",
    } as any).select("id").single();
    if (error) {
      toast.error("Erro ao agendar");
      setScheduleSaving(false);
      return;
    }
    if (newAppt?.id) {
      await logAppointmentHistory(newAppt.id, user.id, "created", `${userName} agendou consulta para ${nome}`);
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
      resolvedStatus = getRenovacaoFlowStatusFromItem(currentItem as Renovacao, lastVisitField);
    }

    updateItemStatus(itemId, fromStatus, resolvedStatus, currentItem);
    await supabase.from("crm_renovacoes").update({ status: resolvedStatus }).eq("id", itemId);
  };

  const getProfileName = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || "") : "";

  // Compute task priority per renovacao: 3=overdue, 2=today, 1=future pending, 0=none
  const activitiesByRenovacao = useMemo(() => {
    const map = new Map<string, RenovacaoActivity[]>();
    activities.forEach((a) => {
      const list = map.get(a.renovacao_id);
      if (list) list.push(a);
      else map.set(a.renovacao_id, [a]);
    });
    return map;
  }, [activities]);

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

  const sortRenovacoesInColumn = useCallback(
    (items: Renovacao[]) =>
      sortKanbanByExamAndTratativa(items, {
        getExamTs: (item) => getRenovacaoExamTimestampFromItem(item, lastVisitField),
        taskPriority: renovacaoTaskPriority,
        requireTratativaStatusMatch: true,
      }),
    [lastVisitField, renovacaoTaskPriority],
  );

  // Build per-status item list (paginated or filtered from search)
  const getByStatus = useCallback((key: string): { items: Renovacao[]; total: number; hasMore: boolean; loading: boolean } => {
    if (isSearching) {
      const filtered = (searchResults || []).filter((r) => r.status === key);
      return { items: sortRenovacoesInColumn(filtered), total: filtered.length, hasMore: false, loading: searching };
    }
    const col = paginatedColumns[key];
    const items = col?.items || [];
    return {
      items: sortRenovacoesInColumn(items),
      total: col?.total || 0,
      hasMore: col?.hasMore || false,
      loading: col?.loading || false,
    };
  }, [paginatedColumns, isSearching, searchResults, searching, sortRenovacoesInColumn]);

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
    const { renovou: renovouOutraOtica, dataExame: outraOticaRaw } = getOutraOticaFields(item);
    const outraOticaDate = renovouOutraOtica && outraOticaRaw
      ? parseStoredDate(outraOticaRaw)
      : undefined;
    const lastVisit = outraOticaDate
      ?? (item.data_ultima_compra
        ? parseStoredDate(item.data_ultima_compra)
        : (lastVisitField ? parseStoredDate(d[`field_${lastVisitField.id}`]) : undefined));

    const cardFields = fields.filter(f => f.show_on_card && !f.is_name_field && !f.is_phone_field && !f.is_last_visit_field);

    const itemActivities = activitiesByRenovacao.get(item.id) || [];
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

    const tratativaAtendeu = (d?.tratativa_atendeu as string | undefined) || null;

    let cardBorderClass = "";
    if (hasOverdue) cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
    else if (hasToday) cardBorderClass = "border-amber-400 bg-amber-500/5";
    else if (hasPending) cardBorderClass = "border-blue-400/50 bg-blue-500/5";
    else if (tratativaAtendeu === "sim") cardBorderClass = "border-emerald-500 bg-emerald-500/10 shadow-emerald-500/20 shadow-md";

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
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${outraOticaDate ? "bg-amber-500/10 border-amber-500/40" : "bg-primary/10 border-primary/30"}`}>
            {outraOticaDate ? (
              <Store className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            ) : (
              <CalendarHeart className="h-3.5 w-3.5 text-primary shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-[10px] uppercase font-bold leading-none ${outraOticaDate ? "text-amber-700 dark:text-amber-300" : "text-primary"}`}>
                {outraOticaDate ? "Exame outra ótica" : "Última receita"}
              </p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{format(lastVisit, "dd/MM/yyyy", { locale: ptBR })}</p>
              {outraOticaDate && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Retorno em {RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS} dias
                </p>
              )}
            </div>
          </div>
        )}

        {cardFields.map(f => {
          const v = d[`field_${f.id}`];
          if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
          const display = f.field_type === "visual_acuity"
            ? formatVisualAcuityDisplay(v)
            : Array.isArray(v)
              ? v.join(", ")
              : f.field_type === "date"
                ? (parseStoredDate(v) ? format(parseStoredDate(v)!, "dd/MM/yyyy", { locale: ptBR }) : String(v))
                : String(v);
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
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${renovouOutraOtica ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}
            title="Renovou em outra ótica"
            onClick={() => setOutraOticaItem(item)}
          >
            <Store className="h-3.5 w-3.5" />
          </Button>
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
          {isAdmin && item.status === "excluidos" && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Restaurar / Atribuir" onClick={() => { setRestoreItem(item); setRestoreAssignee(item.assigned_to || ""); }}>
              <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Excluir card" onClick={() => setDeleteConfirmId(item.id)}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
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
          {(isAdmin || isGerente) && assignableProfiles.length > 0 && (
            <Select value={filterAssignedTo} onValueChange={setFilterAssignedTo}>
              <SelectTrigger className="h-9 w-full sm:w-56">
                <SelectValue placeholder="Filtrar por vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                <SelectItem value="__unassigned__">— Sem responsável —</SelectItem>
                {[...assignableProfiles]
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
            <Input placeholder="Buscar por nome ou telefone..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-9 w-full sm:w-48" />
          </div>
          {(isAdmin || isGerente) && (
            <Button size="sm" variant="outline" onClick={() => setBulkTransferOpen(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />Transferir
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />Excluir todos
            </Button>
          )}
        </div>
      </div>

      {!metaReady ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Carregando renovações...</span>
        </div>
      ) : (
        <>
      {activitiesLoading && (
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Atualizando prioridades das tarefas…
        </p>
      )}

      {/* Mobile tabs */}
      <div className="lg:hidden mb-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {visibleStatuses.map(status => {
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
        {visibleStatuses.filter(s => s.key === mobileTab).map(status => {
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
          {visibleStatuses.map(status => {
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
        </>
      )}


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
        profiles={assignableProfiles}
        fields={fields}
        saving={saving}
        onSave={handleSave}
        onCardUpdated={() => setRefreshKey((k) => k + 1)}
        canReassign={isAdmin || isGerente}
        ssoticaClienteId={editingItem?.ssotica_cliente_id ?? null}
        ssoticaCompanyId={editingItem?.ssotica_company_id ?? null}
      />

      <ScheduleLeadDialog
        open={scheduleOpen}
        onOpenChange={(open) => { setScheduleOpen(open); if (!open) setSchedulingItem(null); }}
        leadName={String((schedulingItem?.data as any)?.nome || "")}
        leadPhone={String((schedulingItem?.data as any)?.telefone || "")}
        canalAgendamento={
          schedulingItem
            ? resolveCanalFromLeadData((schedulingItem.data || {}) as Record<string, unknown>)
            : "Ligação Renovação"
        }
        companyId={schedulingItem?.ssotica_company_id ?? null}
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

      <AlertDialog open={!!restoreItem} onOpenChange={(open) => !open && setRestoreItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar renovação excluída</AlertDialogTitle>
            <AlertDialogDescription>
              Atribua um responsável. O card voltará ao fluxo normal na coluna anterior à exclusão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Select value={restoreAssignee} onValueChange={setRestoreAssignee}>
              <SelectTrigger><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
              <SelectContent>
                {assignableProfiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmRestore(); }} disabled={restoring || !restoreAssignee}>
              {restoring ? "Restaurando..." : "Restaurar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {outraOticaItem && (
        <RenovacaoOutraOticaDialog
          open={!!outraOticaItem}
          onOpenChange={(open) => { if (!open) setOutraOticaItem(null); }}
          item={outraOticaItem}
          clientName={String((outraOticaItem.data as Record<string, unknown>)?.nome || "")}
          userId={user?.id}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {(isAdmin || isGerente) && (
        <BulkTransferDialog
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          module="renovacoes"
          entityLabel="renovações"
          sourceProfiles={bulkTransferSourceProfiles}
          destProfiles={bulkTransferDestProfiles}
          companyId={filterCompanyId}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </AppLayout>
  );
}
