import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardList, Eye, CheckCircle2, RefreshCw, Filter } from "lucide-react";
import { brl } from "@/lib/crediarioFinance";
import { toast } from "sonner";

interface Pagamento {
  nome: string;
  cpf: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  pago_em: string;
}

interface Relatorio {
  id: string;
  data_referencia: string;
  status: string;
  total_pagamentos: number;
  valor_total: number;
  pagamentos: Pagamento[];
  concluido_em: string | null;
  company_id: string | null;
  empresa_nome?: string;
}

interface CompanyOpt { id: string; name: string }

function formatDataRef(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function formatPagoEm(iso: string) {
  try {
    const d = new Date(iso);
    const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    return `${data} ${hora}`;
  } catch { return "—"; }
}

export default function CrediarioRelatoriosDiariosPage() {
  const { isAdmin } = useAuth();

  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState<Relatorio | null>(null);
  const [gerando, setGerando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  const [statusFiltro, setStatusFiltro] = useState<"todos" | "pendente" | "concluido">("todos");
  const [empresaFiltro, setEmpresaFiltro] = useState<string>("todas");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");

  const [filtrosAplicados, setFiltrosAplicados] = useState({
    status: "todos" as "todos" | "pendente" | "concluido",
    empresa: "todas",
    dataInicio: "",
    dataFim: "",
  });

  const carregar = async () => {
    setLoading(true);
    const [{ data, error }, { data: comps }] = await Promise.all([
      supabase
        .from("crediario_relatorios_diarios")
        .select("*")
        .order("data_referencia", { ascending: false })
        .limit(500),
      supabase.from("companies").select("id, name").order("name"),
    ]);
    if (error) {
      toast.error("Erro ao carregar relatórios", { description: error.message });
    } else {
      const compMap = new Map((comps ?? []).map((c) => [c.id, c.name]));
      const enriched = (data ?? [])
        .filter((r: any) => Number(r.total_pagamentos) > 0)
        .map((r: any) => ({
          ...r,
          empresa_nome: r.company_id ? (compMap.get(r.company_id) ?? "—") : "Todas",
        }));
      setRelatorios(enriched as unknown as Relatorio[]);
      setCompanies((comps ?? []) as CompanyOpt[]);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const gerarAgora = async () => {
    setGerando(true);
    const { data, error } = await supabase.functions.invoke("gerar-relatorio-diario", {
      body: { modo: "pendentes" },
    });
    setGerando(false);
    if (error) { toast.error("Falha ao gerar", { description: error.message }); return; }
    const novos = Number((data as { novos_pagamentos?: number })?.novos_pagamentos ?? 0);
    const msg = (data as { mensagem?: string })?.mensagem;
    if (novos > 0) {
      toast.success(msg ?? `Relatório gerado com ${novos} pagamento(s) novo(s)`);
    } else {
      toast.message(msg ?? "Nenhum boleto pago pendente de inclusão em relatório");
    }
    carregar();
  };

  const concluir = async () => {
    if (!aberto) return;
    setConcluindo(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("crediario_relatorios_diarios")
      .update({
        status: "concluido",
        concluido_em: new Date().toISOString(),
        concluido_por: u.user?.id ?? null,
      })
      .eq("id", aberto.id);
    setConcluindo(false);
    if (error) { toast.error("Erro ao concluir", { description: error.message }); return; }
    toast.success("Relatório marcado como concluído");
    setAberto(null);
    carregar();
  };

  const filtrados = useMemo(() => {
    return relatorios.filter((r) => {
      if (filtrosAplicados.status !== "todos" && r.status !== filtrosAplicados.status) return false;
      if (isAdmin && filtrosAplicados.empresa !== "todas" && r.company_id !== filtrosAplicados.empresa) return false;
      if (filtrosAplicados.dataInicio && r.data_referencia < filtrosAplicados.dataInicio) return false;
      if (filtrosAplicados.dataFim && r.data_referencia > filtrosAplicados.dataFim) return false;
      return true;
    });
  }, [relatorios, filtrosAplicados, isAdmin]);

  const totais = useMemo(() => ({
    qtd: filtrados.length,
    pagamentos: filtrados.reduce((s, r) => s + Number(r.total_pagamentos), 0),
    valor: filtrados.reduce((s, r) => s + Number(r.valor_total), 0),
    concluidos: filtrados.filter((r) => r.status === "concluido").length,
    pendentes: filtrados.filter((r) => r.status !== "concluido").length,
  }), [filtrados]);

  const aplicarFiltros = () => {
    setFiltrosAplicados({ status: statusFiltro, empresa: empresaFiltro, dataInicio, dataFim });
  };

  const limparFiltros = () => {
    setStatusFiltro("todos");
    setEmpresaFiltro("todas");
    setDataInicio("");
    setDataFim("");
    setFiltrosAplicados({ status: "todos", empresa: "todas", dataInicio: "", dataFim: "" });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Relatórios de Pagamentos</h1>
              <p className="text-sm text-muted-foreground">
                Histórico de baixas de boletos. {isAdmin ? "Você vê todas as empresas." : "Você vê apenas a sua empresa."}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={gerarAgora} disabled={gerando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${gerando ? "animate-spin" : ""}`} />
            Gerar agora
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Relatórios</p>
            <p className="text-2xl font-bold">{totais.qtd}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Pagamentos</p>
            <p className="text-2xl font-bold">{totais.pagamentos}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Valor total</p>
            <p className="text-2xl font-bold">{brl(totais.valor)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Status</p>
            <p className="text-sm mt-1">
              <Badge className="bg-emerald-600 text-white mr-1">{totais.concluidos} concl.</Badge>
              <Badge variant="secondary">{totais.pendentes} pend.</Badge>
            </p>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtros</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFiltro} onValueChange={(v: any) => setStatusFiltro(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="pendente">Pendentes</SelectItem>
                    <SelectItem value="concluido">Concluídos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div>
                  <Label className="text-xs">Empresa</Label>
                  <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Data inicial</Label>
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Data final</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button onClick={aplicarFiltros} className="flex-1">Aplicar filtro</Button>
                <Button variant="outline" onClick={limparFiltros}>Limpar</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
            ) : filtrados.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Nenhum relatório encontrado com esses filtros.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    {isAdmin && <TableHead>Empresa</TableHead>}
                    <TableHead>Pagamentos</TableHead>
                    <TableHead>Valor total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Concluído em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{formatDataRef(r.data_referencia)}</TableCell>
                      {isAdmin && <TableCell className="text-muted-foreground">{r.empresa_nome ?? "—"}</TableCell>}
                      <TableCell>{r.total_pagamentos}</TableCell>
                      <TableCell>{brl(Number(r.valor_total))}</TableCell>
                      <TableCell>
                        {r.status === "concluido" ? (
                          <Badge className="bg-emerald-600 text-white">Concluído</Badge>
                        ) : (
                          <Badge variant="secondary">Pendente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.concluido_em ? new Date(r.concluido_em).toLocaleString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setAberto(r)}>
                          <Eye className="mr-2 h-4 w-4" /> Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Relatório de {aberto && formatDataRef(aberto.data_referencia)}
              {aberto?.empresa_nome && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">— {aberto.empresa_nome}</span>
              )}
              {aberto?.status === "concluido" && (
                <Badge className="ml-2 bg-emerald-600 text-white">Concluído</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {aberto && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Total de pagamentos: </span><strong>{aberto.total_pagamentos}</strong></div>
                <div><span className="text-muted-foreground">Valor total: </span><strong>{brl(Number(aberto.valor_total))}</strong></div>
              </div>

              {aberto.pagamentos.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nenhum boleto foi pago neste dia.</p>
              ) : (
                <div className="mt-4 rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>CPF</TableHead>
                        <TableHead>Parcela</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Pago em</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aberto.pagamentos.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{p.nome}</TableCell>
                          <TableCell>{p.cpf}</TableCell>
                          <TableCell>{p.numero_parcela}/{p.total_parcelas}</TableCell>
                          <TableCell>{brl(Number(p.valor))}</TableCell>
                          <TableCell>{formatPagoEm(p.pago_em)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <DialogFooter>
                {aberto.status !== "concluido" ? (
                  <Button onClick={concluir} disabled={concluindo} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Marcar como concluído
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Concluído em {aberto.concluido_em ? new Date(aberto.concluido_em).toLocaleString("pt-BR") : "—"}
                  </p>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
