import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3,
  Building2,
  Download,
  Eye,
  Filter,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Search,
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
  dedupeRowsByCpf,
  exportCampanhaCopaPlacarCsv,
  exportCampanhaCopaUnmappedCsv,
  fetchCampanhaCopaRelatorio,
  fetchCampanhaCopaRelatorioMeta,
  lookupLeadsByPhones,
  normalizePhoneDigits,
  normalizePlacarInput,
  renovacaoMatchLabel,
  type CampanhaCopaRelatorioFilters,
  type CampanhaCopaRelatorioRow,
  type RenovacaoMatch,
  NO_COMPANY_FILTER,
} from "@/lib/campanha-copa-relatorio";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
import { Navigate } from "react-router-dom";

const ALL = "__all__";
const NO_COMPANY = NO_COMPANY_FILTER;

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
    em_leads_externo: 0,
    em_leads_via_copa: 0,
    prospect: 0,
    outra_loja: 0,
    pct_renovacao: 0,
    pct_leads_externo: 0,
    pct_leads_via_copa: 0,
    pct_prospect: 0,
    pct_outra_loja: 0,
    consentimento_marketing: 0,
    convertidos: 0,
    prospect_convertidos: 0,
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
  const [placarHome, setPlacarHome] = useState("");
  const [placarAway, setPlacarAway] = useState("");

  const [cidadeOptions, setCidadeOptions] = useState<string[]>([]);
  const [jogoOptions, setJogoOptions] = useState<string[]>([]);
  const [empresaOptions, setEmpresaOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [empresa, setEmpresa] = useState(ALL);
  const [converteu, setConverteu] = useState(ALL);

  const placarFiltro = useMemo(
    () => normalizePlacarInput(placarHome, placarAway),
    [placarHome, placarAway],
  );

  // Quantos CPFs distintos existem entre as inscrições filtradas — quando a
  // mesma pessoa participa de mais de uma campanha/jogo, ela gera uma
  // inscrição por participação, mas é a mesma pessoa.
  const uniqueLeadsCount = useMemo(() => dedupeRowsByCpf(rows).length, [rows]);

  const [unmappedExported, setUnmappedExported] = useState(false);
  const [unmappedDeleting, setUnmappedDeleting] = useState(false);
  const [unmappedDeleteOpen, setUnmappedDeleteOpen] = useState(false);

  const filters = useMemo((): CampanhaCopaRelatorioFilters => ({
    ultimo_exame: ultimoExame === ALL ? null : ultimoExame,
    cidade: cidade.trim() || null,
    jogo: jogo === ALL ? null : jogo,
    data_inicio: dataInicio || null,
    data_fim: dataFim || null,
    renovacao_filtro: renovacaoFiltro === ALL ? null : (renovacaoFiltro as RenovacaoMatch),
    assigned_to: assignedTo === ALL ? null : assignedTo,
    placar: placarFiltro,
    company_id: empresa === ALL ? null : empresa === NO_COMPANY ? NO_COMPANY : empresa,
    converteu: converteu === ALL ? null : converteu === "sim",
  }), [ultimoExame, cidade, jogo, dataInicio, dataFim, renovacaoFiltro, assignedTo, placarFiltro, empresa, converteu]);

  const loadMeta = useCallback(async () => {
    const [profRes, meta] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, email").order("full_name"),
      fetchCampanhaCopaRelatorioMeta(),
    ]);
    setProfiles((profRes.data || []) as Profile[]);
    setCidadeOptions(meta.cities);
    setJogoOptions(meta.jogos);
    setEmpresaOptions(meta.companies);
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

  useEffect(() => {
    setUnmappedExported(false);
  }, [rows]);

  const profileName = useCallback(
    (id: string | null) => {
      if (!id) return "Sem responsável";
      const p = profiles.find((x) => x.user_id === id);
      return p?.full_name || p?.email || id.slice(0, 8);
    },
    [profiles],
  );

  const isUnmappedFilter = empresa === NO_COMPANY;

  const exportUnmappedCsv = useCallback(() => {
    if (rows.length === 0) return;
    exportCampanhaCopaUnmappedCsv(rows, profileName);
    setUnmappedExported(true);
    toast.success("CSV exportado. Agora você pode excluir essas inscrições.");
  }, [rows, profileName]);

  const deleteAllUnmapped = useCallback(async () => {
    if (rows.length === 0) return;
    setUnmappedDeleting(true);
    let okCount = 0;
    let errCount = 0;
    for (const row of rows) {
      try {
        const { error: subErr } = await supabase
          .from("campanha_copa_submissions")
          .delete()
          .eq("id", row.id);
        if (subErr) throw subErr;
        if (row.lead_id) {
          const { error: leadErr } = await supabase.from("crm_leads").delete().eq("id", row.lead_id);
          if (leadErr) throw leadErr;
        }
        okCount++;
      } catch {
        errCount++;
      }
    }
    setUnmappedDeleting(false);
    setUnmappedDeleteOpen(false);
    setUnmappedExported(false);
    if (errCount === 0) {
      toast.success(`${okCount} inscrição(ões) sem empresa mapeada excluída(s).`);
    } else {
      toast.error(`${okCount} excluída(s), ${errCount} falharam. Tente novamente para as restantes.`);
    }
    void loadReport();
  }, [rows, loadReport]);

  // Leads que já estão em Renovação não deveriam continuar existindo como
  // card em Leads — uma pessoa não pode estar em Renovação E em Leads ao
  // mesmo tempo. Varre as inscrições com renovacao_match != "nao" (em
  // renovação na própria loja OU em outra loja), descobre os leads cujo
  // telefone bate, e permite excluir esses leads (exportando antes).
  type RenLeadMatch = { lead_id: string; nome: string; telefone: string; cidade: string };
  const [renLeadsDialogOpen, setRenLeadsDialogOpen] = useState(false);
  const [renLeadsScanning, setRenLeadsScanning] = useState(false);
  const [renLeadsResults, setRenLeadsResults] = useState<RenLeadMatch[] | null>(null);
  const [renLeadsExported, setRenLeadsExported] = useState(false);
  const [renLeadsDeletingAll, setRenLeadsDeletingAll] = useState(false);

  const scanLeadsEmRenovacao = useCallback(async () => {
    setRenLeadsScanning(true);
    setRenLeadsExported(false);
    try {
      const candidateRows = rows.filter((r) => r.renovacao_match !== "nao");
      const phoneToRow = new Map<string, CampanhaCopaRelatorioRow>();
      for (const row of candidateRows) {
        const phone = normalizePhoneDigits(row.telefone);
        if (phone.length >= 10) phoneToRow.set(phone, row);
      }
      const matches = await lookupLeadsByPhones([...phoneToRow.keys()]);
      const byLeadId = new Map<string, RenLeadMatch>();
      for (const m of matches) {
        if (byLeadId.has(m.lead_id)) continue;
        const row = phoneToRow.get(m.phone_digits);
        byLeadId.set(m.lead_id, {
          lead_id: m.lead_id,
          nome: row?.nome || "—",
          telefone: row?.telefone || m.phone_digits,
          cidade: row?.cidade || "—",
        });
      }
      const results = [...byLeadId.values()];
      setRenLeadsResults(results);
      toast.success(`${results.length} lead(s) encontrado(s) já em Renovação.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar");
    } finally {
      setRenLeadsScanning(false);
    }
  }, [rows]);

  const exportRenLeadsCsv = useCallback(() => {
    if (!renLeadsResults || renLeadsResults.length === 0) return;
    const header = ["Nome", "Telefone", "Cidade"];
    const lines = renLeadsResults.map((r) =>
      [r.nome, r.telefone, r.cidade].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"),
    );
    const csv = [header.join(";"), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_ja_em_renovacao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setRenLeadsExported(true);
    toast.success("CSV exportado. Agora você pode excluir esses leads.");
  }, [renLeadsResults]);

  const deleteAllLeadsEmRenovacao = useCallback(async () => {
    if (!renLeadsResults || renLeadsResults.length === 0) return;
    setRenLeadsDeletingAll(true);
    let okCount = 0;
    let errCount = 0;
    for (const r of renLeadsResults) {
      try {
        await Promise.all([
          supabase.from("crm_lead_notes").delete().eq("lead_id", r.lead_id),
          supabase.from("lead_activities").delete().eq("lead_id", r.lead_id),
          supabase.from("crm_appointments").delete().eq("lead_id", r.lead_id),
          supabase.from("notifications").delete().eq("lead_id", r.lead_id),
          supabase.from("scheduled_whatsapp_messages").delete().eq("lead_id", r.lead_id),
        ]);
        const { error } = await supabase.from("crm_leads").delete().eq("id", r.lead_id);
        if (error) throw error;
        okCount++;
      } catch {
        errCount++;
      }
    }
    setRenLeadsDeletingAll(false);
    setRenLeadsResults(null);
    setRenLeadsExported(false);
    if (errCount === 0) {
      toast.success(`${okCount} lead(s) já em Renovação excluído(s).`);
    } else {
      toast.error(`${okCount} excluído(s), ${errCount} falharam. Tente novamente para os restantes.`);
    }
  }, [renLeadsResults]);

  const empresaBase = Math.max(1, metrics.total);
  const exameBase = Math.max(1, metrics.total);

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
            <Button
              variant="outline"
              onClick={() => {
                setRenLeadsDialogOpen(true);
                void scanLeadsEmRenovacao();
              }}
            >
              <Search className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Leads já em Renovação</span>
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
              Refine por último exame, cidade, jogo, placar, período, status na Renovação, responsável e empresa.
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

              <div className="space-y-2">
                <Label>Empresa</Label>
                <Select value={empresa} onValueChange={setEmpresa}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todas</SelectItem>
                    <SelectItem value={NO_COMPANY}>Sem empresa mapeada</SelectItem>
                    {empresaOptions.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Comprou após a campanha?</Label>
                <Select value={converteu} onValueChange={setConverteu}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Todos</SelectItem>
                    <SelectItem value="sim">Sim — comprou após a inscrição</SelectItem>
                    <SelectItem value="nao">Não — ainda não comprou</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Placar (palpite)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    placeholder="Casa"
                    value={placarHome}
                    onChange={(e) => setPlacarHome(e.target.value)}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground shrink-0">x</span>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    placeholder="Visitante"
                    value={placarAway}
                    onChange={(e) => setPlacarAway(e.target.value)}
                    className="w-24"
                  />
                  {(placarHome || placarAway) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPlacarHome("");
                        setPlacarAway("");
                      }}
                    >
                      Limpar
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Filtra quem palpitou exatamente esse placar. Preencha os dois gols para exportar CSV.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de inscrições</CardDescription>
              <CardTitle className="text-3xl">{metrics.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Leads únicos (CPF)
              </CardDescription>
              <CardTitle className="text-3xl">
                {uniqueLeadsCount}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.total > 0 ? Math.round((uniqueLeadsCount / metrics.total) * 100) : 0}%)
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground pt-1">
                Pessoas distintas pelo CPF — conta uma vez mesmo participando de várias campanhas
              </p>
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
                <LayoutDashboard className="h-3.5 w-3.5" />
                Já estava em Leads
              </CardDescription>
              <CardTitle className="text-3xl text-blue-600">
                {metrics.em_leads_externo}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_leads_externo}%)
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground pt-1">
                Telefone já tinha card em Leads ANTES/independente da Campanha Copa
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Entrou em Leads pela Campanha
              </CardDescription>
              <CardTitle className="text-3xl text-cyan-600">
                {metrics.em_leads_via_copa}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_leads_via_copa}%)
                </span>
              </CardTitle>
              <p className="text-xs text-muted-foreground pt-1">
                Card em Leads foi criado pela própria inscrição da Campanha Copa
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Prospect (sem Renovação nem Leads prévios)
              </CardDescription>
              <CardTitle className="text-3xl">
                {metrics.prospect}
                <span className="text-base font-normal text-muted-foreground ml-2">
                  ({metrics.pct_prospect}%)
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Inscrições detalhadas</CardTitle>
                <CardDescription>
                  Até 5.000 registros. &quot;Em Renovação&quot; = CPF ou telefone encontrado em{" "}
                  <code className="text-xs">crm_renovacoes</code> da loja mapeada pela cidade informada.
                </CardDescription>
              </div>
              {placarFiltro && rows.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => exportCampanhaCopaPlacarCsv(rows, placarFiltro, profileName)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV ({rows.length}) — placar {placarFiltro}
                </Button>
              )}
              {isUnmappedFilter && rows.length > 0 && (
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={exportUnmappedCsv}>
                    <Download className="h-4 w-4 mr-2" />
                    Exportar CSV ({rows.length}) — sem empresa mapeada
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!unmappedExported || unmappedDeleting}
                    title={!unmappedExported ? "Exporte o CSV primeiro" : undefined}
                    onClick={() => setUnmappedDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir todos ({rows.length})
                  </Button>
                </div>
              )}
            </div>
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
                    <TableHead>Palpite</TableHead>
                    <TableHead>Último exame</TableHead>
                    <TableHead>Em Renovação?</TableHead>
                    <TableHead>Comprou após?</TableHead>
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
                      <TableCell className="text-sm whitespace-nowrap font-medium">
                        {row.palpite_texto ||
                          (row.palpite_brasil != null && row.palpite_marrocos != null
                            ? `${row.palpite_brasil} x ${row.palpite_marrocos}`
                            : "—")}
                      </TableCell>
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
                      <TableCell>
                        {row.converteu_apos_campanha ? (
                          <Badge className="bg-amber-600 hover:bg-amber-600 text-white">Sim</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Não</Badge>
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
          <strong>Prospect</strong> = não encontrado na loja (inclui clientes de outras unidades da rede).
        </p>
      </div>

      <AlertDialog open={unmappedDeleteOpen} onOpenChange={setUnmappedDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todas as inscrições sem empresa mapeada?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso excluirá permanentemente {rows.length} inscrição(ões) da Campanha Copa (e o lead
              vinculado, quando houver) que não têm empresa mapeada pela cidade. Essa ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unmappedDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void deleteAllUnmapped();
              }}
              disabled={unmappedDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unmappedDeleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renLeadsDialogOpen} onOpenChange={setRenLeadsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Leads que já estão em Renovação</DialogTitle>
            <DialogDescription>
              Uma pessoa já cliente ativo em Renovação não deveria continuar com um card na tela de Leads.
              Exporte o CSV antes de excluir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="secondary" onClick={() => void scanLeadsEmRenovacao()} disabled={renLeadsScanning}>
                {renLeadsScanning ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verificando...</>
                ) : (
                  <><Search className="mr-2 h-4 w-4" />Verificar agora</>
                )}
              </Button>
              {renLeadsResults && renLeadsResults.length > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={exportRenLeadsCsv}>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar CSV ({renLeadsResults.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!renLeadsExported || renLeadsDeletingAll}
                    title={!renLeadsExported ? "Exporte o CSV primeiro" : undefined}
                    onClick={() => void deleteAllLeadsEmRenovacao()}
                  >
                    {renLeadsDeletingAll ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Excluindo...</>
                    ) : (
                      <><Trash2 className="mr-2 h-4 w-4" />Excluir todos ({renLeadsResults.length})</>
                    )}
                  </Button>
                </div>
              )}
            </div>
            {renLeadsResults && renLeadsResults.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lead encontrado já em Renovação.</p>
            )}
            {renLeadsResults && renLeadsResults.length > 0 && (
              <div className="max-h-[400px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Cidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renLeadsResults.map((r) => (
                      <TableRow key={r.lead_id}>
                        <TableCell className="text-xs">{r.nome}</TableCell>
                        <TableCell className="text-xs">{r.telefone}</TableCell>
                        <TableCell className="text-xs">{r.cidade}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
