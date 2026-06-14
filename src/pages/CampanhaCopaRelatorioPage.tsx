import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3,
  Building2,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EXAME_VISTA_OPTIONS,
  fetchCampanhaCopaRelatorio,
  renovacaoMatchLabel,
  type CampanhaCopaRelatorioFilters,
  type CampanhaCopaRelatorioRow,
  type RenovacaoMatch,
} from "@/lib/campanha-copa-relatorio";
import { Navigate } from "react-router-dom";

const ALL = "__all__";

type Profile = { user_id: string; full_name: string; email?: string };

function formatCpf(cpf: string | null) {
  if (!cpf) return "—";
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function RenovacaoBadge({ match }: { match: RenovacaoMatch }) {
  if (match === "sim") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Em Renovação</Badge>;
  }
  if (match === "outra_loja") {
    return <Badge variant="secondary">Outra loja</Badge>;
  }
  return <Badge variant="outline">Prospect</Badge>;
}

function DistributionBar({
  label,
  total,
  base,
  decimalPlaces = 0,
}: {
  label: string;
  total: number;
  base: number;
  decimalPlaces?: number;
}) {
  const multiplier = 10 ** decimalPlaces;
  const pct = base > 0 ? Math.round((total / base) * 100 * multiplier) / multiplier : 0;
  const pctLabel =
    decimalPlaces > 0 ? pct.toFixed(decimalPlaces) : String(Math.round(pct));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm gap-2">
        <span className="truncate" title={label}>
          {label}
        </span>
        <span className="text-muted-foreground shrink-0">
          {total} ({pctLabel}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function CampanhaCopaRelatorioPage() {
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<CampanhaCopaRelatorioRow[]>([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    em_renovacao: 0,
    prospect: 0,
    outra_loja: 0,
    pct_renovacao: 0,
    pct_prospect: 0,
    pct_outra_loja: 0,
    consentimento_marketing: 0,
    por_empresa: [] as Array<{ empresa: string; total: number }>,
    por_exame: [] as Array<{ exame: string; total: number }>,
  });

  const [ultimoExame, setUltimoExame] = useState(ALL);
  const [cidade, setCidade] = useState("");
  const [jogo, setJogo] = useState(ALL);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [renovacaoFiltro, setRenovacaoFiltro] = useState(ALL);
  const [assignedTo, setAssignedTo] = useState(ALL);

  const [cidadeOptions, setCidadeOptions] = useState<string[]>([]);
  const [jogoOptions, setJogoOptions] = useState<string[]>([]);

  const filters = useMemo((): CampanhaCopaRelatorioFilters => ({
    ultimo_exame: ultimoExame === ALL ? null : ultimoExame,
    cidade: cidade.trim() || null,
    jogo: jogo === ALL ? null : jogo,
    data_inicio: dataInicio || null,
    data_fim: dataFim || null,
    renovacao_filtro: renovacaoFiltro === ALL ? null : (renovacaoFiltro as RenovacaoMatch),
    assigned_to: assignedTo === ALL ? null : assignedTo,
  }), [ultimoExame, cidade, jogo, dataInicio, dataFim, renovacaoFiltro, assignedTo]);

  const loadMeta = useCallback(async () => {
    const [profRes, subRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email").order("full_name"),
      supabase
        .from("campanha_copa_submissions")
        .select("cidade, jogo, jogo_label")
        .order("created_at", { ascending: false })
        .limit(3000),
    ]);
    setProfiles((profRes.data || []) as Profile[]);

    const cities = new Set<string>();
    const jogos = new Map<string, string>();
    for (const row of subRes.data || []) {
      const r = row as { cidade?: string; jogo?: string; jogo_label?: string };
      if (r.cidade?.trim()) cities.add(r.cidade.trim());
      if (r.jogo) jogos.set(r.jogo, r.jogo_label || r.jogo);
    }
    setCidadeOptions(Array.from(cities).sort((a, b) => a.localeCompare(b, "pt-BR")));
    setJogoOptions(Array.from(jogos.keys()).sort());
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchCampanhaCopaRelatorio(filters);
      setMetrics(result.metrics);
      setRows(result.rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao carregar relatório";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadMeta();
  }, [isAdmin, loadMeta]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadReport();
  }, [isAdmin, loadReport]);

  const profileName = useCallback(
    (id: string | null) => {
      if (!id) return "Sem responsável";
      const p = profiles.find((x) => x.user_id === id);
      return p?.full_name || p?.email || id.slice(0, 8);
    },
    [profiles],
  );

  const empresaBase = Math.max(1, metrics.prospect);
  const exameBase = Math.max(1, metrics.prospect);

  if (!isAdmin) {
    return <Navigate to="/campanhas-copa" replace />;
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-7 w-7 text-primary" />
              Relatório Campanha Copa
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Métricas das inscrições com cruzamento automático contra a tela de Renovação (CPF e telefone na loja da cidade).
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/campanhas-copa">
                <Trophy className="h-4 w-4 mr-2" />
                Campanhas Copa
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void loadReport()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filtros
            </CardTitle>
            <CardDescription>
              Refine por último exame de vista, cidade, jogo, período, status na Renovação e responsável.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Último exame de vista</Label>
                <Select value={ultimoExame} onValueChange={setUltimoExame}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos</SelectItem>
                    {EXAME_VISTA_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cidade</Label>
                <Select
                  value={cidade || ALL}
                  onValueChange={(v) => setCidade(v === ALL ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    {cidadeOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Jogo</Label>
                <Select value={jogo} onValueChange={setJogo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos</SelectItem>
                    {jogoOptions.map((j) => (
                      <SelectItem key={j} value={j}>
                        {j}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Em Renovação?</Label>
                <Select value={renovacaoFiltro} onValueChange={setRenovacaoFiltro}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos</SelectItem>
                    <SelectItem value="sim">Sim — na loja da cidade</SelectItem>
                    <SelectItem value="nao">Não — prospect</SelectItem>
                    <SelectItem value="outra_loja">Cliente de outra loja</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Data início</Label>
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Data fim</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Responsável</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        {p.full_name || p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de inscrições</CardDescription>
              <CardTitle className="text-3xl">{metrics.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <UserCheck className="h-3.5 w-3.5" />
                Já em Renovação (loja)
              </CardDescription>
              <CardTitle className="text-3xl text-emerald-600">
                {metrics.em_renovacao}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_renovacao}%)
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Prospect (não em Renovação)
              </CardDescription>
              <CardTitle className="text-3xl">
                {metrics.prospect}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_prospect}%)
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                Cliente de outra loja
              </CardDescription>
              <CardTitle className="text-3xl">
                {metrics.outra_loja}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_outra_loja}%)
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Distribuição por empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {metrics.por_empresa.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum dado com os filtros atuais.</p>
              ) : (
                metrics.por_empresa.map((item) => (
                  <DistributionBar
                    key={item.empresa}
                    label={item.empresa}
                    total={item.total}
                    base={empresaBase}
                    decimalPlaces={2}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Distribuição por último exame
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {metrics.por_exame.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum dado com os filtros atuais.</p>
              ) : (
                metrics.por_exame.map((item) => (
                  <DistributionBar
                    key={item.exame}
                    label={item.exame}
                    total={item.total}
                    base={exameBase}
                    decimalPlaces={2}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consentimento de marketing</CardTitle>
            <CardDescription>
              {metrics.consentimento_marketing} de {metrics.total} inscrições autorizaram comunicações (
              {metrics.total > 0
                ? Math.round((metrics.consentimento_marketing / metrics.total) * 100)
                : 0}
              %)
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inscrições detalhadas</CardTitle>
            <CardDescription>
              Até 5.000 registros. &quot;Em Renovação&quot; = CPF ou telefone encontrado em{" "}
              <code className="text-xs">crm_renovacoes</code> da loja mapeada pela cidade informada.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Carregando relatório…
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma inscrição encontrada com os filtros selecionados.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Último exame</TableHead>
                    <TableHead>Em Renovação?</TableHead>
                    <TableHead>Coluna Renovação</TableHead>
                    <TableHead>Última compra SSótica</TableHead>
                    <TableHead>Loja</TableHead>
                    <TableHead>Responsável</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {format(new Date(row.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{row.nome}</div>
                        <div className="text-xs text-muted-foreground">{formatCpf(row.cpf)}</div>
                      </TableCell>
                      <TableCell className="text-sm">{row.cidade || "—"}</TableCell>
                      <TableCell className="text-sm max-w-[140px]">
                        {row.ultimo_exame_vista || "—"}
                      </TableCell>
                      <TableCell>
                        <RenovacaoBadge match={row.renovacao_match} />
                        {row.renovacao_match_type && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            via {row.renovacao_match_type}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.renovacao_status_label || row.renovacao_match_status || "—"}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {row.renovacao_match_data_compra
                          ? format(new Date(row.renovacao_match_data_compra + "T12:00:00"), "dd/MM/yyyy", {
                              locale: ptBR,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.renovacao_match === "sim"
                          ? row.company_name || "—"
                          : row.renovacao_match === "outra_loja"
                            ? row.renovacao_company_name || "—"
                            : row.company_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{profileName(row.assigned_to)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground pb-4">
          Legenda: <strong>Em Renovação</strong> = cliente já existe na Renovação da loja da cidade;{" "}
          <strong>Prospect</strong> = não encontrado; <strong>Outra loja</strong> = encontrado em outra unidade da rede (
          {renovacaoMatchLabel("outra_loja")}).
        </p>
      </div>
    </AppLayout>
  );
}
