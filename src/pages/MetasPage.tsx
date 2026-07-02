import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Target, Store, Users, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
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
  const [refreshing, setRefreshing] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [goals, setGoals] = useState<SalesGoal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [progressByGoal, setProgressByGoal] = useState<Record<string, number>>({});

  // Só carrega os dados cadastrais (metas, empresas, usuários) — leve e rápido.
  // O cálculo de "atingido" via SSótica é manual (botão "Atualizar vendas"),
  // para não ficar refazendo chamadas pesadas toda vez que a tela é aberta.
  useEffect(() => {
    if (!user?.id) return;
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

      const [compRes, profRes] = await Promise.all([
        supabase.from("companies").select("id, name").in("id", companyIds),
        userIds.length > 0
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
          : Promise.resolve({ data: [] as Profile[] }),
      ]);
      setCompanies((compRes.data as Company[]) || []);
      setProfiles((profRes.data as Profile[]) || []);
      setLoading(false);
    })();
  }, [user?.id]);

  const handleRefreshVendas = async () => {
    if (goals.length === 0) return;
    setRefreshing(true);
    try {
      const companyIds = Array.from(new Set(goals.map((g) => g.company_id)));
      const { data: mapRes } = await supabase
        .from("ssotica_user_mappings")
        .select("company_id, user_id, ssotica_funcionario_id")
        .in("company_id", companyIds);
      const mappings = (mapRes as Mapping[]) || [];

      // Uma chamada por combinação única de empresa+período (evita repetir para
      // metas individuais que compartilham a mesma loja/período).
      const uniquePeriods = new Map<string, { companyId: string; start: string; end: string }>();
      goals.forEach((g) => {
        const key = `${g.company_id}::${g.period_start}::${g.period_end}`;
        if (!uniquePeriods.has(key)) {
          uniquePeriods.set(key, { companyId: g.company_id, start: g.period_start, end: g.period_end });
        }
      });

      const vendasByKey = new Map<string, any[]>();
      let hadError = false;
      await Promise.all(
        Array.from(uniquePeriods.entries()).map(async ([key, p]) => {
          try {
            const { data, error: fnErr } = await supabase.functions.invoke("ssotica-vendas-periodo", {
              body: { startDate: p.start, endDate: p.end, companyId: p.companyId },
            });
            if (fnErr || data?.error) throw fnErr || new Error(data?.error);
            vendasByKey.set(key, data?.vendas || []);
          } catch (err) {
            hadError = true;
            console.error(`[metas] falha ao buscar vendas de ${p.companyId}`, err);
            vendasByKey.set(key, []);
          }
        }),
      );

      const progress: Record<string, number> = {};
      goals.forEach((g) => {
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
      setProgressLoaded(true);
      setLastUpdated(new Date());
      if (hadError) {
        toast.warning("Vendas atualizadas com algum erro — alguns valores podem estar incompletos");
      } else {
        toast.success("Vendas atualizadas com sucesso");
      }
    } finally {
      setRefreshing(false);
    }
  };

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

  const nomeDaLinha = (g: GoalWithProgress) =>
    g.scope === "company" ? (g.label || companyName(g.company_id)) : userName(g.user_id);

  const GoalsTable = ({ list }: { list: GoalWithProgress[] }) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Empresa</TableHead>
            <TableHead>Período</TableHead>
            <TableHead className="text-right">Meta</TableHead>
            <TableHead className="text-right">Atingido</TableHead>
            <TableHead className="text-right">Progresso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((g) => (
            <TableRow key={g.id}>
              <TableCell className="font-medium">
                {nomeDaLinha(g)}
                {g.scope === "user" && g.label && (
                  <div className="text-[11px] text-muted-foreground font-normal">{g.label}</div>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{companyName(g.company_id)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                {fmtDate(g.period_start)} a {fmtDate(g.period_end)}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">{fmtBRL(g.target_amount)}</TableCell>
              <TableCell className="text-right whitespace-nowrap">
                {progressLoaded ? fmtBRL(g.atingido) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Badge className="bg-primary/10 text-primary border-primary/30">
                  {progressLoaded ? `${g.pct.toFixed(2)}%` : "—"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Target className="h-6 w-6" />
              Metas
            </h1>
            <p className="text-sm text-muted-foreground">
              Acompanhe as metas de venda e o quanto já foi realizado no período.
            </p>
          </div>
          {goals.length > 0 && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={handleRefreshVendas} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Atualizando..." : "Atualizar vendas (SSótica)"}
              </Button>
              {lastUpdated && (
                <span className="text-xs text-muted-foreground">
                  Atualizado às {format(lastUpdated, "HH:mm")}
                </span>
              )}
            </div>
          )}
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
            {!progressLoaded && (
              <div className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
                Clique em "Atualizar vendas (SSótica)" para calcular o quanto já foi vendido no período.
              </div>
            )}

            {minhasMetas.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Minha meta
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <GoalsTable list={minhasMetas} />
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
                <CardContent>
                  <GoalsTable list={metasDaLoja} />
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
                <CardContent>
                  <GoalsTable list={metasDaEquipe} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
