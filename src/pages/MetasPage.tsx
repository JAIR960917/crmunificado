import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Target, Store, Users } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

type Scope = "user" | "company";
type SalesGoal = {
  id: string;
  scope: Scope;
  company_id: string;
  user_id: string | null;
  label: string | null;
  period_start: string;
  period_end: string;
  target_amount: number;
};
type Company = { id: string; name: string };
type Profile = { user_id: string; full_name: string };
type Mapping = { company_id: string; user_id: string; ssotica_funcionario_id: number };

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => format(new Date(d + "T00:00:00"), "dd/MM/yyyy");

type GoalWithProgress = SalesGoal & { atingido: number; pct: number };

export default function MetasPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<SalesGoal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [progressByGoal, setProgressByGoal] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);

      // RLS já restringe: admin vê tudo; usuário vê a própria meta + meta da(s)
      // loja(s) a que pertence; gerente vê também a meta de toda a equipe das
      // lojas que administra.
      const { data: goalRows, error } = await supabase
        .from("sales_goals")
        .select("*")
        .order("period_start", { ascending: false });

      if (error || !goalRows || goalRows.length === 0) {
        setGoals([]);
        setLoading(false);
        return;
      }

      const gs = goalRows as SalesGoal[];
      setGoals(gs);

      const companyIds = Array.from(new Set(gs.map((g) => g.company_id)));
      const userIds = Array.from(new Set(gs.map((g) => g.user_id).filter((x): x is string => !!x)));

      const [compRes, profRes, mapRes] = await Promise.all([
        supabase.from("companies").select("id, name").in("id", companyIds),
        userIds.length > 0
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        supabase
          .from("ssotica_user_mappings")
          .select("company_id, user_id, ssotica_funcionario_id")
          .in("company_id", companyIds),
      ]);
      setCompanies((compRes.data as Company[]) || []);
      setProfiles((profRes.data as Profile[]) || []);
      const mappings = (mapRes.data as Mapping[]) || [];

      // Um chamada por combinação única de empresa+período (evita repetir para
      // metas individuais que compartilham a mesma loja/período).
      const uniquePeriods = new Map<string, { companyId: string; start: string; end: string }>();
      gs.forEach((g) => {
        const key = `${g.company_id}::${g.period_start}::${g.period_end}`;
        if (!uniquePeriods.has(key)) {
          uniquePeriods.set(key, { companyId: g.company_id, start: g.period_start, end: g.period_end });
        }
      });

      const vendasByKey = new Map<string, any[]>();
      await Promise.all(
        Array.from(uniquePeriods.entries()).map(async ([key, p]) => {
          try {
            const { data, error: fnErr } = await supabase.functions.invoke("ssotica-vendas-periodo", {
              body: { startDate: p.start, endDate: p.end, companyId: p.companyId },
            });
            if (fnErr || data?.error) throw fnErr || new Error(data?.error);
            vendasByKey.set(key, data?.vendas || []);
          } catch (err) {
            console.error(`[metas] falha ao buscar vendas de ${p.companyId}`, err);
            vendasByKey.set(key, []);
          }
        }),
      );

      const progress: Record<string, number> = {};
      gs.forEach((g) => {
        const key = `${g.company_id}::${g.period_start}::${g.period_end}`;
        const vendas = vendasByKey.get(key) || [];
        if (g.scope === "company") {
          progress[g.id] = vendas.reduce((acc, v) => acc + Number(v.valor_liquido || 0), 0);
        } else {
          const mapping = mappings.find((m) => m.company_id === g.company_id && m.user_id === g.user_id);
          if (!mapping) {
            progress[g.id] = 0;
            return;
          }
          progress[g.id] = vendas
            .filter((v) => v.funcionario?.id === mapping.ssotica_funcionario_id)
            .reduce((acc, v) => acc + Number(v.valor_liquido || 0), 0);
        }
      });
      setProgressByGoal(progress);
      setLoading(false);
    })();
  }, [user]);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || "—";
  const userName = (id: string | null) => profiles.find((p) => p.user_id === id)?.full_name || "—";

  const withProgress = (list: SalesGoal[]): GoalWithProgress[] =>
    list.map((g) => {
      const atingido = progressByGoal[g.id] ?? 0;
      const pct = g.target_amount > 0 ? (atingido / g.target_amount) * 100 : 0;
      return { ...g, atingido, pct };
    });

  const minhasMetas = useMemo(
    () => withProgress(goals.filter((g) => g.scope === "user" && g.user_id === user?.id)),
    [goals, progressByGoal, user],
  );
  const metasDaLoja = useMemo(
    () => withProgress(goals.filter((g) => g.scope === "company")),
    [goals, progressByGoal],
  );
  const metasDaEquipe = useMemo(
    () => withProgress(goals.filter((g) => g.scope === "user" && g.user_id !== user?.id)),
    [goals, progressByGoal, user],
  );

  const GoalCard = ({ g, title }: { g: GoalWithProgress; title: string }) => {
    const pctClamped = Math.min(100, Math.max(0, g.pct));
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">
              {companyName(g.company_id)} · {fmtDate(g.period_start)} a {fmtDate(g.period_end)}
            </div>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/30">
            {g.pct.toFixed(2)}%
          </Badge>
        </div>
        <Progress value={pctClamped} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Atingido: <span className="font-medium text-foreground">{fmtBRL(g.atingido)}</span>
          </span>
          <span className="text-muted-foreground">
            Meta: <span className="font-medium text-foreground">{fmtBRL(g.target_amount)}</span>
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Falta {fmtBRL(Math.max(0, g.target_amount - g.atingido))} para atingir a meta.
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6" />
            Metas
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe suas metas de venda e o quanto já foi realizado no período.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando metas...
          </div>
        ) : goals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nenhuma meta cadastrada para você ainda.
            </CardContent>
          </Card>
        ) : (
          <>
            {minhasMetas.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Minha meta
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {minhasMetas.map((g) => (
                    <GoalCard key={g.id} g={g} title={g.label || "Minha meta"} />
                  ))}
                </CardContent>
              </Card>
            )}

            {metasDaLoja.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Meta da loja
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metasDaLoja.map((g) => (
                    <GoalCard key={g.id} g={g} title={g.label || companyName(g.company_id)} />
                  ))}
                </CardContent>
              </Card>
            )}

            {(isGerente || isAdmin) && metasDaEquipe.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {isGerente ? "Metas da equipe" : "Todas as metas"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {metasDaEquipe.map((g) => (
                    <GoalCard key={g.id} g={g} title={g.label || userName(g.user_id)} />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
