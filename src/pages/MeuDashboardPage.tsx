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
  const { user } = useAuth();
  const navigate = useNavigate();
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
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const endTodayIso = endToday.toISOString();

      // 1) IDs leves dos leads/renovações do usuário (sem o data pesado).
      const [leadIdsRes, renovIdsRes, leadFieldsRes, renovFieldsRes, leadStatusRes, renovStatusRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id", { count: "exact" })
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase
          .from("crm_renovacoes")
          .select("id", { count: "exact" })
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase.from("crm_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_renovacao_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_statuses").select("key, label"),
        supabase.from("crm_renovacao_statuses").select("key, label"),
      ]);

      const leadIds = (leadIdsRes.data || []).map((r: any) => r.id as string);
      const renovIds = (renovIdsRes.data || []).map((r: any) => r.id as string);
      const leadFields = (leadFieldsRes.data || []) as LeadIdentityField[];
      const renovFields = (renovFieldsRes.data || []) as LeadIdentityField[];
      const leadStatuses = new Map(((leadStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));
      const renovStatuses = new Map(((renovStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));

      // 2) Apenas atividades pendentes até o fim de hoje (hoje + atrasadas).
      const [leadActsRes, renovActsRes] = await Promise.all([
        leadIds.length
          ? supabase
              .from("lead_activities")
              .select("id, lead_id, title, scheduled_date")
              .is("completed_at", null)
              .lte("scheduled_date", endTodayIso)
              .in("lead_id", leadIds)
          : Promise.resolve({ data: [] as any[] }),
        renovIds.length
          ? supabase
              .from("renovacao_activities")
              .select("id, renovacao_id, title, scheduled_date")
              .is("completed_at", null)
              .lte("scheduled_date", endTodayIso)
              .in("renovacao_id", renovIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const leadActs: Activity[] = ((leadActsRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.lead_id, scheduled_date: a.scheduled_date, title: a.title,
      }));
      const renovActs: Activity[] = ((renovActsRes.data || []) as any[]).map((a) => ({
        id: a.id, ref_id: a.renovacao_id, scheduled_date: a.scheduled_date, title: a.title,
      }));

      // 3) Buscar `data` apenas dos itens que têm atividade relevante.
      const neededLeadIds = Array.from(new Set(leadActs.map((a) => a.ref_id)));
      const neededRenovIds = Array.from(new Set(renovActs.map((a) => a.ref_id)));

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

      const hoje: TaskRow[] = [];
      const atr: TaskRow[] = [];
      const hojeL = new Set<string>(), hojeR = new Set<string>();
      const atrL = new Set<string>(), atrR = new Set<string>();
      const ingest = (kind: "lead" | "renovacao", acts: Activity[]) => {
        for (const a of acts) {
          const d = new Date(a.scheduled_date);
          const row = buildRow(kind, a);
          if (!row) continue;
          if (d >= startToday && d <= endToday) {
            hoje.push(row);
            (kind === "lead" ? hojeL : hojeR).add(row.id);
          } else if (d < startToday) {
            atr.push(row);
            (kind === "lead" ? atrL : atrR).add(row.id);
          }
        }
      };
      ingest("lead", leadActs);
      ingest("renovacao", renovActs);
      hoje.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());
      atr.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());

      setLeadsCount(leadIdsRes.count ?? leadIds.length);
      setRenovCount(renovIdsRes.count ?? renovIds.length);
      setHojeRows(hoje);
      setAtrasadasRows(atr);
      setCounts({ hojeL: hojeL.size, hojeR: hojeR.size, atrL: atrL.size, atrR: atrR.size });
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  const goTo = (row: TaskRow) => {
    navigate(row.kind === "lead" ? "/" : "/clientes-ativos");
  };

  const StatCard = ({ icon: Icon, label, value, sub, tone }: any) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
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
          <p className="text-sm text-muted-foreground">Suas tarefas e atribuições.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={CalendarClock}
            label="Tarefas para hoje"
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-500" />
              Tarefas de hoje
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList rows={hojeRows} emptyText="Nenhuma tarefa para hoje." />
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
