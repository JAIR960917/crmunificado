import { useEffect, useState, useCallback, useMemo } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2, Phone, Building2, AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPhoneBR } from "@/lib/phoneFormat";
import CobrancaEditSheet from "@/components/cobrancas/CobrancaEditSheet";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { usePaginatedColumns } from "@/hooks/use-paginated-columns";
import { logTransition } from "@/lib/transitionLogs";

type CobrancaActivity = {
  id: string;
  cobranca_id: string;
  title: string;
  scheduled_date: string;
  completed_at: string | null;
};

type Cobranca = {
  id: string;
  data: Record<string, any>;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
  company_id: string | null;
  valor: number;
  created_at: string;
  updated_at: string;
};

type CrmStatus = {
  id: string; key: string; label: string; position: number; color: string;
  financeiro_visible?: boolean;
};




type Profile = { user_id: string; full_name: string; avatar_url?: string | null };
type Company = { id: string; name: string };

type CobrancaGroup = {
  groupId: string;            // chave de render (cpf normalizado ou id da cobrança quando sem CPF)
  cpfKey: string | null;
  items: Cobranca[];
  representative: Cobranca;
  representativeStatus: string;
  valorTotal: number;
  companies: string[];        // nomes das lojas únicos
};

const normalizeCpf = (raw: unknown): string | null => {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
};

