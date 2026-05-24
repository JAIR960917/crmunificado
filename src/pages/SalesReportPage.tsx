import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarComp } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, FileDown, RefreshCw, Calendar, CalendarIcon, Package, Users, ShoppingBag, Layers } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/contexts/AuthContext";

type Venda = {
  id: number;
  data: string;
  hora: string;
  numero: number;
  status: string;
  valor_liquido: number;
  valor_bruto: number;
  desconto: number;
  company_id: string;
  company_name: string;
  cliente: { id: number; nome: string } | null;
  funcionario: { id: number; nome: string; funcao: string } | null;
  itens: Array<{
    id: number;
    quantidade: number;
    valor_unitario_liquido: number;
    valor_total_liquido: number;
    produto: {
      id: number;
      referencia: string | null;
      descricao: string;
      grupo: string | null;
      grife: string | null;
    } | null;
  }>;
};

type Company = { id: string; name: string };

const ALL = "__ALL__";

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Calcula a quarta-feira mais próxima (passada ou hoje) e a anterior
function getDefaultRange() {
  const today = new Date();
  // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
  const dow = today.getDay();
  // Dias até a última quarta (incluindo hoje se for quarta)
  const daysToLastWed = (dow - 3 + 7) % 7;
  const endWed = new Date(today);
  endWed.setDate(today.getDate() - daysToLastWed);
  endWed.setHours(0, 0, 0, 0);
  const startWed = new Date(endWed);
  startWed.setDate(endWed.getDate() - 7);
  return {
    start: startWed.toISOString().slice(0, 10),
    end: endWed.toISOString().slice(0, 10),
  };
}

