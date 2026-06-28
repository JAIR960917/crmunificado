import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { syncOfflineQueue, getOfflineQueue } from "@/lib/offlineSync";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, Filter, X, Search, ArrowRightLeft, Users, Copy, Trash2, Loader2, MoreVertical, FolderInput } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import LeadCard from "@/components/leads/LeadCard";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import ScheduleLeadDialog from "@/components/leads/ScheduleLeadDialog";
import LeadHistoryDialog from "@/components/leads/LeadHistoryDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { usePaginatedColumns } from "@/hooks/use-paginated-columns";
import { useVisibleStatusKeys } from "@/hooks/use-visible-status-keys";
import { normalizeLeadData, resolveLeadIdentity } from "@/lib/leadIdentity";
import { resolveCanalFromLeadData, fetchActiveAppointedLeadIds, logAppointmentHistory } from "@/lib/appointmentUtils";
import { getLeadExamTimestamp, sortKanbanByExamAndTratativa } from "@/lib/kanbanCardSort";
import BulkTransferDialog from "@/components/crm/BulkTransferDialog";
import AllocateUnassignedDialog from "@/components/crm/AllocateUnassignedDialog";

type CrmColumn = {
  id: string; name: string; field_key: string; field_type: string;
  options: any; position: number; is_required: boolean;
};
type Lead = {
  id: string; data: Record<string, any>; assigned_to: string | null;
  created_by: string; status: string; created_at: string;
  scheduled_date?: string | null; comprou?: boolean;
};
type Profile = { user_id: string; full_name: string; email?: string; avatar_url?: string | null; company_id?: string | null };
type UserRole = { user_id: string; role: string };
type CrmStatus = {
  id: string; key: string; label: string; position: number; color: string; is_system_excluded?: boolean;
};
type Company = { id: string; name: string };
type FormFieldInfo = { id: string; label: string; field_type?: string; position?: number; is_name_field: boolean; is_phone_field: boolean; show_on_card?: boolean; parent_field_id?: string | null; parent_trigger_value?: string | null; status_mapping?: Record<string, string> | null; date_status_ranges?: { ranges: { max_years: number; status_key: string }[]; above_all: string; no_answer: string } | null };
type LeadActivity = { id: string; lead_id: string; title: string; scheduled_date: string; completed_at: string | null };