function groupCobrancasByCpf(
  items: Cobranca[],
  statuses: CrmStatus[],
  companyNameById: Map<string, string>,
): CobrancaGroup[] {
  const positionByKey = new Map<string, number>();
  statuses.forEach((s) => positionByKey.set(s.key, s.position));

  const buckets = new Map<string, Cobranca[]>();
  for (const c of items) {
    const cpf = normalizeCpf((c.data as any)?.documento ?? (c.data as any)?.cpf);
    const key = cpf ? `cpf:${cpf}` : `id:${c.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }

  const groups: CobrancaGroup[] = [];
  buckets.forEach((arr, key) => {
    const cpfKey = key.startsWith("cpf:") ? key.slice(4) : null;
    // representante: status mais grave (maior position); empate → maior valor
    const rep = [...arr].sort((a, b) => {
      const pa = positionByKey.get(a.status) ?? -1;
      const pb = positionByKey.get(b.status) ?? -1;
      if (pa !== pb) return pb - pa;
      return (Number(b.valor) || 0) - (Number(a.valor) || 0);
    })[0];
    const valorTotal = arr.reduce((acc, it) => acc + (Number(it.valor) || 0), 0);
    const companies = Array.from(
      new Set(
        arr
          .map((it) => (it.company_id ? companyNameById.get(it.company_id) || "" : ""))
          .filter(Boolean),
      ),
    );
    groups.push({
      groupId: key,
      cpfKey,
      items: arr,
      representative: rep,
      representativeStatus: rep.status,
      valorTotal,
      companies,
    });
  });
  return groups;
}

const colorMap: Record<string, { header: string; badge: string }> = {
  blue:    { header: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 border-blue-300" },
  amber:   { header: "bg-amber-500",   badge: "bg-amber-500/15 text-amber-700 border-amber-300" },
  violet:  { header: "bg-violet-500",  badge: "bg-violet-500/15 text-violet-700 border-violet-300" },
  cyan:    { header: "bg-cyan-500",    badge: "bg-cyan-500/15 text-cyan-700 border-cyan-300" },
  emerald: { header: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-300" },
  red:     { header: "bg-red-500",     badge: "bg-red-500/15 text-red-700 border-red-300" },
};

export default function CobrancasPage() {
  const { user, isAdmin, isGerente, isFinanceiro } = useAuth();
  const canCreate = isAdmin || isFinanceiro;
  const [financeiroIds, setFinanceiroIds] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activities, setActivities] = useState<CobrancaActivity[]>([]);
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set());
  const [allStatuses, setAllStatuses] = useState<CrmStatus[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCobranca, setEditingCobranca] = useState<Cobranca | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({ nome: "", telefone: "", descricao: "" });
  const [formStatus, setFormStatus] = useState("");
  const [formAssigned, setFormAssigned] = useState("");
  const [formValor, setFormValor] = useState("");
  const [formCompanyId, setFormCompanyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("all");
  const [mobileTab, setMobileTab] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  const [refreshKey, setRefreshKey] = useState(0);

  const statusKeys = useMemo(() => statuses.map((s) => s.key), [statuses]);

  const columnFilter = useMemo(() => ({
    apply: (q: any) => {
      if (filterCompanyId !== "all") return q.eq("company_id", filterCompanyId);
      return q;
    },
  }), [filterCompanyId]);

  const buildSearchOr = useCallback((q: string) => {
    const safe = q.replace(/[%,()]/g, "");
    if (!safe) return null;
    return `data->>nome.ilike.%${safe}%,data->>telefone.ilike.%${safe}%,data->>descricao.ilike.%${safe}%`;
  }, []);

  const {
    columns: paginatedColumns,
    loadMore,
    updateItemStatus,
    removeItem,
    searchResults,
    searching,
    isSearching,
  } = usePaginatedColumns<Cobranca>({
    table: "crm_cobrancas",
    statusKeys,
    filter: columnFilter,
    searchQuery,
    buildSearchOr,
    refreshKey,
    pollingIntervalMs: 5000,
  });

  const loadMeta = useCallback(async () => {
    const [
      { data: sts }, { data: profs }, { data: comps }, { data: roles },
      { data: acts }, { data: notes }
    ] = await Promise.all([
      supabase.from("crm_cobranca_statuses").select("*").order("position"),
      supabase.rpc("get_profile_names"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("user_roles").select("user_id, role").eq("role", "financeiro"),
      supabase.from("cobranca_activities").select("id, cobranca_id, title, scheduled_date, completed_at"),
      supabase.from("crm_cobranca_notes").select("cobranca_id"),
    ]);
    const allSts = ((sts || []) as unknown) as CrmStatus[];
    setAllStatuses(allSts);
    // Financeiro só vê colunas marcadas como visíveis
    const visible = isFinanceiro && !isAdmin && !isGerente
      ? allSts.filter(s => s.financeiro_visible !== false)
      : allSts;
    setStatuses(visible);
    setProfiles((profs || []) as Profile[]);
    setCompanies((comps || []) as Company[]);
    setFinanceiroIds(new Set((roles || []).map((r: any) => r.user_id)));
    setActivities((acts || []) as CobrancaActivity[]);
    setNoteIds(new Set((notes || []).map((n: any) => n.cobranca_id)));
  }, [isFinanceiro, isAdmin, isGerente]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => {
    if (statuses.length > 0 && !mobileTab) setMobileTab(statuses[0].key);
  }, [statuses, mobileTab]);

  const statusOptions = statuses.map(s => s.key);

  const openCreate = (status?: string) => {
    setEditingCobranca(null);
    setFormData({ nome: "", telefone: "", descricao: "" });
    setFormStatus(status || statusOptions[0] || "pendente");
    setFormAssigned("");
    setFormValor("");
    setFormCompanyId(filterCompanyId !== "all" ? filterCompanyId : "");
    setDialogOpen(true);
  };

  const openEdit = (cobranca: Cobranca) => {
    setEditingCobranca(cobranca);
    setFormData(typeof cobranca.data === "object" ? cobranca.data : {});
    setFormStatus(cobranca.status);
    setFormAssigned(cobranca.assigned_to || "");
    setFormValor(String(cobranca.valor || ""));
    setFormCompanyId(cobranca.company_id || "");
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const valor = parseFloat(formValor) || 0;

    if (editingCobranca) {
      const statusChanged = editingCobranca.status !== formStatus;
      const nextData = {
        ...(formData || {}),
        status_entered_at: statusChanged
          ? new Date().toISOString()
          : ((formData as any)?.status_entered_at ?? (editingCobranca.data as any)?.status_entered_at ?? null),
        status_entered_status_key: formStatus,
      };
      const { error } = await supabase.from("crm_cobrancas").update({
        data: nextData, status: formStatus, assigned_to: formAssigned || null, valor,
        company_id: formCompanyId || null,
      }).eq("id", editingCobranca.id);
      if (error) toast.error("Erro ao atualizar");
      else toast.success("Cobrança atualizada");
    } else {
      const { data: created, error } = await supabase.from("crm_cobrancas").insert({
        data: {
          ...(formData || {}),
          status_entered_at: new Date().toISOString(),
          status_entered_status_key: formStatus,
        }, status: formStatus, assigned_to: formAssigned || null,
        created_by: user?.id, valor, company_id: formCompanyId || null,
      }).select().single();
      if (error) toast.error("Erro ao criar cobrança");
      else {
        toast.success("Cobrança criada — agora você pode adicionar comentários e tarefas");
        if (created) setEditingCobranca(created as Cobranca);
        const statusLabel = statuses.find((s) => s.key === formStatus)?.label ?? formStatus;
        await logTransition({
          cliente_nome: String((formData as any)?.nome ?? "Cliente"),
          from_module: "none",
          to_module: "cobranca",
          to_status_key: formStatus,
          to_status_label: statusLabel,
          target_record_id: (created as any)?.id ?? null,
          company_id: formCompanyId || null,
          triggered_by: user?.id ?? null,
          trigger_source: "manual",
        });
      }
    }
    setSaving(false);
    setRefreshKey((k) => k + 1);
  };

  const handleDelete = (id: string) => setDeleteConfirmId(id);

  const confirmBulkDelete = async () => {
    setBulkDeleting(true);
    let q = supabase.from("crm_cobrancas").delete().not("id", "is", null);
    if (filterCompanyId !== "all") q = q.eq("company_id", filterCompanyId);
    const { error } = await q;
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (error) toast.error("Erro ao excluir todos");
    else {
      toast.success("Cobranças excluídas");
      setRefreshKey((k) => k + 1);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    // Captura dados do card antes de excluir, para o log
    let snapshot: Cobranca | null = null;
    for (const k of Object.keys(paginatedColumns)) {
      const found = paginatedColumns[k]?.items.find((it) => it.id === deleteConfirmId);
      if (found) { snapshot = found as Cobranca; break; }
    }
    const { error } = await supabase.from("crm_cobrancas").delete().eq("id", deleteConfirmId);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Cobrança excluída");
      const statusLabel = statuses.find((s) => s.key === snapshot?.status)?.label ?? snapshot?.status ?? null;
      await logTransition({
        cliente_nome: String((snapshot?.data as any)?.nome ?? "Cliente"),
        from_module: "cobranca",
        to_module: "none",
        to_status_key: snapshot?.status ?? null,
        to_status_label: statusLabel,
        source_record_id: deleteConfirmId,
        company_id: snapshot?.company_id ?? null,
        triggered_by: user?.id ?? null,
        trigger_source: "manual",
      });
    }
    removeItem(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const fromStatus = result.source.droppableId;
    const cobrancaId = result.draggableId;
    if (newStatus === fromStatus) return;

    // Permissões de movimentação manual entre colunas:
    //  • Admin: pode tudo.
    //  • Financeiro: SOMENTE da coluna 16 ("180 dias — Ajuizar manualmente")
    //    para "Inadimplência sem ajuizamento (Manual)".
    //  • Gerente / vendedores / outros: bloqueado.
    const FINANCEIRO_FROM = "180_dias_ajuizar_manualmente";
    const FINANCEIRO_TO = "inadimplncia_sem_ajuizamento_manual";
    if (!isAdmin) {
      const financeiroAllowed =
        isFinanceiro && fromStatus === FINANCEIRO_FROM && newStatus === FINANCEIRO_TO;
      if (!financeiroAllowed) {
        if (isFinanceiro) {
          toast.error(
            "O Financeiro só pode mover cards da coluna 16 para 'Inadimplência sem ajuizamento'.",
          );
        } else {
          toast.error("Apenas administradores podem mover cobranças entre colunas.");
        }
        return;
      }
    }

    const item = paginatedColumns[fromStatus]?.items.find((it) => it.id === cobrancaId)
      || (searchResults || []).find((it) => it.id === cobrancaId);

    updateItemStatus(cobrancaId, fromStatus, newStatus, item);
    const nextData = {
      ...((item?.data && typeof item.data === "object") ? item.data : {}),
      status_entered_at: new Date().toISOString(),
      status_entered_status_key: newStatus,
    };
    await supabase.from("crm_cobrancas").update({ status: newStatus, data: nextData }).eq("id", cobrancaId);
  };

  const getProfileName = (userId: string | null) => {
    if (!userId) return "";
    return profiles.find(p => p.user_id === userId)?.full_name || "";
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return "";
    return companies.find(c => c.id === companyId)?.name || "";
  };

  // Compute task priority per cobranca: 3=overdue, 2=today, 1=future pending, 0=none
  const cobrancaTaskPriority = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    const todayStr = now.toDateString();
    activities.forEach((a) => {
      if (a.completed_at) return;
      const dt = new Date(a.scheduled_date);
      let prio = 1;
      if (dt < now) prio = 3;
      else if (dt.toDateString() === todayStr) prio = 2;
      const current = map.get(a.cobranca_id) || 0;
      if (prio > current) map.set(a.cobranca_id, prio);
    });
    return map;
  }, [activities]);

  // Cobrancas with recent interaction (completed task or notes) — go to the END when no pending task
  const cobrancasWithRecentActivity = useMemo(() => {
    const ids = new Set<string>();
    activities.filter(a => a.completed_at).forEach(a => ids.add(a.cobranca_id));
    noteIds.forEach(id => ids.add(id));
    return ids;
  }, [activities, noteIds]);

  // Ordena grupos pela MAIOR prioridade entre os itens do grupo
  const sortGroupsByTaskPriority = useCallback((groups: CobrancaGroup[]) => {
    const score = (g: CobrancaGroup) => {
      const allTreated = g.items.every((it) => (it.data as any)?.renegociou);
      const anyPrio = g.items.reduce((acc, it) => Math.max(acc, cobrancaTaskPriority.get(it.id) || 0), 0);
      const anyRecent = g.items.some((it) => cobrancasWithRecentActivity.has(it.id) || (it.data as any)?.tratativa_em);
      const maxTratativa = g.items.reduce((acc, it) => {
        const t = (it.data as any)?.tratativa_em;
        return t ? Math.max(acc, new Date(t).getTime()) : acc;
      }, 0);
      return { allTreated: allTreated ? 1 : 0, anyPrio, anyRecent: anyRecent ? 1 : 0, maxTratativa };
    };
    return [...groups].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa.allTreated !== sb.allTreated) return sa.allTreated - sb.allTreated;
      if (sa.anyPrio !== sb.anyPrio) return sb.anyPrio - sa.anyPrio;
      if (sa.anyRecent !== sb.anyRecent) return sa.anyRecent - sb.anyRecent;
      return sa.maxTratativa - sb.maxTratativa;
    });
  }, [cobrancaTaskPriority, cobrancasWithRecentActivity]);

  const companyNameById = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [companies]);

  // Agrupa TODAS as cobranças carregadas por CPF, atribuindo cada grupo ao status mais grave
  const allGroups = useMemo(() => {
    const all: Cobranca[] = [];
    if (isSearching) {
      all.push(...(searchResults || []));
    } else {
      Object.values(paginatedColumns).forEach((col) => {
        all.push(...(col?.items || []));
      });
    }
    const seen = new Set<string>();
    const unique = all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    return groupCobrancasByCpf(unique, allStatuses, companyNameById);
  }, [paginatedColumns, isSearching, searchResults, allStatuses, companyNameById]);

  const getByStatus = useCallback((key: string) => {
    const groupsForStatus = allGroups.filter((g) => g.representativeStatus === key);
    const sorted = sortGroupsByTaskPriority(groupsForStatus);
    if (isSearching) {
      return { groups: sorted, total: sorted.length, hasMore: false, loading: searching };
    }
    const col = paginatedColumns[key];
    return {
      groups: sorted,
      // Mostra o total real de cobranças no banco para esta coluna,
      // não apenas o número de grupos carregados em memória.
      total: typeof col?.total === "number" ? col.total : sorted.length,
      hasMore: col?.hasMore || false,
      loading: col?.loading || false,
    };
  }, [paginatedColumns, isSearching, searching, allGroups, sortGroupsByTaskPriority]);

  const totalDisplayed = useMemo(() => allGroups.length, [allGroups]);

  // Total real no banco (independente do que está carregado nas colunas)
  const [totalCount, setTotalCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = supabase
        .from("crm_cobrancas")
        .select("id", { count: "exact", head: true });
      if (filterCompanyId !== "all") q = q.eq("company_id", filterCompanyId);
      if (statusKeys.length > 0) q = q.in("status", statusKeys);
      const { count, error } = await q;
      if (!cancelled && !error) setTotalCount(count ?? 0);
    })();
    return () => { cancelled = false; };
  }, [filterCompanyId, statusKeys, refreshKey]);

  const handleColumnScroll = (e: React.UIEvent<HTMLDivElement>, statusKey: string) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore(statusKey);
  };

  const renderCard = (group: CobrancaGroup) => {
    const cobranca = group.representative;
    const d = cobranca.data as Record<string, any>;
    const grouped = group.items.length > 1;
    const valor = grouped ? group.valorTotal : Number(cobranca.valor || 0);

    // Estados visuais consideram TODOS os itens do grupo
    const groupItemIds = group.items.map((it) => it.id);
    const cobActivities = activities.filter((a) => groupItemIds.includes(a.cobranca_id));
    const pending = cobActivities.filter((a) => !a.completed_at);
    const overdue = pending.filter((a) => new Date(a.scheduled_date) < new Date());
    const today = pending.filter((a) => {
      const dt = new Date(a.scheduled_date);
      const now = new Date();
      return dt.toDateString() === now.toDateString() && dt >= now;
    });
    const hasOverdue = overdue.length > 0;
    const hasToday = today.length > 0;
    const hasPending = pending.length > 0 && !hasOverdue && !hasToday;

    // renegociou: se for grupo, considera "sim" só se TODOS sim; "nao" se algum nao
    const renegociouValues = group.items.map((it) => (it.data as any)?.renegociou ?? null);
    const renegociou: string | null = grouped
      ? (renegociouValues.every((v) => v === "sim")
          ? "sim"
          : renegociouValues.includes("nao")
            ? "nao"
            : null)
      : ((d?.renegociou as string | undefined) || null);

    let cardBorderClass = "";
    if (renegociou === "sim") cardBorderClass = "border-emerald-500 bg-emerald-500/10 shadow-emerald-500/20 shadow-md";
    else if (renegociou === "nao") cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
    else if (hasOverdue) cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
    else if (hasToday) cardBorderClass = "border-amber-400 bg-amber-500/5";
    else if (hasPending) cardBorderClass = "border-blue-400/50 bg-blue-500/5";

    const nextActivity = [...pending].sort(
      (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
    )[0];

    return (
      <div className={`bg-card border rounded-xl p-3 space-y-2 shadow-sm group ${cardBorderClass}`}>
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{d.nome || "Sem nome"}</p>
            {d.telefone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="h-3 w-3" />{formatPhoneBR(d.telefone)}
              </p>
            )}
            {(d.documento || d.cpf) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                CPF: {d.documento || d.cpf}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
            <Badge variant="outline" className="text-xs">
              R$ {valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </Badge>
            {grouped && (
              <Badge className="text-[10px] bg-primary/15 text-primary border border-primary/30 hover:bg-primary/20">
                {group.items.length} dívidas
              </Badge>
            )}
          </div>
        </div>

        {grouped ? (
          <div className="flex flex-wrap gap-1">
            {group.companies.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60"
              >
                <Building2 className="h-2.5 w-2.5" />{name}
              </span>
            ))}
          </div>
        ) : (
          cobranca.company_id && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" />{getCompanyName(cobranca.company_id)}
            </p>
          )
        )}

        {!grouped && d.descricao && (
          <p className="text-xs text-muted-foreground line-clamp-2">{d.descricao}</p>
        )}

        {!grouped && cobranca.assigned_to && (() => {
          const ap = profiles.find((p) => p.user_id === cobranca.assigned_to);
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
          {renegociou === "sim" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-emerald-600 px-2 py-0.5 rounded-full uppercase mr-1">
              ✅ Renegociou
            </span>
          )}
          {renegociou === "nao" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-red-600 px-2 py-0.5 rounded-full uppercase mr-1">
              ❌ Não renegociou
            </span>
          )}
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
            className="h-7 w-7"
            onClick={() => openEdit(cobranca)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!grouped && (isAdmin || isGerente) && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(cobranca.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
          <h1 className="text-xl sm:text-2xl font-bold">Cobranças</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gerencie as cobranças do sistema — {totalCount ?? totalDisplayed} registro{(totalCount ?? totalDisplayed) !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
            <SelectTrigger className="h-9 w-[180px]">
              <Building2 className="h-4 w-4 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Todas empresas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas empresas</SelectItem>
              {companies.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 w-full sm:w-48"
            />
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="mr-2 h-4 w-4" />Nova Cobrança
            </Button>
          )}
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
              <button
                key={status.key}
                onClick={() => setMobileTab(status.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  mobileTab === status.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
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
          const { groups, total, hasMore, loading } = getByStatus(status.key);
          return (
            <div key={status.key}>
              {groups.length === 0 && !loading && (
                <p className="text-center text-sm text-muted-foreground py-8">Nenhuma cobrança nesta coluna</p>
              )}
              {groups.map((g) => <div key={g.groupId} className="mb-2">{renderCard(g)}</div>)}
              {hasMore && (
                <button
                  onClick={() => loadMore(status.key)}
                  disabled={loading}
                  className="w-full py-2.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg border border-primary/30 mb-2 transition-colors"
                >
                  {loading ? "Carregando..." : "Carregar mais"}
                </button>
              )}
              {canCreate && (
                <button onClick={() => openCreate(status.key)} className="w-full py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors">
                  + Adicionar cobrança
                </button>
              )}
            </div>
          );
        })}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="hidden lg:flex gap-3 overflow-x-auto pb-4" style={{ height: "calc(100vh - 200px)" }}>
          {statuses.map(status => {
            const { groups, total, hasMore, loading } = getByStatus(status.key);
            const colors = colorMap[status.color] || colorMap.blue;
            return (
              <div key={status.key} className="flex-shrink-0 w-[280px] flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 px-1 flex-shrink-0">
                  <div className={`h-2.5 w-2.5 rounded-full ${colors.header}`} />
                  <h3 className="font-semibold text-sm text-foreground">{status.label}</h3>
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>
                    {total}
                  </span>
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
                      {groups.map((g, index) => {
                        const draggableDisabled = g.items.length > 1;
                        return (
                          <Draggable
                            key={g.groupId}
                            draggableId={g.representative.id}
                            index={index}
                            isDragDisabled={draggableDisabled}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={snapshot.isDragging ? "opacity-90 rotate-2" : ""}
                                onClick={() => {
                                  if (draggableDisabled) {
                                    // só dica visual; clique no lápis abre o seletor
                                  }
                                }}
                              >
                                {renderCard(g)}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                      {loading && groups.length === 0 && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {hasMore && (
                        <button
                          onClick={() => loadMore(status.key)}
                          disabled={loading}
                          className="w-full py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg border border-primary/30 transition-colors"
                        >
                          {loading ? "Carregando..." : "Carregar mais"}
                        </button>
                      )}
                      {canCreate && (
                        <button onClick={() => openCreate(status.key)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-card rounded-lg border border-dashed border-border/50 hover:border-border transition-colors">
                          + Adicionar cobrança
                        </button>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <CobrancaEditSheet
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) loadMeta(); }}
        cobrancaId={editingCobranca?.id || null}
        ssoticaClienteId={(editingCobranca as any)?.ssotica_cliente_id ?? null}
        ssoticaCompanyId={(editingCobranca as any)?.ssotica_company_id ?? null}
        formData={formData}
        setFormData={setFormData}
        formStatus={formStatus}
        setFormStatus={setFormStatus}
        formAssigned={formAssigned}
        setFormAssigned={setFormAssigned}
        formValor={formValor}
        setFormValor={setFormValor}
        formCompanyId={formCompanyId}
        setFormCompanyId={setFormCompanyId}
        statuses={statuses}
        profiles={profiles.filter(p => financeiroIds.has(p.user_id))}
        companies={companies}
        saving={saving}
        onSave={handleSave}
        canReassign={isAdmin || isGerente}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cobrança permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
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

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !bulkDeleting && setBulkDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir TODAS as cobranças?</AlertDialogTitle>
            <AlertDialogDescription>
              {filterCompanyId === "all"
                ? "Todos os cards de cobrança de todas as empresas serão removidos permanentemente."
                : "Todos os cards de cobrança da empresa filtrada serão removidos permanentemente."}
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
