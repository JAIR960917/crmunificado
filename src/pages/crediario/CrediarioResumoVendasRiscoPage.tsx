import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/crediarioFinance";
import { toast } from "sonner";

interface Company { id: string; name: string }

type FaixaKey = "A" | "B" | "C" | "D" | "E" | "SEM";

const FAIXAS: { key: FaixaKey; label: string; sub: string; color: string }[] = [
  { key: "A", label: "A", sub: "Risco muito baixo", color: "bg-emerald-600 text-white" },
  { key: "B", label: "B", sub: "Risco baixo", color: "bg-lime-600 text-white" },
  { key: "C", label: "C", sub: "Risco médio", color: "bg-yellow-500 text-white" },
  { key: "D", label: "D", sub: "Risco alto", color: "bg-orange-500 text-white" },
  { key: "E", label: "E", sub: "Risco muito alto", color: "bg-red-600 text-white" },
  { key: "SEM", label: "•", sub: "Venda pagamento na entrega", color: "bg-slate-400 text-white" },
];

function classificar(score: number | null | undefined): FaixaKey {
  if (score == null) return "SEM";
  if (score >= 900) return "A";
  if (score >= 701) return "B";
  if (score >= 451) return "C";
  if (score >= 300) return "D";
  return "E";
}

interface Bucket {
  qtd: number;
  faturado: number;
  entradaPaga: number;
  recebido: number;
  emAberto: number;
  vencimento_1_30: number;
  vencido_1_30: number;
  vencimento_31_60: number;
  vencido_31_60: number;
  vencimento_61_90: number;
  vencido_61_90: number;
  vencimento_sup_90: number;
  vencido_sup_90: number;
  vencimento_sup_180: number;
  vencido_sup_180: number;
}

const emptyBucket = (): Bucket => ({
  qtd: 0, faturado: 0, entradaPaga: 0, recebido: 0, emAberto: 0,
  vencimento_1_30: 0, vencido_1_30: 0,
  vencimento_31_60: 0, vencido_31_60: 0,
  vencimento_61_90: 0, vencido_61_90: 0,
  vencimento_sup_90: 0, vencido_sup_90: 0,
  vencimento_sup_180: 0, vencido_sup_180: 0,
});

const diffDias = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);

export default function CrediarioResumoVendasRiscoPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("todas");
  const [dataInicio, setDataInicio] = useState<Date | undefined>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d;
  });
  const [dataFim, setDataFim] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<Record<FaixaKey, Bucket>>(() => ({
    A: emptyBucket(), B: emptyBucket(), C: emptyBucket(), D: emptyBucket(),
    E: emptyBucket(), SEM: emptyBucket(),
  }));

  useEffect(() => {
    supabase.from("companies").select("id, name").order("name")
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const carregar = async () => {
    if (!dataInicio || !dataFim) { toast.error("Selecione o período"); return; }
    setLoading(true);
    try {
      const inicio = new Date(dataInicio); inicio.setHours(0,0,0,0);
      const fim = new Date(dataFim); fim.setHours(23,59,59,999);

      let qv = supabase.from("crediario_vendas")
        .select("id, score, valor_total, valor_entrada, company_id")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString());
      if (companyId !== "todas") qv = qv.eq("company_id", companyId);
      const { data: vendas, error: ev } = await qv;
      if (ev) throw ev;

      const vendaToFaixa = new Map<string, FaixaKey>();
      (vendas ?? []).forEach((v) => vendaToFaixa.set(v.id, classificar(v.score)));

      const novo: Record<FaixaKey, Bucket> = {
        A: emptyBucket(), B: emptyBucket(), C: emptyBucket(), D: emptyBucket(),
        E: emptyBucket(), SEM: emptyBucket(),
      };

      (vendas ?? []).forEach((v) => {
        const f = classificar(v.score);
        novo[f].qtd += 1;
        novo[f].faturado += Number(v.valor_total ?? 0);
        novo[f].entradaPaga += Number(v.valor_entrada ?? 0);
      });

      const limiteFuturo = new Date(fim); limiteFuturo.setDate(limiteFuturo.getDate() + 365);
      const limiteFuturoISO = limiteFuturo.toISOString().slice(0, 10);
      let qp = supabase.from("crediario_parcelas")
        .select("venda_id, valor, valor_pago, status, vencimento, pago_em, company_id")
        .or(`and(status.neq.pago,vencimento.lte.${limiteFuturoISO}),and(pago_em.gte.${inicio.toISOString()},pago_em.lte.${fim.toISOString()})`);
      if (companyId !== "todas") qp = qp.eq("company_id", companyId);
      const { data: parcelas, error: ep } = await qp;
      if (ep) throw ep;

      const idsFaltando = Array.from(new Set((parcelas ?? [])
        .map((p) => p.venda_id)
        .filter((id) => id && !vendaToFaixa.has(id))));
      if (idsFaltando.length > 0) {
        const chunkSize = 200;
        for (let i = 0; i < idsFaltando.length; i += chunkSize) {
          const chunk = idsFaltando.slice(i, i + chunkSize);
          const { data, error } = await supabase.from("crediario_vendas")
            .select("id, score")
            .in("id", chunk);
          if (error) throw error;
          (data ?? []).forEach((v) => vendaToFaixa.set(v.id, classificar(v.score)));
        }
      }

      const hojeReal = new Date(); hojeReal.setHours(0,0,0,0);
      const ref = fim < hojeReal ? new Date(fim.getFullYear(), fim.getMonth(), fim.getDate()) : hojeReal;
      ref.setHours(0,0,0,0);
      (parcelas ?? []).forEach((p) => {
        const f = vendaToFaixa.get(p.venda_id);
        if (!f) return;
        const valor = Number(p.valor ?? 0);
        const valorPago = Number(p.valor_pago ?? 0);
        const venc = new Date(p.vencimento + "T00:00:00");
        if (p.status === "pago") {
          novo[f].recebido += valorPago || valor;
          return;
        }
        novo[f].emAberto += valor;
        const diff = diffDias(venc, ref);
        if (diff >= 0) {
          if (diff <= 30) novo[f].vencimento_1_30 += valor;
          else if (diff <= 60) novo[f].vencimento_31_60 += valor;
          else if (diff <= 90) novo[f].vencimento_61_90 += valor;
          else if (diff <= 180) novo[f].vencimento_sup_90 += valor;
          else if (diff <= 365) novo[f].vencimento_sup_180 += valor;
        } else {
          const atraso = -diff;
          if (atraso <= 30) novo[f].vencido_1_30 += valor;
          else if (atraso <= 60) novo[f].vencido_31_60 += valor;
          else if (atraso <= 90) novo[f].vencido_61_90 += valor;
          else if (atraso <= 180) novo[f].vencido_sup_90 += valor;
          else if (atraso <= 365) novo[f].vencido_sup_180 += valor;
        }
      });

      setBuckets(novo);
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  const totalLinha = (campo: keyof Bucket) =>
    FAIXAS.reduce((s, f) => s + Number(buckets[f.key][campo] || 0), 0);

  const pct = (num: number, den: number) =>
    den > 0 ? `${((num / den) * 100).toFixed(2)}%` : "0,00%";

  const linhas: { label: string; render: (b: Bucket, k: FaixaKey) => React.ReactNode; total: () => React.ReactNode }[] = [
    { label: "Quantidade de vendas", render: (b) => b.qtd, total: () => totalLinha("qtd") },
    { label: "Total faturado", render: (b) => brl(b.faturado), total: () => brl(totalLinha("faturado")) },
    { label: "Total entrada paga", render: (b) => brl(b.entradaPaga), total: () => brl(totalLinha("entradaPaga")) },
    { label: "Total recebido", render: (b) => brl(b.recebido), total: () => brl(totalLinha("recebido")) },
    { label: "Total em aberto", render: (b) => brl(b.emAberto), total: () => brl(totalLinha("emAberto")) },
    { label: "Vencimento entre 1 e 30 dias", render: (b) => brl(b.vencimento_1_30), total: () => brl(totalLinha("vencimento_1_30")) },
    { label: "Vencido de 1 a 30 dias", render: (b) => brl(b.vencido_1_30), total: () => brl(totalLinha("vencido_1_30")) },
    { label: "Inadimplência 30 dias", render: (b) => pct(b.vencido_1_30, b.faturado), total: () => pct(totalLinha("vencido_1_30"), totalLinha("faturado")) },
    { label: "Vencimento entre 31 e 60 dias", render: (b) => brl(b.vencimento_31_60), total: () => brl(totalLinha("vencimento_31_60")) },
    { label: "Vencido de 31 a 60 dias", render: (b) => brl(b.vencido_31_60), total: () => brl(totalLinha("vencido_31_60")) },
    { label: "Inadimplência 60 dias", render: (b) => pct(b.vencido_31_60, b.faturado), total: () => pct(totalLinha("vencido_31_60"), totalLinha("faturado")) },
    { label: "Vencimento entre 61 e 90 dias", render: (b) => brl(b.vencimento_61_90), total: () => brl(totalLinha("vencimento_61_90")) },
    { label: "Vencido de 61 a 90 dias", render: (b) => brl(b.vencido_61_90), total: () => brl(totalLinha("vencido_61_90")) },
    { label: "Inadimplência 90 dias", render: (b) => pct(b.vencido_61_90, b.faturado), total: () => pct(totalLinha("vencido_61_90"), totalLinha("faturado")) },
    { label: "Vencimento entre 91 a 180 dias", render: (b) => brl(b.vencimento_sup_90), total: () => brl(totalLinha("vencimento_sup_90")) },
    { label: "Vencido entre 91 a 180 dias", render: (b) => brl(b.vencido_sup_90), total: () => brl(totalLinha("vencido_sup_90")) },
    { label: "Inadimplência 180 dias", render: (b) => pct(b.vencido_sup_90, b.faturado), total: () => pct(totalLinha("vencido_sup_90"), totalLinha("faturado")) },
    { label: "Vencimento entre 181 a 365 dias", render: (b) => brl(b.vencimento_sup_180), total: () => brl(totalLinha("vencimento_sup_180")) },
    { label: "Vencido entre 181 a 365 dias", render: (b) => brl(b.vencido_sup_180), total: () => brl(totalLinha("vencido_sup_180")) },
    { label: "Inadimplência 365 dias", render: (b) => pct(b.vencido_sup_180, b.faturado), total: () => pct(totalLinha("vencido_sup_180"), totalLinha("faturado")) },
  ];

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Resumo de Vendas por Risco</h1>
        <p className="text-sm text-muted-foreground">Classificação por faixa de score (A–E) com filtros de loja e período.</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Loja</label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Data inicial</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataInicio && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataInicio ? format(dataInicio, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataInicio} onSelect={setDataInicio} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Data final</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataFim && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataFim ? format(dataFim, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataFim} onSelect={setDataFim} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-end">
              <Button onClick={carregar} disabled={loading} className="w-full">
                {loading ? "Carregando..." : "Aplicar filtros"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Resumo das vendas por risco</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]"></TableHead>
                {FAIXAS.map((f) => (
                  <TableHead key={f.key} className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded text-xs font-bold", f.color)}>
                        {f.label}
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground">{f.sub}</span>
                    </div>
                  </TableHead>
                ))}
                <TableHead className="text-center font-semibold">Totais</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.label}>
                  <TableCell className="font-medium">{l.label}</TableCell>
                  {FAIXAS.map((f) => (
                    <TableCell key={f.key} className="text-right tabular-nums text-xs">
                      {l.render(buckets[f.key], f.key)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums font-semibold text-xs">{l.total()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
