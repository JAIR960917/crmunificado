import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { syncOfflineQueue, getOfflineQueue } from "@/lib/offlineSync";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, Filter, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import LeadCard from "@/components/leads/LeadCard";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import ScheduleLeadDialog from "@/components/leads/ScheduleLeadDialog";
import LeadHistoryDialog from "@/components/leads/LeadHistoryDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { usePaginatedColumns } from "@/hooks/use-paginated-columns";
import { normalizeLeadData, resolveLeadIdentity } from "@/lib/leadIdentity";

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
type CrmStatus = {
  id: string; key: string; label: string; position: number; color: string;
};
type Company = { id: string; name: string };
type FormFieldInfo = { id: string; label: string; position?: number; is_name_field: boolean; is_phone_field: boolean; show_on_card?: boolean; status_mapping?: Record<string, string> | null; date_status_ranges?: { ranges: { max_years: number; status_key: string }[]; above_all: string; no_answer: string } | null };
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Mobile: active tab for status columns
  const [mobileTab, setMobileTab] = useState<string>("");

  // Offline sync tracking
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [recentlySyncedIds, setRecentlySyncedIds] = useState<Set<string>>(new Set());
  const [offlineLeads, setOfflineLeads] = useState<Lead[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters (admin/gerente only)
  const [filterVendedor, setFilterVendedor] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>();
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [fullProfiles, setFullProfiles] = useState<Profile[]>([]);
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
  const statusKeys = useMemo(() => statuses.map(s => s.key), [statuses]);

  const columnFilter = useMemo(() => ({
    apply: (q: any) => {
      let res = q;
      if ((isAdmin || isGerente) && filterVendedor && filterVendedor !== "all") {
        res = res.or(`assigned_to.eq.${filterVendedor},created_by.eq.${filterVendedor}`);
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
  }), [isAdmin, isGerente, filterVendedor, filterDateFrom, filterDateTo]);

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
      const [{ data: cols }, { data: profs }, { data: sts }, { data: myProfile }, { data: managerCos }, { data: ff }, { data: ffFull }, { data: fullProfs }] = await Promise.all([
        supabase.from("crm_columns").select("*").order("position"),
        supabase.rpc("get_profile_names"),
        supabase.from("crm_statuses").select("*").order("position"),
        supabase.from("profiles").select("company_id").eq("user_id", user!.id).maybeSingle(),
        supabase.from("manager_companies").select("company_id").eq("user_id", user!.id),
        supabase.from("crm_form_fields").select("id, label, position, is_name_field, is_phone_field, show_on_card, status_mapping, date_status_ranges").order("position"),
        supabase.from("crm_form_fields").select("*").order("position"),
        supabase.from("profiles").select("user_id, full_name, avatar_url, company_id"),
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
      const loadedFields = (ff || []) as unknown as FormFieldInfo[];
      setFormFields(loadedFields);
      const me = (profs || []).find((p: Profile) => p.user_id === user?.id);
      setCurrentUserName(me?.full_name || user?.email || "");
      setFullProfiles((fullProfs || []) as Profile[]);

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
        const [{ data: activeAppts }, { data: actData }, { data: noteData }] = await Promise.all([
          supabase.from("crm_appointments").select("lead_id").eq("status", "agendado"),
          supabase.from("lead_activities").select("id, lead_id, title, scheduled_date, completed_at"),
          supabase.from("crm_lead_notes").select("lead_id"),
        ]);
        setAppointedLeadIds(new Set((activeAppts || []).map((a: any) => a.lead_id)));
        setLeadActivities((actData || []) as LeadActivity[]);
        setLeadNoteIds(new Set((noteData || []).map((n: any) => n.lead_id)));
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
    if (statuses.length > 0 && !mobileTab) {
      setMobileTab(statuses[0].key);
    }
  }, [statuses]);

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

  const resolveStatus = (data: Record<string, any>, excludeStatuses: string[] = []): string => {
    const defaultStatus = statuses.length > 0 ? statuses[0].key : formStatus;
    const excludeSet = new Set(excludeStatuses);

    // Reúne TODAS as perguntas com regra (data ou opção) e processa por ordem do formulário.
    const ruleFields = formFields
      .filter(f =>
        f.date_status_ranges ||
        (f.status_mapping && Object.keys(f.status_mapping).length > 0)
      )
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
    setSaving(true);
    if (editingLead) {
      // Recalculate status based on date/mapping fields if they exist
      const hasMappingField = formFields.some(f => (f.status_mapping && Object.keys(f.status_mapping).length > 0) || f.date_status_ranges);
      const finalStatus = hasMappingField ? resolveStatus(formData, [editingLead.status]) : formStatus;
      const { error } = await supabase.from("crm_leads").update({
        data: formData, status: finalStatus, assigned_to: formAssigned || null,
      }).eq("id", editingLead.id);
      if (error) toast.error("Erro ao atualizar");
      else toast.success("Lead atualizado");
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

  const handleDelete = async (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    // Soft-delete: move para coluna "Excluídos" com comentário de quem excluiu
    const lead = Object.values(paginatedColumns)
      .flatMap((c) => c.items)
      .find((l) => l.id === deleteConfirmId);
    const { error } = await supabase.from("crm_leads").update({
      status: "excluidos",
      previous_status_before_exclude: lead?.status ?? null,
      previous_assigned_before_exclude: lead?.assigned_to ?? null,
      excluded_at: new Date().toISOString(),
      excluded_by: user?.id ?? null,
    } as any).eq("id", deleteConfirmId);
    if (error) toast.error("Erro ao excluir");
    else {
      await supabase.from("crm_lead_notes").insert({
        lead_id: deleteConfirmId,
        user_id: user!.id,
        content: `🗑️ Card excluído por ${currentUserName || "usuário"}`,
      });
      toast.success("Lead movido para Excluídos");
      fetchAll();
    }
    setDeleteConfirmId(null);
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

  const handleScheduleSubmit = async (schedData: { scheduled_datetime: string; forma_pagamento: string; canal_agendamento: string }) => {
    if (!schedulingLead || !user) return;
    setScheduleSaving(true);
    const { nome, telefone, idade } = getLeadSnapshot(schedulingLead);
    const { error } = await supabase.from("crm_appointments").insert({
      lead_id: schedulingLead.id,
      scheduled_by: user.id,
      scheduled_datetime: schedData.scheduled_datetime,
      valor: 0,
      forma_pagamento: schedData.forma_pagamento,
      canal_agendamento: schedData.canal_agendamento,
      previous_status: schedulingLead.status,
      nome,
      telefone,
      idade,
    } as any);
    if (error) toast.error("Erro ao agendar");
    else toast.success("Lead agendado com sucesso!");
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


  // Vendedor options for the filter (gerente sees only same company, admin sees all)
  const vendedorOptions = useMemo(() => {
    if (!isAdmin && !isGerente) return [];
    if (isAdmin) return fullProfiles;
    // Gerente: find my company_id
    const myProfile = fullProfiles.find(p => p.user_id === user?.id);
    if (!myProfile?.company_id) return [];
    return fullProfiles.filter(p => p.company_id === myProfile.company_id);
  }, [fullProfiles, isAdmin, isGerente, user?.id]);

  // Helper to get lead name/phone for search
  const getLeadSearchText = useCallback((lead: Lead) => {
    const data = typeof lead.data === "object" ? (lead.data as Record<string, any>) : {};
    const nameFields = formFields.filter((f) => f.is_name_field);
    const phoneFields = formFields.filter((f) => f.is_phone_field);
    const nome = nameFields.reduce<string>((found, f) => found || data[`field_${f.id}`] || "", null as any) || data.nome_lead || "";
    const telefone = phoneFields.reduce<string>((found, f) => found || data[`field_${f.id}`] || "", null as any) || data.telefone || "";
    return `${nome} ${telefone}`.toLowerCase();
  }, [formFields]);

  // Build a set of lead IDs that have recent activity (completed task or note)
  const leadsWithRecentActivity = useMemo(() => {
    const ids = new Set<string>();
    // Leads with completed activities
    leadActivities.filter(a => a.completed_at).forEach(a => ids.add(a.lead_id));
    // Leads with notes
    leadNoteIds.forEach(id => ids.add(id));
    return ids;
  }, [leadActivities, leadNoteIds]);

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

  const sortByTaskPriority = useCallback((items: Lead[]) => {
    return [...items].sort((a, b) => {
      const aPrio = leadTaskPriority.get(a.id) || 0;
      const bPrio = leadTaskPriority.get(b.id) || 0;
      if (aPrio !== bPrio) return bPrio - aPrio;
      const aHasRecent = leadsWithRecentActivity.has(a.id) ? 1 : 0;
      const bHasRecent = leadsWithRecentActivity.has(b.id) ? 1 : 0;
      return aHasRecent - bHasRecent;
    });
  }, [leadTaskPriority, leadsWithRecentActivity]);

  // Retorna {items, total, hasMore, loading} por status, usando o hook paginado
  const getColumnState = useCallback((status: string) => {
    // Mescla leads offline (criados sem internet) na coluna correspondente
    const offlineForStatus = offlineLeads.filter(l => getLeadDisplayStatus(l) === status);
    if (isSearching) {
      const filtered = (searchResults || []).filter(l => getLeadDisplayStatus(l) === status && !appointedLeadIds.has(l.id));
      const merged = [...offlineForStatus, ...filtered];
      return { items: sortByTaskPriority(merged), total: merged.length, hasMore: false, loading: searching };
    }
    const col = paginatedColumns[status];
    const items = (col?.items || []).filter(l => !appointedLeadIds.has(l.id));
    const merged = [...offlineForStatus, ...items];
    return {
      items: sortByTaskPriority(merged),
      total: (col?.total || 0) + offlineForStatus.length,
      hasMore: col?.hasMore || false,
      loading: col?.loading || false,
    };
  }, [paginatedColumns, isSearching, searchResults, searching, sortByTaskPriority, appointedLeadIds, offlineLeads, getLeadDisplayStatus]);

  const getLeadsByStatus = (status: string) => getColumnState(status).items;

  const totalDisplayed = useMemo(() => {
    if (isSearching) return (searchResults || []).filter(l => !appointedLeadIds.has(l.id)).length;
    return Object.values(paginatedColumns).reduce((acc, col) => acc + (col?.total || 0), 0);
  }, [paginatedColumns, isSearching, searchResults, appointedLeadIds]);

  const getActivitiesForLead = (leadId: string) => leadActivities.filter(a => a.lead_id === leadId);

  const hasActiveFilters = filterVendedor !== "all" || filterDateFrom || filterDateTo || searchQuery.trim();
  const clearFilters = () => { setFilterVendedor("all"); setFilterDateFrom(undefined); setFilterDateTo(undefined); setSearchQuery(""); };

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

      {/* Filter bar */}
      {(isAdmin || isGerente) && showFilters && (
        <div className="mb-4 p-3 bg-muted/50 rounded-lg border flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px] max-w-[250px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Vendedor</label>
            <Select value={filterVendedor} onValueChange={setFilterVendedor}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
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
          {statuses.map((status) => {
            const colors = colorMap[status.color] || colorMap.blue;
            const count = getLeadsByStatus(status.key).length;
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
        {statuses.filter(s => s.key === mobileTab).map((status) => {
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
                    onDelete={() => handleDelete(lead.id)}
                    onHistory={() => {
                      setHistoryLeadId(lead.id);
                      setHistoryLeadName(getLeadSnapshot(lead).nome || "Lead");
                      setHistoryOpen(true);
                    }}
                    onSchedule={() => openScheduleDialog(lead)}
                    onToggleComprou={(value) => handleToggleComprou(lead.id, value)}
                  />
                </div>
              ))}
              {hasMore && (
                <p className="text-center text-xs text-muted-foreground py-2">
                  Mostrando {visibleLeads.length} de {statusLeads.length} — role para carregar mais
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
          {statuses.map((status) => {
          const colState = getColumnState(status.key);
          const statusLeads = colState.items;
          const visibleLeads = statusLeads;
          const hasMore = colState.hasMore;
            const colors = colorMap[status.color] || colorMap.blue;
            return (
              <div key={status.key} className="flex-shrink-0 w-[280px] flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 px-1 flex-shrink-0">
                  <div className={`h-2.5 w-2.5 rounded-full ${colors.header}`} />
                  <h3 className="font-semibold text-sm text-foreground">{status.label}</h3>
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>
                    {statusLeads.length}
                  </span>
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
                                onDelete={() => handleDelete(lead.id)}
                                onHistory={() => {
                                  setHistoryLeadId(lead.id);
                                  setHistoryLeadName(getLeadSnapshot(lead).nome || "Lead");
                                  setHistoryOpen(true);
                                }}
                                onSchedule={() => openScheduleDialog(lead)}
                                onToggleComprou={(value) => handleToggleComprou(lead.id, value)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {hasMore && (
                        <p className="text-center text-xs text-muted-foreground py-1">
                          Mostrando {visibleLeads.length} de {statusLeads.length} — role para carregar mais
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
        onActivityChange={fetchAll}
      />

      <ScheduleLeadDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        leadName={getLeadSnapshot(schedulingLead).nome}
        leadPhone={getLeadSnapshot(schedulingLead).telefone}
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

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O lead e todas as suas informações serão removidos permanentemente do sistema.
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

    </AppLayout>
  );
}
