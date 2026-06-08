/**
 * Meu Dashboard — visão pessoal do usuário com suas tarefas e totais.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { resolveLeadIdentity, type LeadIdentityField } from "@/lib/leadIdentity";
import { CalendarClock, AlertTriangle, Users, RefreshCw } from "lucide-react";
import AttendanceReportCard from "@/components/dashboard/AttendanceReportCard";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Activity = { id: string; ref_id: string; scheduled_date: string; title: string };
type Item = { id: string; data: any; status: string };
type StatusRow = { key: string; label: string };

type TaskRow = {
  kind: "lead" | "renovacao";
  id: string;
  nome: string;
  statusLabel: string;
  scheduled: string;
  title: string;
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function fetchPendingActivities(
  table: "lead_activities" | "renovacao_activities",
  fk: "lead_id" | "renovacao_id",
  parentIds: string[],
  mode: "overdue" | "upcoming",
  nowIso: string,
) {
  if (parentIds.length === 0) return [] as Activity[];
  const rows: Activity[] = [];
  for (const ids of chunk(parentIds, 100)) {
    let query = supabase
      .from(table)
      .select(`id, ${fk}, title, scheduled_date`)
      .in(fk, ids)
      .is("completed_at", null)
      .order("scheduled_date", { ascending: true });
    query = mode === "overdue"
      ? query.lt("scheduled_date", nowIso)
      : query.gte("scheduled_date", nowIso);
    const { data, error } = await query;
    if (error) throw error;
    for (const a of data || []) {
      const row = a as Record<string, string>;
      rows.push({
        id: row.id,
        ref_id: row[fk],
        scheduled_date: row.scheduled_date,
        title: row.title,
      });
    }
  }
  return rows;
}

export default function MeuDashboardPage() {
  const { user, isGerente, isAdmin } = useAuth();
  const navigate = useNavigate();
  const isGerenteView = isGerente && !isAdmin;
  const [loading, setLoading] = useState(true);
  const [leadsCount, setLeadsCount] = useState(0);
  const [renovCount, setRenovCount] = useState(0);
  const [hojeRows, setHojeRows] = useState<TaskRow[]>([]);
  const [atrasadasRows, setAtrasadasRows] = useState<TaskRow[]>([]);
  const [counts, setCounts] = useState({ hojeL: 0, hojeR: 0, atrL: 0, atrR: 0 });

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      const uid = user.id;
      const now = new Date();
      const nowIso = now.toISOString();

      const scopeOr = async (): Promise<string> => {
        if (!isGerenteView) return `assigned_to.eq.${uid},created_by.eq.${uid}`;
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("user_id", uid)
          .maybeSingle();
        const companyId = (profile as { company_id?: string | null } | null)?.company_id;
        if (!companyId) return `assigned_to.eq.${uid},created_by.eq.${uid}`;
        const { data: team } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("company_id", companyId);
        const teamIds = Array.from(new Set((team || []).map((p: { user_id: string }) => p.user_id)));
        if (teamIds.length === 0) return `assigned_to.eq.${uid},created_by.eq.${uid}`;
        return teamIds.flatMap((id) => [`assigned_to.eq.${id}`, `created_by.eq.${id}`]).join(",");
      };

      const ownerFilter = await scopeOr();

      const [leadsRes, renovRes, leadFieldsRes, renovFieldsRes, leadStatusRes, renovStatusRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, data, status")
          .neq("status", "excluidos")
          .or(ownerFilter),
        supabase
          .from("crm_renovacoes")
          .select("id, data, status")
          .neq("status", "excluidos")
          .or(ownerFilter),
        supabase.from("crm_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_renovacao_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_statuses").select("key, label"),
        supabase.from("crm_renovacao_statuses").select("key, label"),
      ]);

      const leadFields = (leadFieldsRes.data || []) as LeadIdentityField[];
      const renovFields = (renovFieldsRes.data || []) as LeadIdentityField[];
      const leadStatuses = new Map(((leadStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));
      const renovStatuses = new Map(((renovStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));

      const leads = (leadsRes.data || []) as Item[];
      const renovacoes = (renovRes.data || []) as Item[];
      const leadIds = leads.map((l) => l.id);
      const renovIds = renovacoes.map((r) => r.id);

      const [leadOverdueActs, renovOverdueActs, leadUpcomingActs, renovUpcomingActs] = await Promise.all([
        fetchPendingActivities("lead_activities", "lead_id", leadIds, "overdue", nowIso),
        fetchPendingActivities("renovacao_activities", "renovacao_id", renovIds, "overdue", nowIso),
        fetchPendingActivities("lead_activities", "lead_id", leadIds, "upcoming", nowIso),
        fetchPendingActivities("renovacao_activities", "renovacao_id", renovIds, "upcoming", nowIso),
      ]);

      if (!mounted) return;

      const leadMap = new Map(leads.map((l) => [l.id, l]));
      const renovMap = new Map(renovacoes.map((r) => [r.id, r]));

      const buildRow = (kind: "lead" | "renovacao", act: Activity): TaskRow | null => {
        const item = kind === "lead" ? leadMap.get(act.ref_id) : renovMap.get(act.ref_id);
        if (!item) return null;
        const fields = kind === "lead" ? leadFields : renovFields;
        const statuses = kind === "lead" ? leadStatuses : renovStatuses;
        const { nome } = resolveLeadIdentity(item.data || {}, fields);
        return {
          kind, id: item.id, nome: nome || "(sem nome)",
          statusLabel: statuses.get(item.status) || item.status,
          scheduled: act.scheduled_date, title: act.title,
        };
      };

      const proximos: TaskRow[] = [];
      const atr: TaskRow[] = [];
      const proximosL = new Set<string>(), proximosR = new Set<string>();
      const atrL = new Set<string>(), atrR = new Set<string>();

      const ingestList = (
        kind: "lead" | "renovacao",
        acts: Activity[],
        target: TaskRow[],
        idSet: Set<string>,
      ) => {
        for (const a of acts) {
          const row = buildRow(kind, a);
          if (!row) continue;
          target.push(row);
          idSet.add(row.id);
        }
      };

      ingestList("lead", leadOverdueActs, atr, atrL);
      ingestList("renovacao", renovOverdueActs, atr, atrR);
      ingestList("lead", leadUpcomingActs, proximos, proximosL);
      ingestList("renovacao", renovUpcomingActs, proximos, proximosR);

      proximos.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());
      atr.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());

      setLeadsCount(leads.length);
      setRenovCount(renovacoes.length);
      setHojeRows(proximos);
      setAtrasadasRows(atr);
      setCounts({ hojeL: proximosL.size, hojeR: proximosR.size, atrL: atrL.size, atrR: atrR.size });
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user?.id, isGerenteView]);

  const goTo = (row: TaskRow) => {
    navigate(row.kind === "lead" ? "/" : "/clientes-ativos");
  };

  const StatCard = ({ icon: Icon, label, value, sub, tone }: any) => (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4 sm:p-6 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{label}</CardTitle>
        <Icon className={`h-4 w-4 shrink-0 ${tone || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="text-2xl sm:text-3xl font-bold">{value}</div>
        {sub && <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 leading-snug">{sub}</p>}
      </CardContent>
    </Card>
  );

  const TaskList = ({ rows, emptyText }: { rows: TaskRow[]; emptyText: string }) => {
    if (rows.length === 0) {
      return <div className="text-sm text-muted-foreground py-6 text-center">{emptyText}</div>;
    }
    return (
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li
            key={`${r.kind}-${r.id}-${i}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-3 py-3 hover:bg-muted/50 hover:border-primary/40 transition-colors cursor-pointer"
            onClick={() => goTo(r)}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{r.nome}</div>
              <div className="text-xs text-muted-foreground truncate">{r.title}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs">
                {r.kind === "lead" ? "Leads" : "Renovação"}
              </Badge>
              <Badge variant="secondary" className="text-xs">{r.statusLabel}</Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline w-24 text-right">
                {format(new Date(r.scheduled), "dd/MM HH:mm", { locale: ptBR })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Meu Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {isGerenteView
              ? "Suas tarefas e métricas dos vendedores da sua loja."
              : "Suas tarefas e atribuições."}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            icon={CalendarClock}
            label="Tarefas pendentes"
            value={loading ? "…" : hojeRows.length}
            sub={`${counts.hojeL} leads · ${counts.hojeR} renovações`}
            tone="text-blue-500"
          />
          <StatCard
            icon={AlertTriangle}
            label="Tarefas atrasadas"
            value={loading ? "…" : atrasadasRows.length}
            sub={`${counts.atrL} leads · ${counts.atrR} renovações`}
            tone="text-red-500"
          />
          <StatCard
            icon={Users}
            label="Meus leads"
            value={loading ? "…" : leadsCount}
            tone="text-emerald-500"
          />
          <StatCard
            icon={RefreshCw}
            label="Minhas renovações"
            value={loading ? "…" : renovCount}
            tone="text-amber-500"
          />
        </div>

        {user && (
          <AttendanceReportCard
            mode={isGerenteView ? "gerente" : "vendedor"}
            userId={user.id}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-500" />
              Tarefas pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList rows={hojeRows} emptyText="Nenhuma tarefa pendente." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Tarefas atrasadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList rows={atrasadasRows} emptyText="Sem tarefas atrasadas. 🎉" />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
