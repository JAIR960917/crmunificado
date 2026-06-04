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
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endNext7Days = new Date(startToday);
      endNext7Days.setDate(endNext7Days.getDate() + 6);
      endNext7Days.setHours(23, 59, 59, 999);
      const endNext7DaysIso = endNext7Days.toISOString();

      // 1) IDs leves dos leads/renovações do usuário (sem o data pesado).
      const [leadIdsRes, renovIdsRes, leadFieldsRes, renovFieldsRes, leadStatusRes, renovStatusRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase
          .from("crm_renovacoes")
          .select("id", { count: "exact", head: true })
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase.from("crm_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_renovacao_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_statuses").select("key, label"),
        supabase.from("crm_renovacao_statuses").select("key, label"),
      ]);

      const leadFields = (leadFieldsRes.data || []) as LeadIdentityField[];
      const renovFields = (renovFieldsRes.data || []) as LeadIdentityField[];
      const leadStatuses = new Map(((leadStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));
      const renovStatuses = new Map(((renovStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));

      // 2) Tarefas pendentes: atrasadas (antes de agora) e próximos 7 dias (de agora até fim do 7º dia).
      const [leadOverdueRes, renovOverdueRes, leadUpcomingRes, renovUpcomingRes] = await Promise.all([
        supabase
          .from("lead_activities")
          .select("id, lead_id, title, scheduled_date")
          .is("completed_at", null)
          .lt("scheduled_date", nowIso)
          .order("scheduled_date", { ascending: true })
          .limit(2000),
        supabase
          .from("renovacao_activities")
          .select("id, renovacao_id, title, scheduled_date")
          .is("completed_at", null)
          .lt("scheduled_date", nowIso)
          .order("scheduled_date", { ascending: true })
          .limit(2000),
        supabase
          .from("lead_activities")
          .select("id, lead_id, title, scheduled_date")
          .is("completed_at", null)
          .gte("scheduled_date", nowIso)
          .lte("scheduled_date", endNext7DaysIso)
          .order("scheduled_date", { ascending: true })
          .limit(2000),
        supabase
          .from("renovacao_activities")
          .select("id, renovacao_id, title, scheduled_date")
          .is("completed_at", null)
          .gte("scheduled_date", nowIso)
          .lte("scheduled_date", endNext7DaysIso)
          .order("scheduled_date", { ascending: true })
          .limit(2000),
      ]);

      const leadOverdueActs: Activity[] = ((leadOverdueRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.lead_id, scheduled_date: a.scheduled_date, title: a.title,
      }));
      const renovOverdueActs: Activity[] = ((renovOverdueRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.renovacao_id, scheduled_date: a.scheduled_date, title: a.title,
      }));
      const leadUpcomingActs: Activity[] = ((leadUpcomingRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.lead_id, scheduled_date: a.scheduled_date, title: a.title,
      }));
      const renovUpcomingActs: Activity[] = ((renovUpcomingRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.renovacao_id, scheduled_date: a.scheduled_date, title: a.title,
      }));

      // 3) Buscar `data` apenas dos itens que têm atividade relevante.
      const neededLeadIds = Array.from(new Set([
        ...leadOverdueActs.map((a) => a.ref_id),
        ...leadUpcomingActs.map((a) => a.ref_id),
      ]));
      const neededRenovIds = Array.from(new Set([
        ...renovOverdueActs.map((a) => a.ref_id),
        ...renovUpcomingActs.map((a) => a.ref_id),
      ]));

      const [leadsRes, renovRes] = await Promise.all([
        neededLeadIds.length
          ? supabase.from("crm_leads").select("id, data, status").in("id", neededLeadIds)
          : Promise.resolve({ data: [] as any[] }),
        neededRenovIds.length
          ? supabase.from("crm_renovacoes").select("id, data, status").in("id", neededRenovIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (!mounted) return;

      const leadMap = new Map(((leadsRes.data || []) as Item[]).map((l) => [l.id, l]));
      const renovMap = new Map(((renovRes.data || []) as Item[]).map((r) => [r.id, r]));

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

      setLeadsCount(leadIdsRes.count ?? 0);
      setRenovCount(renovIdsRes.count ?? 0);
      setHojeRows(proximos);
      setAtrasadasRows(atr);
      setCounts({ hojeL: proximosL.size, hojeR: proximosR.size, atrL: atrL.size, atrR: atrR.size });
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user?.id]);

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
            label="Próximos 7 dias"
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
              Tarefas — próximos 7 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList rows={hojeRows} emptyText="Nenhuma tarefa nos próximos 7 dias." />
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
