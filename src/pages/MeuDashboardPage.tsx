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

type Activity = { id: string; ref_id: string; scheduled_date: string; completed_at: string | null; title: string };
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
  const [leads, setLeads] = useState<Item[]>([]);
  const [renovacoes, setRenovacoes] = useState<Item[]>([]);
  const [leadActs, setLeadActs] = useState<Activity[]>([]);
  const [renovActs, setRenovActs] = useState<Activity[]>([]);
  const [leadFields, setLeadFields] = useState<LeadIdentityField[]>([]);
  const [renovFields, setRenovFields] = useState<LeadIdentityField[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<Map<string, string>>(new Map());
  const [renovStatuses, setRenovStatuses] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      const uid = user.id;
      const [leadsRes, renovRes, leadFieldsRes, renovFieldsRes, leadStatusRes, renovStatusRes] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, data, status, assigned_to, created_by")
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase
          .from("crm_renovacoes")
          .select("id, data, status, assigned_to, created_by")
          .neq("status", "excluidos")
          .or(`assigned_to.eq.${uid},created_by.eq.${uid}`),
        supabase.from("crm_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_renovacao_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_statuses").select("key, label"),
        supabase.from("crm_renovacao_statuses").select("key, label"),
      ]);

      const leadsData = (leadsRes.data || []) as Item[];
      const renovData = (renovRes.data || []) as Item[];
      const leadIds = leadsData.map((l) => l.id);
      const renovIds = renovData.map((r) => r.id);

      const [leadActsRes, renovActsRes] = await Promise.all([
        leadIds.length
          ? supabase
              .from("lead_activities")
              .select("id, lead_id, title, scheduled_date, completed_at")
              .is("completed_at", null)
              .in("lead_id", leadIds)
          : Promise.resolve({ data: [] as any[] }),
        renovIds.length
          ? supabase
              .from("renovacao_activities")
              .select("id, renovacao_id, title, scheduled_date, completed_at")
              .is("completed_at", null)
              .in("renovacao_id", renovIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (!mounted) return;
      setLeads(leadsData);
      setRenovacoes(renovData);
      setLeadFields((leadFieldsRes.data || []) as any);
      setRenovFields((renovFieldsRes.data || []) as any);
      setLeadStatuses(new Map(((leadStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label])));
      setRenovStatuses(new Map(((renovStatusRes.data || []) as StatusRow[]).map((s) => [s.key, s.label])));
      setLeadActs(
        ((leadActsRes.data || []) as any[]).map((a) => ({
          id: a.id, ref_id: a.lead_id, scheduled_date: a.scheduled_date, completed_at: a.completed_at, title: a.title,
        })),
      );
      setRenovActs(
        ((renovActsRes.data || []) as any[]).map((a) => ({
          id: a.id, ref_id: a.renovacao_id, scheduled_date: a.scheduled_date, completed_at: a.completed_at, title: a.title,
        })),
      );
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  const { hojeRows, atrasadasRows, hojeLeadsCount, hojeRenovCount, atrasadasLeadsCount, atrasadasRenovCount } = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const leadMap = new Map(leads.map((l) => [l.id, l]));
    const renovMap = new Map(renovacoes.map((r) => [r.id, r]));

    const buildRow = (kind: "lead" | "renovacao", act: Activity): TaskRow | null => {
      const item = kind === "lead" ? leadMap.get(act.ref_id) : renovMap.get(act.ref_id);
      if (!item) return null;
      const fields = kind === "lead" ? leadFields : renovFields;
      const statuses = kind === "lead" ? leadStatuses : renovStatuses;
      const { nome } = resolveLeadIdentity(item.data || {}, fields);
      return {
        kind,
        id: item.id,
        nome: nome || "(sem nome)",
        statusLabel: statuses.get(item.status) || item.status,
        scheduled: act.scheduled_date,
        title: act.title,
      };
    };

    const hojeLeadIds = new Set<string>();
    const hojeRenovIds = new Set<string>();
    const atrLeadIds = new Set<string>();
    const atrRenovIds = new Set<string>();
    const hoje: TaskRow[] = [];
    const atrasadas: TaskRow[] = [];

    const ingest = (kind: "lead" | "renovacao", acts: Activity[]) => {
      for (const a of acts) {
        const d = new Date(a.scheduled_date);
        const row = buildRow(kind, a);
        if (!row) continue;
        if (d >= startToday && d <= endToday) {
          hoje.push(row);
          (kind === "lead" ? hojeLeadIds : hojeRenovIds).add(row.id);
        } else if (d < startToday) {
          atrasadas.push(row);
          (kind === "lead" ? atrLeadIds : atrRenovIds).add(row.id);
        }
      }
    };
    ingest("lead", leadActs);
    ingest("renovacao", renovActs);

    hoje.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());
    atrasadas.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());

    return {
      hojeRows: hoje,
      atrasadasRows: atrasadas,
      hojeLeadsCount: hojeLeadIds.size,
      hojeRenovCount: hojeRenovIds.size,
      atrasadasLeadsCount: atrLeadIds.size,
      atrasadasRenovCount: atrRenovIds.size,
    };
  }, [leads, renovacoes, leadActs, renovActs, leadFields, renovFields, leadStatuses, renovStatuses]);

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
      <ul className="divide-y">
        {rows.map((r, i) => (
          <li
            key={`${r.kind}-${r.id}-${i}`}
            className="py-3 flex items-center justify-between gap-3 hover:bg-muted/50 px-2 rounded cursor-pointer"
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
            sub={`${hojeLeadsCount} leads · ${hojeRenovCount} renovações`}
            tone="text-blue-500"
          />
          <StatCard
            icon={AlertTriangle}
            label="Tarefas atrasadas"
            value={loading ? "…" : atrasadasRows.length}
            sub={`${atrasadasLeadsCount} leads · ${atrasadasRenovCount} renovações`}
            tone="text-red-500"
          />
          <StatCard
            icon={Users}
            label="Meus leads"
            value={loading ? "…" : leads.length}
            tone="text-emerald-500"
          />
          <StatCard
            icon={RefreshCw}
            label="Minhas renovações"
            value={loading ? "…" : renovacoes.length}
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