export default function SalesReportPage() {
  const { isAdmin } = useAuth();
  const def = getDefaultRange();
  const [startDate, setStartDate] = useState<string>(def.start);
  const [endDate, setEndDate] = useState<string>(def.end);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [vendas, setVendas] = useState<Venda[] | null>(null);

  useEffect(() => {
    (async () => {
      // Apenas empresas que possuem integração SSótica ativa
      const { data: integs } = await supabase
        .from("ssotica_integrations")
        .select("company_id, is_active")
        .eq("is_active", true);
      const ids = new Set<string>((integs || []).map((i: any) => i.company_id));
      const { data } = await supabase
        .from("companies")
        .select("id, name")
        .order("name");
      const filtered = ((data as Company[]) || []).filter((c) => ids.has(c.id));
      setCompanies(filtered);
    })();
  }, []);

  const fetchReport = async () => {
    if (!startDate || !endDate) {
      toast.error("Selecione as datas inicial e final");
      return;
    }
    if (startDate > endDate) {
      toast.error("A data inicial deve ser anterior à final");
      return;
    }
    if (companies.length === 0) {
      toast.error("Nenhuma empresa com integração SSótica ativa");
      return;
    }
    const targets =
      companyFilter === ALL ? companies : companies.filter((c) => c.id === companyFilter);
    if (targets.length === 0) {
      toast.error("Selecione uma empresa válida");
      return;
    }

    setLoading(true);
    setProgress({ done: 0, total: targets.length });
    setVendas(null);
    const all: Venda[] = [];
    let completed = 0;
    const errors: string[] = [];

    // Processa empresas SEQUENCIALMENTE (uma por vez) para evitar sobrecarregar o SSótica
    for (const c of targets) {
      try {
        const { data, error } = await supabase.functions.invoke(
          "ssotica-vendas-periodo",
          {
            body: {
              startDate,
              endDate,
              companyId: c.id,
            },
          },
        );
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        all.push(...((data?.vendas as Venda[]) || []));
      } catch (err: any) {
        console.error(`[relatorio-vendas] empresa ${c.name}`, err);
        errors.push(`${c.name}: ${err?.message || "erro"}`);
      } finally {
        completed += 1;
        setProgress({ done: completed, total: targets.length });
        // Atualiza incrementalmente para o usuário ver o progresso
        setVendas([...all].sort((a, b) => (b.data || "").localeCompare(a.data || "")));
      }
    }

    setLoading(false);
    setProgress(null);
    if (errors.length > 0) {
      toast.warning(
        `Relatório gerado com ${errors.length} erro(s). ${all.length} vendas carregadas.`,
      );
    } else {
      toast.success(`${all.length} venda(s) encontrada(s) no período`);
    }
  };

  // Categorias agregadas (independente do modelo/marca específica)
  const CATEGORIAS = [
    "Armação",
    "Óculos Solar",
    "Lentes",
    "Combo de Lentes",
    "Lentes de Contato",
    "Caixa 3 Pares",
    "Consulta A 50",
    "Consulta A 100",
  ] as const;
  type Categoria = typeof CATEGORIAS[number] | "Outros";

  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  function classificarItem(
    grupo: string | null | undefined,
    descricao: string | null | undefined,
  ): Categoria {
    const g = norm(grupo || "");
    const d = norm(descricao || "");
    const t = `${g} ${d}`;

    // Consultas (verificar antes de "armação" para evitar falsos positivos)
    if (/consulta/.test(t) && /\b(a\s*100|a100|100)\b/.test(t)) return "Consulta A 100";
    if (/consulta/.test(t) && /\b(a\s*50|a50|50)\b/.test(t)) return "Consulta A 50";

    // Óculos Solar (verificar antes de "armação" porque solar pode conter armação)
    if (/solar/.test(t) || /\bsol\b/.test(t)) return "Óculos Solar";

    // Caixa 3 pares (verificar antes de Lentes)
    if (/caixa/.test(t) && /3\s*pares?/.test(t)) return "Caixa 3 Pares";

    // Lentes de contato (verificar antes de "Lentes" genérico)
    if (/lente/.test(t) && /contato/.test(t)) return "Lentes de Contato";

    // Combo de lentes (verificar antes de "Lentes" genérico)
    if (/combo/.test(t) && /lente/.test(t)) return "Combo de Lentes";

    // Lentes oftálmicas / demais
    if (/lente/.test(t)) return "Lentes";

    // Armação (grau)
    if (/armaca/.test(t) || /\barma\b/.test(t)) return "Armação";

    return "Outros";
  }

  // Agrupa por categoria de produto (somando quantidades)
  const groupedByCategoria = useMemo(() => {
    const map = new Map<
      Categoria,
      { categoria: Categoria; quantidade: number; valorTotal: number; vendasUnicas: Set<number> }
    >();
    for (const cat of CATEGORIAS) {
      map.set(cat, {
        categoria: cat,
        quantidade: 0,
        valorTotal: 0,
        vendasUnicas: new Set(),
      });
    }
    map.set("Outros", {
      categoria: "Outros",
      quantidade: 0,
      valorTotal: 0,
      vendasUnicas: new Set(),
    });

    const debugCombos: any[] = [];
    (vendas || []).forEach((v) => {
      v.itens.forEach((it) => {
        const desc = (it.produto?.descricao || "").toLowerCase();
        if (desc.includes("combo")) {
          debugCombos.push({
            venda: v.numero,
            data: v.data,
            status: v.status,
            empresa: v.company_name,
            grupo: it.produto?.grupo,
            descricao: it.produto?.descricao,
            qtd: it.quantidade,
            classificadoComo: classificarItem(it.produto?.grupo, it.produto?.descricao),
          });
        }
        const cat = classificarItem(it.produto?.grupo, it.produto?.descricao);
        const cur = map.get(cat)!;
        cur.quantidade += Number(it.quantidade || 0);
        cur.valorTotal += Number(it.valor_total_liquido || 0);
        cur.vendasUnicas.add(v.id);
      });
    });
    if (debugCombos.length > 0) {
      console.log("[Relatório] Itens com 'combo' encontrados:", debugCombos);
    } else if ((vendas || []).length > 0) {
      console.log("[Relatório] Nenhum item com 'combo' retornado pela SSótica neste período.");
    }

    // Mostra apenas categorias com pelo menos 1 produto vendido,
    // mantendo a ordem fixa das CATEGORIAS e "Outros" no fim.
    const order: Categoria[] = [...CATEGORIAS, "Outros"];
    return order
      .map((c) => map.get(c)!)
      .filter((g) => g.quantidade > 0)
      .map((g) => ({
        categoria: g.categoria,
        quantidade: g.quantidade,
        valorTotal: g.valorTotal,
        vendas: g.vendasUnicas.size,
      }));
  }, [vendas]);

  // Agrupa por vendedor (funcionario.nome). Vendas sem funcionário vão em "Sem vendedor".
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        nome: string;
        funcao: string;
        vendas: Venda[];
        totalValor: number;
        totalItens: number;
      }
    >();
    (vendas || []).forEach((v) => {
      const key = v.funcionario?.nome || "Sem vendedor";
      const cur = map.get(key) || {
        nome: key,
        funcao: v.funcionario?.funcao || "",
        vendas: [],
        totalValor: 0,
        totalItens: 0,
      };
      cur.vendas.push(v);
      cur.totalValor += v.valor_liquido;
      cur.totalItens += v.itens.reduce((a, it) => a + it.quantidade, 0);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.totalValor - a.totalValor);
  }, [vendas]);

  const totalGeral = grouped.reduce((a, g) => a + g.totalValor, 0);
  const totalItensGeral = grouped.reduce((a, g) => a + g.totalItens, 0);
  const totalVendasGeral = grouped.reduce((a, g) => a + g.vendas.length, 0);

  // Resume as categorias de UM vendedor (apenas categorias com qtd > 0)
  function categoriasDoVendedor(vendasDoVendedor: Venda[]) {
    const map = new Map<Categoria, { quantidade: number; valorTotal: number }>();
    for (const cat of CATEGORIAS) map.set(cat, { quantidade: 0, valorTotal: 0 });
    map.set("Outros", { quantidade: 0, valorTotal: 0 });

    vendasDoVendedor.forEach((v) => {
      v.itens.forEach((it) => {
        const cat = classificarItem(it.produto?.grupo, it.produto?.descricao);
        const cur = map.get(cat)!;
        cur.quantidade += Number(it.quantidade || 0);
        cur.valorTotal += Number(it.valor_total_liquido || 0);
      });
    });

    const order: Categoria[] = [...CATEGORIAS, "Outros"];
    return order
      .map((c) => ({ categoria: c, ...map.get(c)! }))
      .filter((g) => g.quantidade > 0);
  }


  const exportPDF = () => {
    if (!vendas || vendas.length === 0) {
      toast.error("Nenhum dado para exportar");
      return;
    }
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Relatório de Vendas por Vendedor", 40, 50);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const periodo = `Período: ${format(new Date(startDate + "T00:00:00"), "dd/MM/yyyy")} a ${format(new Date(endDate + "T00:00:00"), "dd/MM/yyyy")}`;
    doc.text(periodo, 40, 70);

    const empresaTxt =
      companyFilter === ALL
        ? "Todas as empresas"
        : companies.find((c) => c.id === companyFilter)?.name || "—";
    doc.text(`Empresa: ${empresaTxt}`, 40, 86);
    doc.text(
      `Total: ${totalVendasGeral} venda(s) · ${totalItensGeral} produto(s) · ${fmtBRL(totalGeral)}`,
      40,
      102,
    );

    let y = 120;

    // Resumo por Categoria (visão consolidada de produtos vendidos)
    if (groupedByCategoria.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Resumo por Categoria", 40, y);
      y += 10;
      autoTable(doc, {
        startY: y,
        head: [["Categoria", "Qtd vendida", "Valor total"]],
        body: groupedByCategoria.map((c) => [
          c.categoria,
          String(c.quantidade),
          fmtBRL(c.valorTotal),
        ]),
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [60, 60, 60], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 220 },
          1: { cellWidth: 90, halign: "center" },
          2: { cellWidth: 120, halign: "right" },
        },
        margin: { left: 40, right: 40 },
      });
      y = (doc as any).lastAutoTable.finalY + 24;
    }

    grouped.forEach((g, idx) => {
      // Sub-cabeçalho do vendedor
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      doc.setFillColor(30, 30, 30);
      doc.setTextColor(255, 255, 255);
      doc.rect(40, y, pageWidth - 80, 22, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`${g.nome}${g.funcao ? ` — ${g.funcao}` : ""}`, 48, y + 15);
      const right = `${g.vendas.length} venda(s) · ${g.totalItens} produto(s) · ${fmtBRL(g.totalValor)}`;
      doc.text(right, pageWidth - 48 - doc.getTextWidth(right), y + 15);
      doc.setTextColor(0, 0, 0);
      y += 28;

      // Resumo por categoria do vendedor
      const catRows = categoriasDoVendedor(g.vendas).map((c) => [
        c.categoria,
        String(c.quantidade),
        fmtBRL(c.valorTotal),
      ]);

      autoTable(doc, {
        startY: y,
        head: [["Categoria", "Qtd vendida", "Valor total"]],
        body: catRows.length > 0 ? catRows : [["Sem produtos", "0", fmtBRL(0)]],
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 260 },
          1: { cellWidth: 100, halign: "center" },
          2: { cellWidth: 130, halign: "right" },
        },
        margin: { left: 40, right: 40 },
      });

      y = (doc as any).lastAutoTable.finalY + 18;
    });

    const filename = `relatorio-vendas-${startDate}-a-${endDate}.pdf`;
    doc.save(filename);
    toast.success("PDF gerado!");
  };

  const showCompanyFilter = isAdmin;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Relatório de Vendas
            </h1>
            <p className="text-sm text-muted-foreground">
              Produtos vendidos por vendedor em um período
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex flex-col">
                <Label className="mb-2">Data inicial</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "justify-start text-left font-normal",
                        !startDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate
                        ? format(new Date(startDate + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })
                        : "Selecionar..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComp
                      mode="single"
                      locale={ptBR}
                      selected={startDate ? new Date(startDate + "T00:00:00") : undefined}
                      onSelect={(d) => d && setStartDate(format(d, "yyyy-MM-dd"))}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col">
                <Label className="mb-2">Data final</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "justify-start text-left font-normal",
                        !endDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate
                        ? format(new Date(endDate + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR })
                        : "Selecionar..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComp
                      mode="single"
                      locale={ptBR}
                      selected={endDate ? new Date(endDate + "T00:00:00") : undefined}
                      onSelect={(d) => d && setEndDate(format(d, "yyyy-MM-dd"))}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {showCompanyFilter && (
                <div>
                  <Label>Empresa</Label>
                  <Select value={companyFilter} onValueChange={setCompanyFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as empresas</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-end gap-2">
                <Button onClick={fetchReport} disabled={loading} className="flex-1">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {progress
                        ? `${progress.done}/${progress.total} empresas`
                        : "Carregando..."}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Gerar
                    </>
                  )}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Atalhos:</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const d = getDefaultRange();
                  setStartDate(d.start);
                  setEndDate(d.end);
                }}
              >
                Quarta a quarta
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const today = new Date();
                  const start = new Date(today);
                  start.setDate(today.getDate() - 7);
                  setStartDate(start.toISOString().slice(0, 10));
                  setEndDate(today.toISOString().slice(0, 10));
                }}
              >
                Últimos 7 dias
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const today = new Date();
                  const start = new Date(today);
                  start.setDate(today.getDate() - 30);
                  setStartDate(start.toISOString().slice(0, 10));
                  setEndDate(today.toISOString().slice(0, 10));
                }}
              >
                Últimos 30 dias
              </Button>
            </div>
          </CardContent>
        </Card>

        {vendas !== null && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">Vendedores</div>
                      <div className="text-2xl font-bold">{grouped.length}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">Vendas</div>
                      <div className="text-2xl font-bold">{totalVendasGeral}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="text-xs text-muted-foreground">Produtos</div>
                      <div className="text-2xl font-bold">{totalItensGeral}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground">Valor total</div>
                  <div className="text-2xl font-bold">{fmtBRL(totalGeral)}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Resumo por Categoria
                </CardTitle>
              </CardHeader>
              <CardContent>
                {groupedByCategoria.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Nenhum produto categorizado no período.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {groupedByCategoria.map((c) => (
                      <div
                        key={c.categoria}
                        className="rounded-lg border bg-card p-4 flex flex-col gap-1"
                      >
                        <div className="text-xs text-muted-foreground uppercase tracking-wide">
                          {c.categoria}
                        </div>
                        <div className="text-3xl font-bold leading-none">
                          {c.quantidade}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          produto(s) vendido(s)
                        </div>
                        <div className="text-xs font-medium text-primary mt-1">
                          {fmtBRL(c.valorTotal)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                onClick={exportPDF}
                disabled={!vendas || vendas.length === 0}
                variant="default"
              >
                <FileDown className="h-4 w-4 mr-2" />
                Exportar PDF
              </Button>
            </div>

            {grouped.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhuma venda encontrada no período selecionado.
                </CardContent>
              </Card>
            ) : (
              <Accordion type="multiple" className="space-y-3">
                {grouped.map((g) => (
                  <AccordionItem
                    key={g.nome}
                    value={g.nome}
                    className="border rounded-lg bg-card"
                  >
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-3 gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                            {g.nome.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="text-left min-w-0">
                            <div className="font-medium truncate">{g.nome}</div>
                            {g.funcao && (
                              <div className="text-xs text-muted-foreground">
                                {g.funcao}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">
                            {g.vendas.length} venda(s)
                          </Badge>
                          <Badge variant="outline">
                            {g.totalItens} produto(s)
                          </Badge>
                          <Badge className="bg-primary/10 text-primary border-primary/30">
                            {fmtBRL(g.totalValor)}
                          </Badge>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      {(() => {
                        const cats = categoriasDoVendedor(g.vendas);
                        if (cats.length === 0) {
                          return (
                            <div className="text-sm text-muted-foreground italic px-1 py-2">
                              Sem produtos categorizados.
                            </div>
                          );
                        }
                        return (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                            {cats.map((c) => (
                              <div
                                key={c.categoria}
                                className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-1"
                              >
                                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                  {c.categoria}
                                </div>
                                <div className="text-2xl font-bold leading-none">
                                  {c.quantidade}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  produto(s)
                                </div>
                                <div className="text-xs font-medium text-primary mt-1">
                                  {fmtBRL(c.valorTotal)}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
