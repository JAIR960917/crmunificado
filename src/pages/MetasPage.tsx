import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Target, Store, Users, RefreshCw, AlertTriangle } from "lucide-react";
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
  atingido_amount: number;
  atingido_updated_at: string | null;
};
type Company = { id: string; name: string };
type Profile = { user_id: string; full_name: string };
type Mapping = { company_id: string; user_id: string; ssotica_funcionario_id: number };

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => format(new Date(d + "T00:00:00"), "dd/MM/yyyy");

type GoalWithPct = SalesGoal & { pct: number };

export default function MetasPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [goals, setGoals] = useState<SalesGoal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // Os valores "atingido" ficam salvos na própria meta (sales_goals.atingido_amount),
  // atualizados só pelo admin (botão abaixo). Vendedores/gerentes apenas leem o que
  // já está salvo — não precisam (nem têm acesso) para puxar a SSótica sozinhos.
  const fetchGoals = async () => {
    setLoading(true);
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
    setMappings((mapRes.data as Mapping[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;
    void fetchGoals();
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
      const freshMappings = (mapRes as Mapping[]) || [];
      setMappings(freshMappings);

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

      const nowIso = new Date().toISOString();
      const updates = goals.map((g) => {
        const key = `${g.company_id}::${g.period_start}::${g.period_end}`;
        const vendas = vendasByKey.get(key) || [];
        let atingido = 0;
        if (g.scope === "company") {
          atingido = vendas.reduce((acc, v) => acc + Number(v.valor_liquido || 0), 0);
        } else {
          const mapping = freshMappings.find((m) => m.company_id === g.company_id && m.user_id === g.user_id);
          if (mapping) {
            atingido = vendas
              .filter((v) => v.funcionario?.id === mapping.ssotica_funcionario_id)
              .reduce((acc, v) => acc + Number(v.valor_liquido || 0), 0);
          }
        }
        return { id: g.id, atingido };
      });

      // Persiste no banco — assim vendedores/gerentes veem o valor atualizado
      // sem precisar (nem ter acesso) para puxar a SSótica.
      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from("sales_goals")
            .update({ atingido_amount: u.atingido, atingido_updated_at: nowIso })
            .eq("id", u.id),
        ),
      );
      const saveError = results.find((r) => r.error);
      if (saveError?.error) throw saveError.error;

      setGoals((prev) =>
        prev.map((g) => {
          const u = updates.find((x) => x.id === g.id);
          return u ? { ...g, atingido_amount: u.atingido, atingido_updated_at: nowIso } : g;
        }),
      );

      if (hadError) {
        toast.warning("Vendas atualizadas com algum erro — alguns valores podem estar incompletos");
      } else {
        toast.success("Vendas atualizadas com sucesso");
      }
    } catch (err: any) {
      toast.error("Erro ao atualizar vendas", { description: err?.message ?? String(err) });
    } finally {
      setRefreshing(false);
    }
  };

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || "—";
  const userName = (id: string | null) => profiles.find((p) => p.user_id === id)?.full_name || "—";

  const withPct = (list: SalesGoal[]): GoalWithPct[] =>
    list.map((g) => ({
      ...g,
      pct: g.target_amount > 0 ? (g.atingido_amount / g.target_amount) * 100 : 0,
    }));

  const minhasMetas = useMemo(
    () => withPct(goals.filter((g) => g.scope === "user" && g.user_id === user?.id)),
    [goals, user],
  );
  const metasDaLoja = useMemo(
    () => withPct(goals.filter((g) => g.scope === "company")),
    [goals],
  );
  const metasDaEquipe = useMemo(
    () => withPct(goals.filter((g) => g.scope === "user" && g.user_id !== user?.id)),
    [goals, user],
  );

  const nomeDaLinha = (g: GoalWithPct) =>
    g.scope === "company" ? (g.label || companyName(g.company_id)) : userName(g.user_id);

  const semMapeamento = (g: GoalWithPct) =>
    g.scope === "user" &&
    !mappings.some((m) => m.company_id === g.company_id && m.user_id === g.user_id);

  const GoalCard = ({ g }: { g: GoalWithPct }) => {
    const pctClamped = Math.min(100, Math.max(0, g.pct));
    const semMap = semMapeamento(g);
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">{nomeDaLinha(g)}</div>
            <div className="text-xs text-muted-foreground">
              {companyName(g.company_id)} · {fmtDate(g.period_start)} a {fmtDate(g.period_end)}
              {g.scope === "user" && g.label ? ` · ${g.label}` : ""}
            </div>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/30">
            {g.pct.toFixed(2)}%
          </Badge>
        </div>
        {semMap && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Sem vínculo com um vendedor da SSótica nesta empresa — o valor "Atingido" fica
              zerado. Configure em Integrações SSótica → Vendedores.
            </span>
          </div>
        )}
        <Progress value={pctClamped} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Atingido:{" "}
            <span className="font-medium text-foreground">{fmtBRL(g.atingido_amount)}</span>
          </span>
          <span className="text-muted-foreground">
            Meta: <span className="font-medium text-foreground">{fmtBRL(g.target_amount)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Falta {fmtBRL(Math.max(0, g.target_amount - g.atingido_amount))} para atingir a meta.</span>
          {g.atingido_updated_at && (
            <span>Atualizado {format(new Date(g.atingido_updated_at), "dd/MM HH:mm")}</span>
          )}
        </div>
      </div>
    );
  };

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
          {isAdmin && goals.length > 0 && (
            <Button onClick={handleRefreshVendas} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Atualizando..." : "Atualizar vendas (SSótica)"}
            </Button>
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
                    <GoalCard key={g.id} g={g} />
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
                    <GoalCard key={g.id} g={g} />
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
                    <GoalCard key={g.id} g={g} />
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
