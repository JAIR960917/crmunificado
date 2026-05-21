import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, RefreshCw, History, Filter, CheckCircle2, MessageSquare, Zap, Activity, User, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type ModuleVal = "renovacao" | "cobranca" | "none";

type TransitionLog = {
  id: string;
  cliente_nome: string;
  from_module: ModuleVal;
  to_module: ModuleVal;
  to_status_key: string | null;
  to_status_label: string | null;
  company_id: string | null;
  trigger_source: string;
  triggered_by: string | null;
  ssotica_cliente_id: number | null;
  created_at: string;
};

type Company = { id: string; name: string };

const moduleLabel = (m: string) =>
  m === "renovacao" ? "Renovação" : m === "cobranca" ? "Cobrança" : m === "none" ? "Criado" : m;

type EventKind = "create_ren" | "create_cob" | "delete_ren" | "delete_cob" | "ren_to_cob" | "cob_to_ren" | "other";

const classifyEvent = (l: TransitionLog): EventKind => {
  if (l.from_module === "none" && l.to_module === "renovacao") return "create_ren";
  if (l.from_module === "none" && l.to_module === "cobranca") return "create_cob";
  if (l.from_module === "renovacao" && l.to_module === "none") return "delete_ren";
  if (l.from_module === "cobranca" && l.to_module === "none") return "delete_cob";
  if (l.from_module === "renovacao" && l.to_module === "cobranca") return "ren_to_cob";
  if (l.from_module === "cobranca" && l.to_module === "renovacao") return "cob_to_ren";
  return "other";
};

type CompletionLog = {
  id: string;
  source_type: "campaign" | "trigger";
  source_id: string;
  source_name: string;
  module: string;
  status_label: string | null;
  status_key: string | null;
  company_id: string | null;
  total_cards: number;
  sent_count: number;
  error_count: number;
  completed_at: string;
};

type CobrancaFlowEventLog = {
  id: string;
  cobranca_id: string;
  event_type: "tratativa" | "gatilho_enviado" | "avancou_coluna" | "gatilho_falhou" | string;
  status_label: string | null;
  status_key: string | null;
  next_status_label: string | null;
  next_status_key: string | null;
  whatsapp_trigger_campaign_name: string | null;
  details: any;
  created_at: string;
  cobranca?: {
    company_id: string | null;
    ssotica_company_id: string | null;
    data: any;
  } | null;
};

const moduleNiceLabel = (m: string) =>
  m === "leads" ? "Leads" : m === "cobrancas" ? "Cobranças" : m === "renovacoes" ? "Renovações" : m;