const colorMap: Record<string, { header: string; badge: string }> = {
  blue:    { header: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 border-blue-300" },
  amber:   { header: "bg-amber-500",   badge: "bg-amber-500/15 text-amber-700 border-amber-300" },
  violet:  { header: "bg-violet-500",  badge: "bg-violet-500/15 text-violet-700 border-violet-300" },
  cyan:    { header: "bg-cyan-500",    badge: "bg-cyan-500/15 text-cyan-700 border-cyan-300" },
  emerald: { header: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-300" },
  red:     { header: "bg-red-500",     badge: "bg-red-500/15 text-red-700 border-red-300" },
};

export default function LeadsPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [columns, setColumns] = useState<CrmColumn[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([]);
  const [currentUserName, setCurrentUserName] = useState("");
  const [open, setOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formStatus, setFormStatus] = useState("novo");
  const [formAssigned, setFormAssigned] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLeadId, setHistoryLeadId] = useState<string | null>(null);
  const [historyLeadName, setHistoryLeadName] = useState("");
  const [deleteConfirmLead, setDeleteConfirmLead] = useState<Lead | null>(null);
  const [restoreLead, setRestoreLead] = useState<Lead | null>(null);
  const [restoreAssignee, setRestoreAssignee] = useState<string>("");
  const [restoring, setRestoring] = useState(false);
  // Mobile: active tab for status columns
  const [mobileTab, setMobileTab] = useState<string>("");

  // Offline sync tracking
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [recentlySyncedIds, setRecentlySyncedIds] = useState<Set<string>>(new Set());
  const [offlineLeads, setOfflineLeads] = useState<Lead[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters (admin/gerente only)
  const [filterVendedor, setFilterVendedor] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>();
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [fullProfiles, setFullProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [assignableUserIds, setAssignableUserIds] = useState<Set<string> | null>(null);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [allocateUnassignedOpen, setAllocateUnassignedOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulingLead, setSchedulingLead] = useState<Lead | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [appointedLeadIds, setAppointedLeadIds] = useState<Set<string>>(new Set());
  const [leadActivities, setLeadActivities] = useState<LeadActivity[]>([]);
  const [leadNoteIds, setLeadNoteIds] = useState<Set<string>>(new Set());

  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadFromCache = useCallback(() => {
    try {
      setColumns(JSON.parse(localStorage.getItem("crm_cache_columns") || "[]"));
      setProfiles(JSON.parse(localStorage.getItem("crm_cache_profiles") || "[]"));
      setStatuses(JSON.parse(localStorage.getItem("crm_cache_statuses_full") || "[]"));
      setCompanies(JSON.parse(localStorage.getItem("crm_cache_companies") || "[]"));
      setFormFields(JSON.parse(localStorage.getItem("crm_cache_formfields") || "[]"));
      setCurrentUserName(localStorage.getItem("crm_cache_username") || "");
    } catch {}
  }, []);

  // -------- Paginated columns (50 leads/coluna sob demanda) --------
  const { isVisible: isStatusVisible } = useVisibleStatusKeys("leads");
  const visibleStatuses = useMemo(
    () => statuses.filter((s) => isStatusVisible(s.key, s.is_system_excluded)),
    [statuses, isStatusVisible],
  );
  const statusKeys = useMemo(() => visibleStatuses.map(s => s.key), [visibleStatuses]);


  // User IDs belonging to the selected company (used to filter leads by company for gerente)
  const filterCompanyUserIds = useMemo(() => {
    if (filterCompany === "all") return null;
    const ids = fullProfiles.filter((p) => p.company_id === filterCompany).map((p) => p.user_id);
    return ids;
  }, [filterCompany, fullProfiles]);

  const columnFilter = useMemo(() => ({
    apply: (q: any, statusKey?: string) => {
      let res = q;
      if (
        (isAdmin || isGerente)
        && filterVendedor === "__unassigned__"
        && statusKey !== "excluidos"
      ) {
        res = res.is("assigned_to", null);
      } else if (
        (isAdmin || isGerente)
        && filterVendedor
        && filterVendedor !== "all"
        && statusKey !== "excluidos"
      ) {
        res = res.eq("assigned_to", filterVendedor);
      } else if (
        filterCompanyUserIds !== null
        && filterVendedor === "all"
        && statusKey !== "excluidos"
      ) {
        if (filterCompanyUserIds.length === 0) {
          res = res.eq("assigned_to", "00000000-0000-0000-0000-000000000000");
        } else {
          res = res.in("assigned_to", filterCompanyUserIds);
        }
      }
      if (filterDateFrom) {
        const from = new Date(filterDateFrom); from.setHours(0, 0, 0, 0);
        res = res.gte("created_at", from.toISOString());
      }
      if (filterDateTo) {
        const to = new Date(filterDateTo); to.setHours(23, 59, 59, 999);
        res = res.lte("created_at", to.toISOString());
      }
      return res;
    },
  }), [isAdmin, isGerente, filterVendedor, filterCompanyUserIds, filterDateFrom, filterDateTo]);

  const buildSearchOr = useCallback((q: string) => {
    const safe = q.replace(/[%,()]/g, "");
    if (!safe) return null;
    const digits = safe.replace(/\D/g, "");
    const parts = [
      `data->>nome_lead.ilike.%${safe}%`,
      `data->>telefone.ilike.%${safe}%`,
    ];
    if (digits) parts.push(`data->>telefone.ilike.%${digits}%`);
    formFields.filter(f => f.is_name_field).forEach(f => parts.push(`data->>field_${f.id}.ilike.%${safe}%`));
    formFields.filter(f => f.is_phone_field).forEach(f => {
      parts.push(`data->>field_${f.id}.ilike.%${safe}%`);
      if (digits) parts.push(`data->>field_${f.id}.ilike.%${digits}%`);
    });
    return parts.join(",");
  }, [formFields]);

  const {
    columns: paginatedColumns,
    loadMore,
    updateItemStatus,
    patchItem,
    removeItem: removePaginatedItem,
    searchResults,
    searching,
    isSearching,
  } = usePaginatedColumns<Lead>({
    table: "crm_leads",
    statusKeys,
    filter: columnFilter,
    searchQuery,
    buildSearchOr,
    refreshKey,
    orderColumn: "updated_at",
    orderAscending: false,
    pollingIntervalMs: 30000,
  });

  const handleColumnScroll = (statusKey: string, e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore(statusKey);
  };

  // Carrega APENAS metadados (colunas/status/perfis/etc). Os leads em si são
  // carregados sob demanda, 50 por coluna, via usePaginatedColumns — assim a
  // tela abre instantânea mesmo com milhares de leads.
  const fetchAll = async () => {
    if (!navigator.onLine) {
      loadFromCache();
      return;
    }

    try {
      const [{ data: cols }, { data: profs }, { data: sts }, { data: myProfile }, { data: managerCos }, { data: ff }, { data: ffFull }, { data: fullProfs }, { data: rolesData }] = await Promise.all([
        supabase.from("crm_columns").select("*").order("position"),
        supabase.rpc("get_profile_names"),
        supabase.from("crm_statuses").select("*").order("position"),
        supabase.from("profiles").select("company_id").eq("user_id", user!.id).maybeSingle(),
        supabase.from("manager_companies").select("company_id").eq("user_id", user!.id),
        supabase.from("crm_form_fields").select("id, label, field_type, position, is_name_field, is_phone_field, show_on_card, parent_field_id, parent_trigger_value, status_mapping, date_status_ranges").order("position"),
        supabase.from("crm_form_fields").select("*").order("position"),
        supabase.from("profiles").select("user_id, full_name, avatar_url, company_id"),
        supabase.from("user_roles").select("user_id, role"),
      ]);

      setColumns(cols || []);
      const companyMap = new Map((fullProfs || []).map((p: any) => [p.user_id, p.company_id]));
      const enrichedProfiles = (profs || []).map((p: any) => ({ ...p, company_id: companyMap.get(p.user_id) || null }));
      setProfiles(enrichedProfiles);
      setStatuses((sts || []) as CrmStatus[]);
      let allowedCompanies: Company[] = [];
      if (isAdmin) {
        const { data: allCompanies } = await supabase.from("companies").select("id, name").order("name");
        allowedCompanies = (allCompanies || []) as Company[];
      } else {
        const companyIds = new Set<string>();
        if (myProfile?.company_id) companyIds.add(myProfile.company_id);
        (managerCos || []).forEach((mc: any) => mc.company_id && companyIds.add(mc.company_id));
        if (companyIds.size > 0) {
          const { data: filteredCompanies } = await supabase
            .from("companies")
            .select("id, name")
            .in("id", Array.from(companyIds))
            .order("name");
          allowedCompanies = (filteredCompanies || []) as Company[];
        }
      }
      setCompanies(allowedCompanies);
      if (isAdmin) {
        setAssignableUserIds(null);
      } else if (isGerente) {
        const companyIds = new Set<string>();
        if (myProfile?.company_id) companyIds.add(myProfile.company_id);
        (managerCos || []).forEach((mc: { company_id?: string }) => mc.company_id && companyIds.add(mc.company_id));
        if (companyIds.size > 0) {
          setAssignableUserIds(
            new Set(
              (fullProfs || [])
                .filter((p: Profile) => p.company_id && companyIds.has(p.company_id))
                .map((p: Profile) => p.user_id),
            ),
          );
        } else {
          setAssignableUserIds(new Set());
        }
      } else {
        setAssignableUserIds(new Set());
      }
      const loadedFields = (ff || []) as unknown as FormFieldInfo[];
      setFormFields(loadedFields);
      const me = (profs || []).find((p: Profile) => p.user_id === user?.id);
      setCurrentUserName(me?.full_name || user?.email || "");
      setFullProfiles((fullProfs || []) as Profile[]);
      setUserRoles((rolesData || []) as UserRole[]);

      // Cache for offline
      try {
        localStorage.setItem("crm_cache_columns", JSON.stringify(cols || []));
        localStorage.setItem("crm_cache_profiles", JSON.stringify(profs || []));
        localStorage.setItem("crm_cache_statuses_full", JSON.stringify(sts || []));
        localStorage.setItem("crm_cache_companies", JSON.stringify(allowedCompanies || []));
        localStorage.setItem("crm_cache_formfields", JSON.stringify(ff || []));
        localStorage.setItem("crm_cache_fields", JSON.stringify(ffFull || []));
        localStorage.setItem("crm_cache_statuses", JSON.stringify(sts || []));
        const me2 = (profs || []).find((p: Profile) => p.user_id === user?.id);
        localStorage.setItem("crm_cache_username", me2?.full_name || user?.email || "");
      } catch {}

      // Fetch secondary data separately (won't break leads display if it fails)
      try {
        const [appointedIds, actRes, noteRes] = await Promise.all([
          fetchActiveAppointedLeadIds(),
          supabase.from("lead_activities").select("id, lead_id, title, scheduled_date, completed_at"),
          supabase.from("crm_lead_notes").select("lead_id"),
        ]);
        setAppointedLeadIds(appointedIds);
        setLeadActivities((actRes.data || []) as LeadActivity[]);
        setLeadNoteIds(new Set((noteRes.data || []).map((n: { lead_id: string }) => n.lead_id)));
      } catch {
        // Secondary data failed, leads still visible
      }
    } catch {
      // Network failed, load from cache as fallback
      loadFromCache();
    }
  };

  const trySyncOffline = useCallback(async () => {
    if (!navigator.onLine) return;
    const queue = getOfflineQueue();
    if (queue.length === 0) return;
    const syncedIds = await syncOfflineQueue();
    if (syncedIds.length > 0) {
      setRecentlySyncedIds(new Set(syncedIds));
      toast.success(`${syncedIds.length} lead(s) sincronizado(s)!`);
      setTimeout(() => setRecentlySyncedIds(new Set()), 5000);
    }
    // Update offline ids with remaining queue
    const remaining = getOfflineQueue();
    setOfflineIds(new Set(remaining.map(l => l.id)));
    setRefreshKey((k) => k + 1);
    await fetchAll();
  }, []);

  // Merge offline leads into the leads list
  const mergeOfflineLeads = useCallback(() => {
    const queue = getOfflineQueue();
    const queueIds = new Set(queue.map(l => l.id));
    setOfflineIds(queueIds);
    setOfflineLeads(queue.map(l => ({
      id: l.id,
      data: l.data,
      assigned_to: l.assigned_to,
      created_by: l.created_by,
      status: l.status,
      created_at: l.created_at,
    })) as Lead[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      await fetchAll();
      mergeOfflineLeads();
      // Try to sync any pending offline leads on page load
      await trySyncOffline();
    };
    init();
  }, []);

  // Sync offline queue when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      await trySyncOffline();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [trySyncOffline]);

  // Periodically try to sync offline queue (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      const queue = getOfflineQueue();
      if (queue.length > 0 && navigator.onLine) {
        trySyncOffline();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [trySyncOffline]);

  // Set default mobile tab when statuses load
  useEffect(() => {
    if (visibleStatuses.length > 0 && !mobileTab) {
      setMobileTab(visibleStatuses[0].key);
    }
  }, [visibleStatuses, mobileTab]);

  // Derive labels and options from DB statuses
  const statusOptions = statuses.map(s => s.key);
  const statusLabels = Object.fromEntries(statuses.map(s => [s.key, s.label]));

  const openCreate = (status?: string) => {
    setEditingLead(null);
    setFormData({});
    setFormStatus(status || statusOptions[0] || "novo");
    setFormAssigned("");
    setOpen(true);
  };

  const openEdit = (lead: Lead) => {
    setEditingLead(lead);
    setFormData(typeof lead.data === "object" ? lead.data : {});
    setFormStatus(lead.status);
    setFormAssigned(lead.assigned_to || "");
    setOpen(true);
  };

  // Abre automaticamente o lead se houver ?edit=<id> na URL
  // (vindo da tela de novo lead quando há cadastro duplicado).
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    (async () => {
      const { data } = await supabase
        .from("crm_leads")
        .select("id, data, status, assigned_to, created_by, created_at, scheduled_date, comprou")
        .eq("id", editId)
        .maybeSingle();
      if (data) openEdit(data as Lead);
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      setSearchParams(next, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("edit")]);

  const resolveStatus = (
    data: Record<string, any>,
    excludeStatuses: string[] = [],
    options: { skipStatusMapping?: boolean } = {},
  ): string => {
    const defaultStatus = statuses.length > 0 ? statuses[0].key : formStatus;
    const excludeSet = new Set(excludeStatuses);

    // Reúne TODAS as perguntas com regra (data ou opção) e processa por ordem do formulário.
    const ruleFields = formFields
      .filter(f => {
        // Em modo edição, ignoramos completamente os mapeamentos por opção
        // (ex.: "Forma de captação" → Recomendação). Esses mapeamentos só
        // valem na criação do lead — depois disso o lead deve seguir o fluxo
        // normal e não voltar para a coluna original.
        if (options.skipStatusMapping && f.status_mapping && Object.keys(f.status_mapping).length > 0) {
          return !!f.date_status_ranges;
        }
        return (
          f.date_status_ranges ||
          (f.status_mapping && Object.keys(f.status_mapping).length > 0)
        );
      })
      // Pula campos cujo status_mapping aponta para a coluna atual — assim um lead
      // que entrou em "Recomendação" via "Forma de captação" não fica preso lá
      // depois que outras regras (ex.: data do último exame) já se aplicam.
      .filter(f => {
        if (excludeSet.size === 0) return true;
        if (!f.status_mapping) return true;
        return !Object.values(f.status_mapping).some((v: any) => excludeSet.has(v));
      })
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    if (ruleFields.length === 0) return formStatus;

    // Pass 1: respostas efetivamente preenchidas
    for (const f of ruleFields) {
      const fieldKey = `field_${f.id}`;
      const answer = data[fieldKey];
      const hasAnswer = !(answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0));

      if (f.date_status_ranges) {
        if (!hasAnswer) continue;
        const config = f.date_status_ranges;
        const diffMs = Date.now() - new Date(answer as string).getTime();
        const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
        const sortedRanges = [...config.ranges].sort((a, b) => a.max_years - b.max_years);
        for (const range of sortedRanges) {
          if (diffYears <= range.max_years && range.status_key) return range.status_key;
        }
        if (config.above_all) return config.above_all;
        continue;
      }

      if (f.status_mapping && Object.keys(f.status_mapping).length > 0) {
        if (!hasAnswer) continue;
        const mapping = f.status_mapping;
        if (typeof answer === "string" && mapping[answer]) return mapping[answer];
        if (Array.isArray(answer)) {
          for (const v of answer) {
            if (mapping[v]) return mapping[v];
          }
        }
        if (mapping["__any__"]) return mapping["__any__"];
      }
    }

    // Pass 2: fallback "no_answer" da primeira data sem resposta
    for (const f of ruleFields) {
      if (f.date_status_ranges) {
        const fieldKey = `field_${f.id}`;
        const answer = data[fieldKey];
        const hasAnswer = !(answer === undefined || answer === null || (typeof answer === "string" && !answer.trim()));
        if (!hasAnswer && f.date_status_ranges.no_answer) {
          return f.date_status_ranges.no_answer;
        }
      }
    }

    return defaultStatus;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const assignmentUnchanged =
      !!editingLead && (formAssigned || "") === (editingLead.assigned_to || "");
    if (
      isGerente &&
      !isAdmin &&
      formAssigned &&
      !assignmentUnchanged &&
      !assignableProfiles.some((p) => p.user_id === formAssigned)
    ) {
      toast.error("Você só pode atribuir leads aos vendedores da sua loja.");
      return;
    }
    setSaving(true);
    if (editingLead) {
      const isExcluded = editingLead.status === "excluidos";
      // Recalcula apenas via date_status_ranges; mapeamentos por opção (forma
      // de captação) só valem na criação. Leads excluídos permanecem na coluna.
      const hasDateRangeField = formFields.some(f => !!f.date_status_ranges);
      const finalStatus = isExcluded
        ? "excluidos"
        : hasDateRangeField
          ? resolveStatus(formData, [editingLead.status], { skipStatusMapping: true })
          : formStatus;
      const { error } = await supabase.from("crm_leads").update({
        data: formData, status: finalStatus, assigned_to: formAssigned || null,
      }).eq("id", editingLead.id);
      if (error) toast.error("Erro ao atualizar");
      else {
        toast.success("Lead atualizado");
        patchItem(editingLead.id, {
          data: formData,
          status: finalStatus,
          assigned_to: formAssigned || null,
        } as Partial<Lead>);
        setRefreshKey((k) => k + 1);
      }
    } else {
      const resolvedStatus = resolveStatus(formData);

      // Extract name and phone from form data for duplicate check
      const nameFieldIds = formFields.filter(f => f.is_name_field).map(f => f.id);
      const phoneFieldIds = formFields.filter(f => f.is_phone_field).map(f => f.id);
      const leadName = nameFieldIds.reduce<string | null>((found, id) => found || formData[`field_${id}`] || null, null) || formData.nome_lead || "";
      const leadPhone = phoneFieldIds.reduce<string | null>((found, id) => found || formData[`field_${id}`] || null, null) || formData.telefone || "";

      let existingLead: Lead | null = null;
      if (leadName && leadPhone) {
        // Server-side duplicate check (fast — não carrega todos os leads)
        const safeName = String(leadName).replace(/[%,()]/g, "");
        const safePhone = String(leadPhone).replace(/\D/g, "");
        const orParts: string[] = [];
        // tenta achar pelo telefone (mais confiável); inclui colunas dinâmicas via field_id
        if (safePhone) {
          phoneFieldIds.forEach(id => orParts.push(`data->>field_${id}.ilike.%${safePhone.slice(-8)}%`));
          orParts.push(`data->>telefone.ilike.%${safePhone.slice(-8)}%`);
        }
        if (orParts.length > 0) {
          const { data: candidates } = await supabase
            .from("crm_leads")
            .select("id, data, status, assigned_to, created_by, created_at")
            .or(orParts.join(","))
            .limit(50);
          existingLead = (candidates as any[] | null)?.find(l => {
            const d = typeof l.data === "object" ? (l.data as Record<string, any>) : {};
            const eName = nameFieldIds.reduce<string | null>((f, id) => f || d[`field_${id}`] || null, null) || d.nome_lead || "";
            const ePhone = phoneFieldIds.reduce<string | null>((f, id) => f || d[`field_${id}`] || null, null) || d.telefone || "";
            return String(eName).trim().toLowerCase() === String(leadName).trim().toLowerCase()
              && String(ePhone).replace(/\D/g, "") === safePhone;
          }) as Lead | undefined ?? null;
        }
      }

      if (existingLead) {
        const { error } = await supabase.from("crm_leads").update({
          data: formData, status: resolvedStatus, assigned_to: formAssigned || null,
        }).eq("id", existingLead.id);
        if (error) toast.error("Erro ao atualizar lead existente");
        else toast.success("Lead já existia — informações atualizadas!");
      } else {
        const { error } = await supabase.from("crm_leads").insert({
          data: formData, status: resolvedStatus,
          assigned_to: formAssigned || null, created_by: user!.id,
        });
        if (error) toast.error("Erro ao criar lead");
        else toast.success("Lead criado");
      }
    }
    setSaving(false);
    setOpen(false);
    fetchAll();
  };

  const handleDelete = (lead: Lead) => {
    setDeleteConfirmLead(lead);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmLead) return;
    const idToDelete = deleteConfirmLead.id;
    const isPermanentDelete = isAdmin && deleteConfirmLead.status === "excluidos";

    const { error } = isPermanentDelete
      ? await supabase.rpc("hard_delete_lead", { _lead_id: idToDelete })
      : await supabase.rpc("soft_delete_lead", { _lead_id: idToDelete });

    if (error) {
      toast.error(isPermanentDelete ? "Erro ao excluir definitivamente" : "Erro ao excluir");
    } else {
      if (!isPermanentDelete) {
        await supabase.from("crm_lead_notes").insert({
          lead_id: idToDelete,
          user_id: user!.id,
          content: `🗑️ Card excluído por ${currentUserName || "usuário"}`,
        });
        toast.success("Lead movido para Excluídos");
      } else {
        toast.success("Lead excluído definitivamente");
      }
      removePaginatedItem(idToDelete);
      setRefreshKey((k) => k + 1);
    }
    setDeleteConfirmLead(null);
  };

  // Leads duplicados (mesmo telefone) — agrupa por sufixo de 8 dígitos do
  // telefone resolvido (mesma lógica de is_phone_field/rótulo usada pra
  // exibir o card). NÃO varre todo o JSON procurando "qualquer string com
  // 8+ dígitos" — isso confunde datas guardadas como AAAAMMDD com telefone.
  type DuplicateGroup = { phoneSuffix: string; phone: string; leads: Lead[]; samePhone: boolean };
  const [duplicatesDialogOpen, setDuplicatesDialogOpen] = useState(false);
  // Mover todos os cards de uma coluna pra outra de uma vez (admin).
  const [moveColumnSource, setMoveColumnSource] = useState<{ key: string; label: string } | null>(null);
  const [moveColumnDest, setMoveColumnDest] = useState("");
  const [movingColumn, setMovingColumn] = useState(false);
  const [scanningDuplicates, setScanningDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [deletingAllDuplicates, setDeletingAllDuplicates] = useState(false);
  const [deleteAllDuplicatesConfirmOpen, setDeleteAllDuplicatesConfirmOpen] = useState(false);

  const phoneSuffix = (telefone: string): string | null => {
    const digits = (telefone || "").replace(/\D/g, "");
    return digits.length >= 8 ? digits.slice(-8) : null;
  };

  const scanDuplicateLeads = async () => {
    setScanningDuplicates(true);
    try {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id, data, assigned_to, created_by, status, created_at")
        .neq("status", "excluidos")
        .limit(10000);
      if (error) throw error;

      const groups = new Map<string, { phone: string; leads: Lead[] }>();
      (data || []).forEach((l: any) => {
        const leadData = (l.data || {}) as Record<string, any>;
        const identity = resolveLeadIdentity(leadData, formFields);
        const suffix = phoneSuffix(identity.telefone);
        if (!suffix) return;
        const group = groups.get(suffix) || { phone: identity.telefone || suffix, leads: [] };
        group.leads.push(l as Lead);
        groups.set(suffix, group);
      });

      const result: DuplicateGroup[] = Array.from(groups.entries())
        .filter(([, g]) => g.leads.length >= 2)
        .map(([suffix, g]) => {
          const leads = g.leads.sort((a, b) => a.created_at.localeCompare(b.created_at));
          const distinctPhones = new Set(
            leads.map((l) => resolveLeadIdentity(l.data || {}, formFields).telefone.replace(/\D/g, "")),
          );
          return { phoneSuffix: suffix, phone: g.phone, leads, samePhone: distinctPhones.size <= 1 };
        })
        .sort((a, b) => b.leads.length - a.leads.length);

      setDuplicateGroups(result);
      const totalLeads = result.reduce((acc, g) => acc + g.leads.length, 0);
      toast.success(
        result.length > 0
          ? `${result.length} telefone(s) duplicado(s) — ${totalLeads} leads no total.`
          : "Nenhum lead duplicado encontrado.",
      );
    } catch (err: any) {
      toast.error(`Erro ao verificar duplicados: ${err.message || err}`);
    } finally {
      setScanningDuplicates(false);
    }
  };

  // Exclui (soft delete) todos os leads duplicados de cada grupo, mantendo
  // só o mais RECENTE (created_at mais novo) por telefone. Só age em grupos
  // onde os números completos são todos iguais de fato (samePhone) — grupos
  // que só batem na terminação de 8 dígitos (DDD diferente, coincidência)
  // nunca são tocados aqui, mesmo no "excluir todos".
  // Mesma lógica de deleteAllDuplicates, mas escopada aos resultados da
  // busca atual (ex.: usuário pesquisou um telefone e viu vários cards da
  // mesma pessoa) — evita ter que abrir o painel "Duplicados" e re-varrer
  // a base inteira só pra resolver um caso pontual já visível na tela.
  const [deletingSearchDuplicates, setDeletingSearchDuplicates] = useState(false);
  const [searchDuplicatesConfirmOpen, setSearchDuplicatesConfirmOpen] = useState(false);

  const searchDuplicateGroups = useMemo((): DuplicateGroup[] => {
    if (!isSearching || !searchResults || searchResults.length < 2) return [];
    const byPhone = new Map<string, Lead[]>();
    for (const lead of searchResults) {
      const identity = resolveLeadIdentity(lead.data || {}, formFields);
      const digits = identity.telefone.replace(/\D/g, "");
      if (digits.length < 8) continue;
      const arr = byPhone.get(digits) || [];
      arr.push(lead);
      byPhone.set(digits, arr);
    }
    return Array.from(byPhone.entries())
      .filter(([, leads]) => leads.length >= 2)
      .map(([digits, leads]) => ({
        phoneSuffix: digits.slice(-8),
        phone: digits,
        leads: leads.sort((a, b) => a.created_at.localeCompare(b.created_at)),
        samePhone: true,
      }));
  }, [isSearching, searchResults, formFields]);

  const deleteSearchDuplicates = async () => {
    setDeletingSearchDuplicates(true);
    let deleted = 0;
    let failed = 0;
    try {
      for (const group of searchDuplicateGroups) {
        const toDelete = group.leads.slice(0, -1); // mantém o mais recente
        for (const lead of toDelete) {
          const isPermanentDelete = isAdmin && lead.status === "excluidos";
          const { error } = isPermanentDelete
            ? await supabase.rpc("hard_delete_lead", { _lead_id: lead.id })
            : await supabase.rpc("soft_delete_lead", { _lead_id: lead.id });
          if (error) {
            failed += 1;
          } else {
            deleted += 1;
            removePaginatedItem(lead.id);
          }
        }
      }
      if (deleted > 0) toast.success(`${deleted} lead(s) duplicado(s) excluído(s).`);
      if (failed > 0) toast.error(`${failed} lead(s) não puderam ser excluídos.`);
      setRefreshKey((k) => k + 1);
      setSearchDuplicatesConfirmOpen(false);
    } finally {
      setDeletingSearchDuplicates(false);
    }
  };

  const deleteAllDuplicates = async () => {
    if (!duplicateGroups) return;
    setDeletingAllDuplicates(true);
    let deleted = 0;
    let failed = 0;
    try {
      for (const group of duplicateGroups) {
        if (!group.samePhone) continue;
        const toDelete = group.leads.slice(0, -1); // mantém o último (mais recente)
        for (const lead of toDelete) {
          const isPermanentDelete = isAdmin && lead.status === "excluidos";
          const { error } = isPermanentDelete
            ? await supabase.rpc("hard_delete_lead", { _lead_id: lead.id })
            : await supabase.rpc("soft_delete_lead", { _lead_id: lead.id });
          if (error) {
            failed += 1;
          } else {
            deleted += 1;
            removePaginatedItem(lead.id);
          }
        }
      }
      if (deleted > 0) toast.success(`${deleted} lead(s) duplicado(s) excluído(s).`);
      if (failed > 0) toast.error(`${failed} lead(s) não puderam ser excluídos.`);
      if (deleted === 0 && failed === 0) toast.info("Nenhum lead duplicado seguro pra excluir automaticamente.");
      setRefreshKey((k) => k + 1);
      setDeleteAllDuplicatesConfirmOpen(false);
      await scanDuplicateLeads();
    } finally {
      setDeletingAllDuplicates(false);
    }
  };

  // Move TODOS os leads de uma coluna pra outra de uma vez — uma única
  // atualização no banco (não respeita os filtros da tela; pega literalmente
  // todo lead com o status de origem, igual o usuário pediu).
  const confirmMoveColumn = async () => {
    if (!moveColumnSource || !moveColumnDest) return;
    setMovingColumn(true);
    try {
      const { error } = await supabase
        .from("crm_leads")
        .update({ status: moveColumnDest })
        .eq("status", moveColumnSource.key);
      if (error) throw error;
      toast.success(`Leads movidos de "${moveColumnSource.label}" para "${statusLabels[moveColumnDest]}".`);
      setMoveColumnSource(null);
      setMoveColumnDest("");
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast.error(`Erro ao mover coluna: ${err.message || err}`);
    } finally {
      setMovingColumn(false);
    }
  };

  const leadDisplayName = (lead: Lead) => {
    const identity = resolveLeadIdentity(lead.data || {}, formFields);
    return identity.nome || "Sem nome";
  };

  const leadDisplayPhone = (lead: Lead) => {
    const identity = resolveLeadIdentity(lead.data || {}, formFields);
    return identity.telefone || "—";
  };

  const openRestore = (lead: Lead) => {
    setRestoreLead(lead);
    setRestoreAssignee(lead.assigned_to || "");
  };

  const confirmRestore = async () => {
    if (!restoreLead || !restoreAssignee) {
      toast.error("Selecione um responsável");
      return;
    }
    setRestoring(true);
    const previous = (restoreLead as any).previous_status_before_exclude as string | null;
    const newStatus = previous && previous !== "excluidos" ? previous : "novo";
    const { error } = await supabase.from("crm_leads").update({
      status: newStatus,
      assigned_to: restoreAssignee,
      excluded_at: null,
      excluded_by: null,
      previous_status_before_exclude: null,
      previous_assigned_before_exclude: null,
    } as any).eq("id", restoreLead.id);
    if (error) {
      toast.error("Erro ao restaurar lead");
    } else {
      const assigneeName = profiles.find((p) => p.user_id === restoreAssignee)?.full_name || "responsável";
      await supabase.from("crm_lead_notes").insert({
        lead_id: restoreLead.id,
        user_id: user!.id,
        content: `♻️ Card restaurado por ${currentUserName || "admin"} e atribuído a ${assigneeName}`,
      });
      toast.success("Lead restaurado");
      setRefreshKey((k) => k + 1);
      fetchAll();
    }
    setRestoring(false);
    setRestoreLead(null);
    setRestoreAssignee("");
  };

  const getLeadDisplayStatus = useCallback((lead: Lead) => {
    const hasScheduledColumn = statuses.some((status) => status.key === "agendados");
    if (lead.scheduled_date && hasScheduledColumn) return "agendados";
    return lead.status;
  }, [statuses]);

  const openScheduleDialog = (lead: Lead) => {
    setSchedulingLead(lead);
    setScheduleOpen(true);
  };

  const getLeadSnapshot = useCallback((lead: Lead | null) => {
    if (!lead) return { nome: "", telefone: "", idade: "" };

    const data = normalizeLeadData(typeof lead.data === "object" ? (lead.data as Record<string, any>) : {}, formFields);
    const identity = resolveLeadIdentity(data, formFields);
    return {
      nome: identity.nome || "Lead",
      telefone: identity.telefone || "",
      idade: identity.idade || "",
    };
  }, [formFields]);

  const handleScheduleSubmit = async (schedData: {
    scheduled_datetime: string;
    forma_pagamento: string;
    forma_pagamento_oculos: string;
    canal_agendamento: string;
    consulta_paga: boolean;
    consulta_paga_no_agendamento: boolean;
  }) => {
    if (!schedulingLead || !user) return;
    setScheduleSaving(true);
    const { nome, telefone, idade } = getLeadSnapshot(schedulingLead);
    const nowIso = new Date().toISOString();
    const { data: newAppt, error } = await supabase.from("crm_appointments").insert({
      lead_id: schedulingLead.id,
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
      previous_status: schedulingLead.status,
      nome,
      telefone,
      idade,
    } as any).select("id").single();
    if (error) toast.error("Erro ao agendar");
    else {
      toast.success("Lead agendado com sucesso!");
      if (newAppt?.id) {
        await logAppointmentHistory(newAppt.id, user.id, "created", `${currentUserName || "Usuário"} agendou consulta para ${nome}`);
      }
    }
    setScheduleSaving(false);
    setScheduleOpen(false);
    setSchedulingLead(null);
    fetchAll();
  };

  const handleToggleComprou = async (leadId: string, value: boolean) => {
    patchItem(leadId, { comprou: value } as Partial<Lead>);
    const { error } = await supabase.from("crm_leads").update({ comprou: value } as any).eq("id", leadId);
    if (error) { toast.error("Erro ao atualizar"); setRefreshKey(k => k + 1); }
    else toast.success(value ? "Marcado como cliente ativo" : "Marcação removida");
  };

  const refreshLeadSecondaryMeta = useCallback(async () => {
    try {
      const [appointedIds, actRes, noteRes] = await Promise.all([
        fetchActiveAppointedLeadIds(),
        supabase.from("lead_activities").select("id, lead_id, title, scheduled_date, completed_at"),
        supabase.from("crm_lead_notes").select("lead_id"),
      ]);
      setAppointedLeadIds(appointedIds);
      setLeadActivities((actRes.data || []) as LeadActivity[]);
      setLeadNoteIds(new Set((noteRes.data || []).map((n: { lead_id: string }) => n.lead_id)));
    } catch {
      /* notas/atividades são secundárias */
    }
  }, []);

  useEffect(() => {
    const refreshAfterReturn = () => {
      void refreshLeadSecondaryMeta();
      setRefreshKey((k) => k + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshAfterReturn();
    };
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshLeadSecondaryMeta]);

  const handleLeadStatusChange = useCallback(
    (fromStatus: string, toStatus: string, raw: Record<string, unknown>) => {
      const lead = raw as Lead;
      if (!lead?.id) return;

      if (fromStatus === toStatus) {
        patchItem(lead.id, { data: lead.data } as Partial<Lead>);
        setEditingLead((prev) => (prev?.id === lead.id ? { ...prev, data: lead.data } : prev));
        setLeadNoteIds((prev) => new Set([...prev, lead.id]));
        void refreshLeadSecondaryMeta();
        return;
      }

      const fromColItem = paginatedColumns[fromStatus]?.items.find((it) => it.id === lead.id);
      const merged: Lead = { ...(fromColItem || editingLead || lead), ...lead, status: toStatus };
      updateItemStatus(lead.id, fromStatus, toStatus, merged);
      setEditingLead((prev) => (prev?.id === lead.id ? merged : prev));
      setFormStatus(toStatus);
      setLeadNoteIds((prev) => new Set([...prev, lead.id]));
      void refreshLeadSecondaryMeta();
    },
    [paginatedColumns, editingLead, updateItemStatus, patchItem, refreshLeadSecondaryMeta],
  );

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const fromStatus = result.source.droppableId;
    const leadId = result.draggableId;
    if (newStatus === fromStatus) return;
    // Apenas administradores podem mover leads manualmente entre colunas.
    if (!isAdmin) {
      toast.error("Apenas administradores podem mover leads entre colunas.");
      return;
    }
    const item = paginatedColumns[fromStatus]?.items.find(it => it.id === leadId)
      || (searchResults || []).find(it => it.id === leadId);
    updateItemStatus(leadId, fromStatus, newStatus, item);
    const { error } = await supabase.from("crm_leads").update({ status: newStatus }).eq("id", leadId);
    if (error) {
      toast.error("Erro ao mover lead");
      setRefreshKey(k => k + 1);
    }
  };


  // Vendedor options for the filter (gerente sees all managed companies, admin sees all)
  const vendedorOptions = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    if (isAdmin) return fullProfiles;
    // Gerente: show users from all managed companies, further narrowed by selected company filter
    const base = assignableUserIds
      ? fullProfiles.filter((p) => assignableUserIds.has(p.user_id))
      : fullProfiles;
    if (filterCompany !== "all") {
      return base.filter((p) => p.company_id === filterCompany);
    }
    return base;
  }, [fullProfiles, isAdmin, isGerente, assignableUserIds, filterCompany]);

  const vendedorIds = useMemo(
    () => new Set(userRoles.filter((r) => r.role === "vendedor").map((r) => r.user_id)),
    [userRoles],
  );

  const assignableProfiles = useMemo(
    () =>
      profiles.filter(
        (p) =>
          p.full_name?.trim()
          && (isAdmin || vendedorIds.has(p.user_id))
          && (assignableUserIds === null || assignableUserIds.has(p.user_id)),
      ),
    [profiles, isAdmin, vendedorIds, assignableUserIds],
  );

  const reassignProfileOptions = useMemo(() => {
    if (!formAssigned || assignableProfiles.some((p) => p.user_id === formAssigned)) {
      return assignableProfiles;
    }
    const current = profiles.find((p) => p.user_id === formAssigned);
    return current ? [...assignableProfiles, current] : assignableProfiles;
  }, [assignableProfiles, formAssigned, profiles]);

  const bulkTransferSourceProfiles = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    const base = isAdmin ? fullProfiles : vendedorOptions;
    return base.filter((p) => p.full_name?.trim());
  }, [fullProfiles, vendedorOptions, isAdmin, isGerente]);

  const bulkTransferDestProfiles = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    if (isAdmin) return fullProfiles.filter((p) => p.full_name?.trim());
    return assignableProfiles;
  }, [fullProfiles, isAdmin, isGerente, assignableProfiles]);

  // Helper to get lead name/phone for search
  const getLeadSearchText = useCallback((lead: Lead) => {
    const data = typeof lead.data === "object" ? (lead.data as Record<string, any>) : {};
    const nameFields = formFields.filter((f) => f.is_name_field);
    const phoneFields = formFields.filter((f) => f.is_phone_field);
    const nome = nameFields.reduce<string>((found, f) => found || data[`field_${f.id}`] || "", null as any) || data.nome_lead || "";
    const telefone = phoneFields.reduce<string>((found, f) => found || data[`field_${f.id}`] || "", null as any) || data.telefone || "";
    return `${nome} ${telefone}`.toLowerCase();
  }, [formFields]);

  // Compute task priority per lead: 3=overdue, 2=today, 1=future pending, 0=none
  const leadTaskPriority = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    const todayStr = now.toDateString();
    leadActivities.forEach((a) => {
      if (a.completed_at) return;
      const dt = new Date(a.scheduled_date);
      let prio = 1; // future pending
      if (dt < now) prio = 3; // overdue
      else if (dt.toDateString() === todayStr) prio = 2; // today
      const current = map.get(a.lead_id) || 0;
      if (prio > current) map.set(a.lead_id, prio);
    });
    return map;
  }, [leadActivities]);

  const sortLeadsInColumn = useCallback(
    (items: Lead[]) =>
      sortKanbanByExamAndTratativa(items, {
        getExamTs: (lead) =>
          getLeadExamTimestamp(
            typeof lead.data === "object" ? (lead.data as Record<string, unknown>) : {},
            formFields,
          ),
        taskPriority: leadTaskPriority,
        requireTratativaStatusMatch: true,
      }),
    [formFields, leadTaskPriority],
  );

  // Retorna {items, total, hasMore, loading} por status, usando o hook paginado
  const getColumnState = useCallback((status: string) => {
    // Mescla leads offline (criados sem internet) na coluna correspondente
    const offlineForStatus = offlineLeads.filter(l => getLeadDisplayStatus(l) === status);
    if (isSearching) {
      const filtered = (searchResults || []).filter(l => getLeadDisplayStatus(l) === status && !appointedLeadIds.has(l.id));
      const merged = [...offlineForStatus, ...filtered];
      return { items: sortLeadsInColumn(merged), total: merged.length, hasMore: false, loading: searching };
    }
    const col = paginatedColumns[status];
    const items = (col?.items || []).filter(l => !appointedLeadIds.has(l.id));
    const merged = [...offlineForStatus, ...items];
    return {
      items: sortLeadsInColumn(merged),
      total: (col?.total || 0) + offlineForStatus.length,
      hasMore: col?.hasMore || false,
      loading: col?.loading || false,
    };
  }, [paginatedColumns, isSearching, searchResults, searching, sortLeadsInColumn, appointedLeadIds, offlineLeads, getLeadDisplayStatus]);

  const getLeadsByStatus = (status: string) => getColumnState(status).items;

  const totalDisplayed = useMemo(() => {
    if (isSearching) return (searchResults || []).filter(l => !appointedLeadIds.has(l.id)).length;
    return Object.values(paginatedColumns).reduce((acc, col) => acc + (col?.total || 0), 0);
  }, [paginatedColumns, isSearching, searchResults, appointedLeadIds]);

  const getActivitiesForLead = (leadId: string) => leadActivities.filter(a => a.lead_id === leadId);

  const hasActiveFilters = filterVendedor !== "all" || filterCompany !== "all" || filterDateFrom || filterDateTo || searchQuery.trim();
  const clearFilters = () => { setFilterVendedor("all"); setFilterCompany("all"); setFilterDateFrom(undefined); setFilterDateTo(undefined); setSearchQuery(""); };

  const getSyncStatus = (leadId: string): "offline" | "synced" | null => {
    if (offlineIds.has(leadId)) return "offline";
    if (recentlySyncedIds.has(leadId)) return "synced";
    return null;
  };
  return (
    <AppLayout>
      <div className="mb-3 sm:mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Leads</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {totalDisplayed} lead{totalDisplayed !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || isGerente) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkTransferOpen(true)}
              className="shrink-0"
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Transferir
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAllocateUnassignedOpen(true)}
              className="shrink-0"
            >
              <Users className="mr-1 h-4 w-4" />
              Alocar sem usuário
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDuplicatesDialogOpen(true);
                void scanDuplicateLeads();
              }}
              className="shrink-0"
            >
              <Copy className="mr-1 h-4 w-4" />
              Duplicados
            </Button>
          )}
          {(isAdmin || isGerente) && (
            <Button
              size="sm"
              variant={showFilters ? "default" : "outline"}
              onClick={() => setShowFilters(!showFilters)}
              className="shrink-0"
            >
              <Filter className="mr-1 h-4 w-4" />
              Filtros
              {hasActiveFilters && <span className="ml-1 h-2 w-2 rounded-full bg-destructive" />}
            </Button>
          )}
          <Button size="sm" className="shrink-0" onClick={() => navigate("/novo-lead")}>
            <Plus className="mr-1 h-4 w-4" />Lead
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-3 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou telefone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {searchDuplicateGroups.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm">
          <span className="text-amber-700 dark:text-amber-400">
            {searchDuplicateGroups.reduce((acc, g) => acc + g.leads.length, 0)} card(s) duplicado(s) nessa busca
            (mesmo telefone).
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setSearchDuplicatesConfirmOpen(true)}
            disabled={deletingSearchDuplicates}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Excluir duplicados
          </Button>
        </div>
      )}

      {/* Filter bar */}
      {(isAdmin || isGerente) && showFilters && (
        <div className="mb-4 p-3 bg-muted/50 rounded-lg border flex flex-wrap items-end gap-3">
          {isGerente && !isAdmin && companies.length > 1 && (
            <div className="flex-1 min-w-[180px] max-w-[250px]">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Empresa</label>
              <Select
                value={filterCompany}
                onValueChange={(v) => { setFilterCompany(v); setFilterVendedor("all"); }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as empresas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex-1 min-w-[180px] max-w-[250px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendedor</label>
            <Select value={filterVendedor} onValueChange={setFilterVendedor}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="__unassigned__">Sem usuário alocado</SelectItem>
                {vendedorOptions.map(p => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || "Sem nome"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data início</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 w-full justify-start text-left font-normal", !filterDateFrom && "text-muted-foreground")}>
                  {filterDateFrom ? format(filterDateFrom, "dd/MM/yyyy") : "Selecionar"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={filterDateFrom} onSelect={setFilterDateFrom} locale={ptBR} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data fim</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 w-full justify-start text-left font-normal", !filterDateTo && "text-muted-foreground")}>
                  {filterDateTo ? format(filterDateTo, "dd/MM/yyyy") : "Selecionar"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} locale={ptBR} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          {hasActiveFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="h-9">
              <X className="mr-1 h-4 w-4" />Limpar
            </Button>
          )}
        </div>
      )}

      {/* Mobile: Tab selector */}
      <div className="lg:hidden mb-3 overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4">
        <div className="flex gap-1.5 min-w-max">
          {visibleStatuses.map((status) => {
            const colors = colorMap[status.color] || colorMap.blue;
            const count = getColumnState(status.key).total;
            return (
              <button
                key={status.key}
                onClick={() => setMobileTab(status.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  mobileTab === status.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <div className={`h-2 w-2 rounded-full ${mobileTab === status.key ? "bg-primary-foreground/80" : colors.header}`} />
                {status.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  mobileTab === status.key ? "bg-primary-foreground/20" : "bg-background"
                }`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile: Active column cards */}
      <div className="lg:hidden space-y-2 mb-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }} onScroll={(e) => handleColumnScroll(mobileTab, e)}>
        {visibleStatuses.filter(s => s.key === mobileTab).map((status) => {
          const colState = getColumnState(status.key);
          const statusLeads = colState.items;
          const visibleLeads = statusLeads;
          const hasMore = colState.hasMore;
          return (
            <div key={status.key}>
              {statusLeads.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">Nenhum lead nesta coluna</p>
              )}
              {visibleLeads.map((lead) => (
                <div key={lead.id} className="mb-2">
                  <LeadCard
                    lead={lead}
                    columns={columns}
                    formFields={formFields}
                    profiles={profiles}
                    isAdmin={isAdmin}
                    syncStatus={getSyncStatus(lead.id)}
                    activities={getActivitiesForLead(lead.id)}
                    onEdit={() => openEdit(lead)}
                    onDelete={() => handleDelete(lead)}
                    onHistory={() => {
                      setHistoryLeadId(lead.id);
                      setHistoryLeadName(getLeadSnapshot(lead).nome || "Lead");
                      setHistoryOpen(true);
                    }}
                    onSchedule={() => openScheduleDialog(lead)}
                    onToggleComprou={(value) => handleToggleComprou(lead.id, value)}
                    onRestore={() => openRestore(lead)}
                  />
                </div>
              ))}
              {hasMore && (
                <p className="text-center text-xs text-muted-foreground py-2">
                  Mostrando {visibleLeads.length} de {colState.total} — role para carregar mais
                </p>
              )}
              <button
                onClick={() => navigate(`/novo-lead?status=${status.key}`)}
                className="w-full py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors"
              >
                + Adicionar lead
              </button>
            </div>
          );
        })}
      </div>

      {/* Desktop: Kanban board with drag & drop */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="hidden lg:flex gap-3 overflow-x-auto pb-4" style={{ height: "calc(100vh - 200px)" }}>
          {visibleStatuses.map((status) => {
          const colState = getColumnState(status.key);
          const statusLeads = colState.items;
          const visibleLeads = statusLeads;
          const hasMore = colState.hasMore;
            const colors = colorMap[status.color] || colorMap.blue;
            return (
              <div key={status.key} className="flex-shrink-0 w-[280px] flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 px-1 flex-shrink-0">
                  <div className={`h-2.5 w-2.5 rounded-full ${colors.header}`} />
                  <h3 className="font-semibold text-sm text-foreground truncate">{status.label}</h3>
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>
                    {colState.total}
                  </span>
                  {isAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setMoveColumnSource({ key: status.key, label: status.label }); setMoveColumnDest(""); }}>
                          <FolderInput className="mr-2 h-4 w-4" />
                          Mover todos para outra coluna
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <Droppable droppableId={status.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={(el) => {
                        provided.innerRef(el);
                        columnRefs.current[status.key] = el;
                      }}
                      {...provided.droppableProps}
                      onScroll={(e) => handleColumnScroll(status.key, e)}
                      className={`flex-1 rounded-xl p-2 space-y-2 transition-colors overflow-y-auto min-h-0 ${
                        snapshot.isDraggingOver ? "bg-primary/5 border-2 border-dashed border-primary/30" : "bg-muted/50 border border-transparent"
                      }`}
                    >
                      {visibleLeads.map((lead, index) => (
                        <Draggable key={lead.id} draggableId={lead.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={snapshot.isDragging ? "opacity-90 rotate-2" : ""}
                            >
                              <LeadCard
                                lead={lead}
                                columns={columns}
                                formFields={formFields}
                                profiles={profiles}
                                isAdmin={isAdmin}
                                syncStatus={getSyncStatus(lead.id)}
                                activities={getActivitiesForLead(lead.id)}
                                onEdit={() => openEdit(lead)}
                                onDelete={() => handleDelete(lead)}
                                onHistory={() => {
                                  setHistoryLeadId(lead.id);
                                  setHistoryLeadName(getLeadSnapshot(lead).nome || "Lead");
                                  setHistoryOpen(true);
                                }}
                                onSchedule={() => openScheduleDialog(lead)}
                                onToggleComprou={(value) => handleToggleComprou(lead.id, value)}
                                onRestore={() => openRestore(lead)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {hasMore && (
                        <p className="text-center text-xs text-muted-foreground py-1">
                          Mostrando {visibleLeads.length} de {colState.total} — role para carregar mais
                        </p>
                      )}

                      <button
                        onClick={() => navigate(`/novo-lead?status=${status.key}`)}
                        className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors"
                      >
                        + Adicionar lead
                      </button>
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <LeadFormDialog
        open={open}
        onOpenChange={setOpen}
        profiles={profiles}
        assignableProfiles={reassignProfileOptions}
        companies={companies}
        currentUserName={currentUserName}
        formData={formData}
        setFormData={setFormData}
        formStatus={formStatus}
        setFormStatus={setFormStatus}
        formAssigned={formAssigned}
        setFormAssigned={setFormAssigned}
        saving={saving}
        isEditing={!!editingLead}
        canReassign={isAdmin || isGerente}
        onSubmit={handleSave}
        statusOptions={statusOptions}
        statusLabels={statusLabels}
        leadId={editingLead?.id}
        onActivityChange={refreshLeadSecondaryMeta}
        onLeadStatusChange={handleLeadStatusChange}
      />

      <ScheduleLeadDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        leadName={getLeadSnapshot(schedulingLead).nome}
        leadPhone={getLeadSnapshot(schedulingLead).telefone}
        canalAgendamento={
          schedulingLead
            ? resolveCanalFromLeadData(
                normalizeLeadData(
                  typeof schedulingLead.data === "object" ? (schedulingLead.data as Record<string, unknown>) : {},
                  formFields,
                ),
              )
            : "Ligação Leads"
        }
        companyId={
          (schedulingLead?.assigned_to
            ? fullProfiles.find((p) => p.user_id === schedulingLead.assigned_to)?.company_id
            : fullProfiles.find((p) => p.user_id === user?.id)?.company_id) || null
        }
        saving={scheduleSaving}
        onSubmit={handleScheduleSubmit}
      />

      <LeadHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        leadId={historyLeadId}
        leadName={historyLeadName}
        profiles={profiles}
        onNoteAdded={fetchAll}
      />

      <AlertDialog open={!!deleteConfirmLead} onOpenChange={(open) => !open && setDeleteConfirmLead(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirmLead?.status === "excluidos" && isAdmin
                ? "Excluir lead permanentemente?"
                : "Mover lead para Excluídos?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmLead?.status === "excluidos" && isAdmin
                ? "Esta ação não pode ser desfeita. O lead e todas as suas informações serão removidos permanentemente do sistema."
                : "O lead sairá do fluxo e ficará visível apenas para administradores na coluna Excluídos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!restoreLead} onOpenChange={(open) => !open && setRestoreLead(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar lead excluído</AlertDialogTitle>
            <AlertDialogDescription>
              Atribua um responsável. O card voltará ao fluxo normal na coluna anterior à exclusão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Select value={restoreAssignee} onValueChange={setRestoreAssignee}>
              <SelectTrigger><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
              <SelectContent>
                {assignableProfiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>
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

      {(isAdmin || isGerente) && (
        <BulkTransferDialog
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          module="leads"
          entityLabel="leads"
          sourceProfiles={bulkTransferSourceProfiles}
          destProfiles={bulkTransferDestProfiles}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {(isAdmin || isGerente) && (
        <AllocateUnassignedDialog
          open={allocateUnassignedOpen}
          onOpenChange={setAllocateUnassignedOpen}
          companies={companies}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <Dialog open={duplicatesDialogOpen} onOpenChange={setDuplicatesDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Leads duplicados (mesmo telefone)</DialogTitle>
            <DialogDescription>
              Agrupado pelos últimos 8 dígitos do telefone do lead. Confira antes de excluir — pode ser duas
              pessoas com números parecidos por coincidência.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="secondary" onClick={() => void scanDuplicateLeads()} disabled={scanningDuplicates}>
              {scanningDuplicates ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verificando...</>
              ) : (
                <><Search className="mr-2 h-4 w-4" />Verificar agora</>
              )}
            </Button>
            <div className="flex items-center gap-2">
              {duplicateGroups && (
                <span className="text-xs text-muted-foreground">
                  {duplicateGroups.length} telefone(s) duplicado(s)
                </span>
              )}
              {!!duplicateGroups?.some((g) => g.samePhone && g.leads.length > 1) && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteAllDuplicatesConfirmOpen(true)}
                  disabled={deletingAllDuplicates}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir duplicados
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {duplicateGroups && duplicateGroups.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhum lead duplicado encontrado.</p>
            )}
            {duplicateGroups?.map((group) => {
              const keptId = group.samePhone ? group.leads[group.leads.length - 1].id : null;
              return (
              <div key={group.phoneSuffix} className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">
                  Termina em {group.phoneSuffix} <span className="text-muted-foreground">({group.leads.length} leads)</span>
                  {!group.samePhone && (
                    <span className="ml-2 text-xs font-normal text-amber-500">
                      ⚠ números completos diferentes — só a terminação bate, confira antes de excluir
                    </span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {group.leads.map((lead) => (
                    <div key={lead.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-sm truncate">
                          {leadDisplayName(lead)} <span className="text-muted-foreground">· {leadDisplayPhone(lead)}</span>
                          {keptId === lead.id && (
                            <span className="ml-1.5 text-[10px] font-normal text-emerald-500">mantido</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {statuses.find((s) => s.key === lead.status)?.label || lead.status} ·{" "}
                          {profiles.find((p) => p.user_id === lead.assigned_to)?.full_name || "Sem responsável"} ·{" "}
                          {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(lead)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteAllDuplicatesConfirmOpen} onOpenChange={(open) => !deletingAllDuplicates && setDeleteAllDuplicatesConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir leads duplicados?</AlertDialogTitle>
            <AlertDialogDescription>
              Mantém o lead mais recente de cada telefone e move os demais pra "Excluídos" (não exclui de vez —
              pode restaurar depois). Grupos marcados com ⚠ (números completos diferentes) não são tocados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAllDuplicates}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void deleteAllDuplicates(); }}
              disabled={deletingAllDuplicates}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAllDuplicates ? "Excluindo..." : "Excluir duplicados"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={searchDuplicatesConfirmOpen} onOpenChange={(open) => !deletingSearchDuplicates && setSearchDuplicatesConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cards duplicados desta busca?</AlertDialogTitle>
            <AlertDialogDescription>
              Mantém o card mais recente de cada telefone encontrado nesta busca e move os demais pra "Excluídos"
              (não exclui de vez — pode restaurar depois).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSearchDuplicates}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void deleteSearchDuplicates(); }}
              disabled={deletingSearchDuplicates}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingSearchDuplicates ? "Excluindo..." : "Excluir duplicados"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!moveColumnSource} onOpenChange={(open) => !open && !movingColumn && setMoveColumnSource(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover todos os leads de "{moveColumnSource?.label}"</AlertDialogTitle>
            <AlertDialogDescription>
              Move TODOS os leads dessa coluna pra outra de uma vez (independente dos filtros aplicados na tela).
              Não dá pra desfazer em massa — só manualmente, lead por lead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1.5">
            <Label>Coluna de destino</Label>
            <Select value={moveColumnDest} onValueChange={setMoveColumnDest}>
              <SelectTrigger><SelectValue placeholder="Selecione a coluna" /></SelectTrigger>
              <SelectContent>
                {visibleStatuses.filter((s) => s.key !== moveColumnSource?.key).map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={movingColumn}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmMoveColumn(); }}
              disabled={movingColumn || !moveColumnDest}
            >
              {movingColumn ? "Movendo..." : "Mover todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
