/**
 * Meu Dashboard — Cobrança.
 * Mostra tarefas (cobranca_activities) do usuário logado: hoje e atrasadas.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { CalendarClock, AlertTriangle, Receipt, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Activity = {
  id: string;
  cobranca_id: string;
  scheduled_date: string;
  title: string;
};

type Cobranca = { id: string; data: any; status: string };
type StatusRow = { key: string; label: string };

type TaskRow = {
  id: string;
  cobrancaId: string;
  nome: string;
  statusLabel: string;
  scheduled: string;
  title: string;
};

export default function CobrancaDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hojeRows, setHojeRows] = useState<TaskRow[]>([]);
  const [atrasadasRows, setAtrasadasRows] = useState<TaskRow[]>([]);
  const [totalCobrancas, setTotalCobrancas] = useState(0);

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

      const [actsRes, cobCountRes, stsRes] = await Promise.all([
        supabase
          .from("cobranca_activities")
          .select("id, cobranca_id, title, scheduled_date")
          .is("completed_at", null)
          .lte("scheduled_date", endTodayIso)
          .eq("created_by", uid),
        supabase
          .from("crm_cobrancas")
          .select("id", { count: "exact", head: true })
          .eq("assigned_to", uid),
        supabase.from("crm_cobranca_statuses").select("key, label"),
      ]);

      const acts: Activity[] = (actsRes.data || []) as any[];
      const statusMap = new Map(((stsRes.data || []) as StatusRow[]).map((s) => [s.key, s.label]));

      const neededIds = Array.from(new Set(acts.map((a) => a.cobranca_id)));
      const cobsRes = neededIds.length
        ? await supabase.from("crm_cobrancas").select("id, data, status").in("id", neededIds)
        : { data: [] as any[] };

      if (!mounted) return;
      const cobMap = new Map(((cobsRes.data || []) as Cobranca[]).map((c) => [c.id, c]));

      const buildRow = (a: Activity): TaskRow | null => {
        const c = cobMap.get(a.cobranca_id);
        if (!c) return null;
        const d = c.data || {};
        return {
          id: a.id,
          cobrancaId: c.id,
          nome: String(d.nome || "(sem nome)"),
          statusLabel: statusMap.get(c.status) || c.status,
          scheduled: a.scheduled_date,
          title: a.title,
        };
      };

      const hoje: TaskRow[] = [];
      const atr: TaskRow[] = [];
      for (const a of acts) {
        const row = buildRow(a);
        if (!row) continue;
        const dt = new Date(a.scheduled_date);
        if (dt >= startToday && dt <= endToday) hoje.push(row);
        else if (dt < startToday) atr.push(row);
      }
      hoje.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());
      atr.sort((a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime());

      setHojeRows(hoje);
      setAtrasadasRows(atr);
      setTotalCobrancas(cobCountRes.count ?? 0);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  const StatCard = ({ icon: Icon, label, value, tone }: any) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );

  const TaskList = ({ rows, emptyText }: { rows: TaskRow[]; emptyText: string }) => {
    if (rows.length === 0) {
      return <div className="text-sm text-muted-foreground py-6 text-center">{emptyText}</div>;
    }
    return (
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-3 py-3 hover:bg-muted/50 hover:border-primary/40 transition-colors cursor-pointer"
            onClick={() => navigate("/cobrancas")}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{r.nome}</div>
              <div className="text-xs text-muted-foreground truncate">{r.title}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
          <h1 className="text-2xl font-bold">Meu Dashboard — Cobrança</h1>
          <p className="text-sm text-muted-foreground">Suas tarefas de cobrança agendadas e atrasadas.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            icon={CalendarClock}
            label="Tarefas para hoje"
            value={loading ? "…" : hojeRows.length}
            tone="text-blue-500"
          />
          <StatCard
            icon={AlertTriangle}
            label="Tarefas atrasadas"
            value={loading ? "…" : atrasadasRows.length}
            tone="text-red-500"
          />
          <StatCard
            icon={Receipt}
            label="Minhas cobranças"
            value={loading ? "…" : totalCobrancas}
            tone="text-emerald-500"
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
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <TaskList rows={hojeRows} emptyText="Nenhuma tarefa para hoje." />
            )}
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
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <TaskList rows={atrasadasRows} emptyText="Sem tarefas atrasadas. 🎉" />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