export default function TransitionLogsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<TransitionLog[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  // Logs de conclusão de campanha/gatilho
  const [completionLogs, setCompletionLogs] = useState<CompletionLog[]>([]);
  const [completionLoading, setCompletionLoading] = useState(true);
  const [completionSourceFilter, setCompletionSourceFilter] = useState<"all" | "campaign" | "trigger">("all");

  // Logs de eventos do fluxo de cobrança
  const [flowEvents, setFlowEvents] = useState<CobrancaFlowEventLog[]>([]);
  const [flowLoading, setFlowLoading] = useState(true);
  const [flowEventTypeFilter, setFlowEventTypeFilter] = useState<"all" | "tratativa" | "gatilho_enviado" | "avancou_coluna" | "gatilho_falhou">("all");

  // Filtros
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [direction, setDirection] = useState<
    "all" | "ren_to_cob" | "cob_to_ren" | "create_ren" | "create_cob" | "delete_ren" | "delete_cob"
  >("all");
  const [companyId, setCompanyId] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("crm_module_transition_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (startDate) q = q.gte("created_at", `${startDate}T00:00:00`);
    if (endDate) q = q.lte("created_at", `${endDate}T23:59:59`);
    if (clientFilter.trim()) q = q.ilike("cliente_nome", `%${clientFilter.trim()}%`);
    if (direction === "ren_to_cob") q = q.eq("from_module", "renovacao").eq("to_module", "cobranca");
    if (direction === "cob_to_ren") q = q.eq("from_module", "cobranca").eq("to_module", "renovacao");
    if (direction === "create_ren") q = q.eq("from_module", "none").eq("to_module", "renovacao");
    if (direction === "create_cob") q = q.eq("from_module", "none").eq("to_module", "cobranca");
    if (direction === "delete_ren") q = q.eq("from_module", "renovacao").eq("to_module", "none");
    if (direction === "delete_cob") q = q.eq("from_module", "cobranca").eq("to_module", "none");
    if (companyId !== "all") q = q.eq("company_id", companyId);

    const { data, error } = await q;
    if (error) {
      toast.error("Erro ao carregar logs: " + error.message);
      setLogs([]);
    } else {
      setLogs((data ?? []) as TransitionLog[]);
    }
    setLoading(false);
  };

  const loadCompletionLogs = async () => {
    setCompletionLoading(true);
    let q = (supabase as any)
      .from("whatsapp_completion_logs")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(500);
    if (completionSourceFilter !== "all") q = q.eq("source_type", completionSourceFilter);
    if (companyId !== "all") q = q.eq("company_id", companyId);
    if (startDate) q = q.gte("completed_at", `${startDate}T00:00:00`);
    if (endDate) q = q.lte("completed_at", `${endDate}T23:59:59`);
    const { data, error } = await q;
    if (error) {
      toast.error("Erro ao carregar logs de campanhas: " + error.message);
      setCompletionLogs([]);
    } else {
      setCompletionLogs((data ?? []) as CompletionLog[]);
    }
    setCompletionLoading(false);
  };

  const loadFlowEvents = async () => {
    setFlowLoading(true);
    let q = (supabase as any)
      .from("crm_cobranca_flow_events")
      .select("id, cobranca_id, event_type, status_label, status_key, next_status_label, next_status_key, whatsapp_trigger_campaign_name, details, created_at, cobranca:crm_cobrancas!inner(company_id, ssotica_company_id, data)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (flowEventTypeFilter !== "all") q = q.eq("event_type", flowEventTypeFilter);
    if (startDate) q = q.gte("created_at", `${startDate}T00:00:00`);
    if (endDate) q = q.lte("created_at", `${endDate}T23:59:59`);
    if (companyId !== "all") {
      // filtra pelo company_id da cobrança aninhada
      q = q.or(`company_id.eq.${companyId},ssotica_company_id.eq.${companyId}`, { foreignTable: "crm_cobrancas" });
    }
    const { data, error } = await q;
    if (error) {
      toast.error("Erro ao carregar eventos de cobrança: " + error.message);
      setFlowEvents([]);
    } else {
      setFlowEvents((data ?? []) as CobrancaFlowEventLog[]);
    }
    setFlowLoading(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("companies")
      .select("id,name")
      .order("name")
      .then(({ data }) => setCompanies((data ?? []) as Company[]));
    load();
    loadCompletionLogs();
    loadFlowEvents();

    // Realtime: novos eventos de cobrança (gatilhos) aparecem instantaneamente
    const channel = (supabase as any)
      .channel("crm_cobranca_flow_events_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "crm_cobranca_flow_events" },
        () => { loadFlowEvents(); }
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const companyName = useMemo(() => {
    const m = new Map(companies.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [companies]);

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setClientFilter("");
    setDirection("all");
    setCompanyId("all");
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Logs de Movimentação</h1>
              <p className="text-sm text-muted-foreground">
                Histórico de cards transferidos entre Renovação e Cobrança
              </p>
            </div>
          </div>
          <Button onClick={() => { load(); loadCompletionLogs(); loadFlowEvents(); }} variant="outline" size="sm" disabled={loading || completionLoading || flowLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${(loading || completionLoading || flowLoading) ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </header>

        <Tabs defaultValue="movimentacao" className="w-full">
          <TabsList>
            <TabsTrigger value="movimentacao">
              <ArrowRight className="h-4 w-4 mr-2" />
              Movimentação de cards
            </TabsTrigger>
            <TabsTrigger value="campanhas">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Campanhas concluídas
            </TabsTrigger>
            <TabsTrigger value="cobranca-flow">
              <Activity className="h-4 w-4 mr-2" />
              Eventos de cobrança
            </TabsTrigger>
          </TabsList>

          <TabsContent value="movimentacao" className="space-y-6 mt-4">

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4 text-sm font-medium text-muted-foreground">
            <Filter className="h-4 w-4" /> Filtros
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="start">Data inicial</Label>
              <Input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                className="cursor-pointer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Data final</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                className="cursor-pointer"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client">Cliente</Label>
              <Input
                id="client"
                placeholder="Nome do cliente..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Movimentação</Label>
              <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="create_ren">Criado em Renovação</SelectItem>
                  <SelectItem value="delete_ren">Excluído de Renovação</SelectItem>
                  <SelectItem value="create_cob">Criado em Cobrança</SelectItem>
                  <SelectItem value="delete_cob">Excluído de Cobrança</SelectItem>
                  <SelectItem value="ren_to_cob">Renovação → Cobrança</SelectItem>
                  <SelectItem value="cob_to_ren">Cobrança → Renovação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Limpar
            </Button>
            <Button size="sm" onClick={load} disabled={loading}>
              Aplicar filtros
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data / Hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Movimentação</TableHead>
                <TableHead>Coluna destino</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhuma movimentação encontrada
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="font-medium">{log.cliente_nome}</TableCell>
                    <TableCell>
                      {(() => {
                        const kind = classifyEvent(log);
                        const moduleClass = (m: ModuleVal) =>
                          m === "renovacao"
                            ? "border-emerald-300 bg-emerald-500/10 text-emerald-700"
                            : m === "cobranca"
                              ? "border-amber-300 bg-amber-500/10 text-amber-700"
                              : "border-muted-foreground/30 bg-muted text-muted-foreground";
                        if (kind === "create_ren" || kind === "create_cob") {
                          return (
                            <div className="flex items-center gap-2 text-sm">
                              <Badge className="border border-emerald-300 bg-emerald-500/15 text-emerald-700">
                                + Criado
                              </Badge>
                              <Badge variant="outline" className={moduleClass(log.to_module)}>
                                {moduleLabel(log.to_module)}
                              </Badge>
                            </div>
                          );
                        }
                        if (kind === "delete_ren" || kind === "delete_cob") {
                          return (
                            <div className="flex items-center gap-2 text-sm">
                              <Badge className="border border-red-300 bg-red-500/15 text-red-700">
                                − Excluído
                              </Badge>
                              <Badge variant="outline" className={moduleClass(log.from_module)}>
                                {moduleLabel(log.from_module)}
                              </Badge>
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className={moduleClass(log.from_module)}>
                              {moduleLabel(log.from_module)}
                            </Badge>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <Badge variant="outline" className={moduleClass(log.to_module)}>
                              {moduleLabel(log.to_module)}
                            </Badge>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.to_status_label ?? log.to_status_key ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {companyName(log.company_id)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {log.trigger_source?.startsWith("auto") ? "Automático" : "Manual"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {logs.length >= 500 && (
            <div className="text-xs text-muted-foreground p-3 text-center border-t">
              Exibindo os 500 registros mais recentes. Refine os filtros para ver outros períodos.
            </div>
          )}
        </Card>
          </TabsContent>

          <TabsContent value="campanhas" className="space-y-6 mt-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" /> Filtros
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={completionSourceFilter} onValueChange={(v: any) => setCompletionSourceFilter(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="campaign">Campanhas</SelectItem>
                      <SelectItem value="trigger">Gatilhos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Empresa</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Data inicial</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data final</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <Button size="sm" onClick={loadCompletionLogs} disabled={completionLoading}>
                  Aplicar filtros
                </Button>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data / Hora</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Coluna</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Cards</TableHead>
                    <TableHead className="text-right">Enviados</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completionLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : completionLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Nenhuma campanha concluída registrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    completionLogs.map((cl) => (
                      <TableRow key={cl.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(new Date(cl.completed_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          {cl.source_type === "campaign" ? (
                            <Badge variant="outline" className="border-blue-300 bg-blue-500/10 text-blue-700">
                              <MessageSquare className="h-3 w-3 mr-1" /> Campanha
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-purple-300 bg-purple-500/10 text-purple-700">
                              <Zap className="h-3 w-3 mr-1" /> Gatilho
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{cl.source_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{moduleNiceLabel(cl.module)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{cl.status_label ?? cl.status_key ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{companyName(cl.company_id)}</TableCell>
                        <TableCell className="text-right text-sm">{cl.total_cards}</TableCell>
                        <TableCell className="text-right text-sm text-emerald-600 font-medium">{cl.sent_count}</TableCell>
                        <TableCell className="text-right text-sm text-red-600 font-medium">{cl.error_count}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="cobranca-flow" className="space-y-6 mt-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" /> Filtros
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Tipo de evento</Label>
                  <Select value={flowEventTypeFilter} onValueChange={(v: any) => setFlowEventTypeFilter(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="tratativa">Tratativa</SelectItem>
                      <SelectItem value="gatilho_enviado">Gatilho enviado</SelectItem>
                      <SelectItem value="gatilho_falhou">Gatilho falhou</SelectItem>
                      <SelectItem value="avancou_coluna">Avançou coluna</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Empresa</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Data inicial</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data final</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <Button size="sm" onClick={loadFlowEvents} disabled={flowLoading}>
                  Aplicar filtros
                </Button>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data / Hora</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Coluna</TableHead>
                    <TableHead>Instância</TableHead>
                    <TableHead>Detalhes</TableHead>
                    <TableHead>Empresa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flowLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : flowEvents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum evento de cobrança registrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    flowEvents.map((e) => {
                      const cobData = e.cobranca?.data ?? {};
                      const cliente = cobData?.cliente_nome ?? cobData?.nome ?? cobData?.ssotica_raw?.cliente_nome ?? "—";
                      const empresaId = e.cobranca?.company_id ?? e.cobranca?.ssotica_company_id ?? null;
                      const instancia = e.details?.instance_name ?? e.details?.session ?? "—";
                      const eventBadge =
                        e.event_type === "gatilho_enviado" ? (
                          <Badge variant="outline" className="border-blue-300 bg-blue-500/10 text-blue-700">
                            <Zap className="h-3 w-3 mr-1" /> Gatilho enviado
                          </Badge>
                        ) : e.event_type === "gatilho_falhou" ? (
                          <Badge variant="outline" className="border-red-300 bg-red-500/10 text-red-700">
                            <AlertCircle className="h-3 w-3 mr-1" /> Gatilho falhou
                          </Badge>
                        ) : e.event_type === "tratativa" ? (
                          <Badge variant="outline" className="border-amber-300 bg-amber-500/10 text-amber-700">
                            <User className="h-3 w-3 mr-1" /> Tratativa
                          </Badge>
                        ) : e.event_type === "avancou_coluna" ? (
                          <Badge variant="outline" className="border-emerald-300 bg-emerald-500/10 text-emerald-700">
                            <ArrowRight className="h-3 w-3 mr-1" /> Avançou coluna
                          </Badge>
                        ) : (
                          <Badge variant="outline">{e.event_type}</Badge>
                        );
                      const detalhe =
                        e.event_type === "avancou_coluna" && e.next_status_label
                          ? `${e.status_label ?? "—"} → ${e.next_status_label}`
                          : e.event_type === "gatilho_enviado" || e.event_type === "gatilho_falhou"
                            ? e.whatsapp_trigger_campaign_name ?? e.details?.error ?? "—"
                            : e.details?.tratativa ?? e.details?.note ?? "—";
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {format(new Date(e.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </TableCell>
                          <TableCell>{eventBadge}</TableCell>
                          <TableCell className="font-medium">{cliente}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {e.status_label ?? e.status_key ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {String(instancia)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate" title={String(detalhe)}>
                            {String(detalhe)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {companyName(empresaId)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {flowEvents.length >= 500 && (
                <div className="text-xs text-muted-foreground p-3 text-center border-t">
                  Exibindo os 500 registros mais recentes. Refine os filtros para ver outros períodos.
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
