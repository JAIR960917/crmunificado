import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, FileSignature, Search, Building2, Database, Zap } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Company { id: string; name: string }
interface Linha {
  company_id: string | null;
  nome: string;
  consultas: number;
  serasa: number;
  bd: number;
  outras: number;
  contratos: number;
}

export default function CrediarioRelatoriosUsoPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("todas");
  const [dataInicio, setDataInicio] = useState<Date | undefined>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d;
  });
  const [dataFim, setDataFim] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);

  useEffect(() => {
    supabase.from("companies").select("id, name").order("name")
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const carregar = async () => {
    if (!dataInicio || !dataFim) {
      toast.error("Selecione o período");
      return;
    }
    setLoading(true);
    try {
      const inicio = new Date(dataInicio); inicio.setHours(0, 0, 0, 0);
      const fim = new Date(dataFim); fim.setHours(23, 59, 59, 999);

      const [
        { data: contratos, error: e1 },
        { data: consultas, error: e2 },
        { data: cPgEntrega, error: e3 },
        { data: cReneg, error: e4 },
      ] = await Promise.all([
        supabase.from("crediario_contracts")
          .select("id, company_id")
          .gte("created_at", inicio.toISOString())
          .lte("created_at", fim.toISOString()),
        supabase.from("crediario_consultas")
          .select("id, company_id, status")
          .gte("created_at", inicio.toISOString())
          .lte("created_at", fim.toISOString()),
        supabase.from("crediario_consultas_pg_entrega")
          .select("id, company_id")
          .gte("created_at", inicio.toISOString())
          .lte("created_at", fim.toISOString()),
        supabase.from("crediario_consultas_renegociacao")
          .select("id, company_id")
          .gte("created_at", inicio.toISOString())
          .lte("created_at", fim.toISOString()),
      ]);

      if (e1 || e2 || e3 || e4) throw new Error(e1?.message || e2?.message || e3?.message || e4?.message);

      const map = new Map<string, Linha>();
      const companyById = new Map(companies.map((c) => [c.id, c]));
      const ensure = (id: string | null): Linha => {
        const key = id ?? "__sem__";
        if (!map.has(key)) {
          map.set(key, {
            company_id: id,
            nome: id ? (companyById.get(id)?.name ?? "—") : "Sem empresa",
            consultas: 0,
            serasa: 0,
            bd: 0,
            outras: 0,
            contratos: 0,
          });
        }
        return map.get(key)!;
      };

      (contratos ?? []).forEach((c) => { ensure(c.company_id).contratos += 1; });
      (consultas ?? []).forEach((c: any) => {
        const row = ensure(c.company_id);
        row.consultas += 1;
        if (c.status === "sucesso") row.serasa += 1;
        else if (c.status === "cache") row.bd += 1;
      });
      (cPgEntrega ?? []).forEach((c) => { ensure(c.company_id).outras += 1; });
      (cReneg ?? []).forEach((c) => { ensure(c.company_id).outras += 1; });

      let result = Array.from(map.values());
      if (companyId !== "todas") {
        result = result.filter((r) => r.company_id === companyId);
      }
      result.sort((a, b) => (b.contratos + b.consultas + b.outras) - (a.contratos + a.consultas + a.outras));
      setLinhas(result);
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (companies.length) carregar(); /* eslint-disable-next-line */ }, [companies]);

  const totais = useMemo(() => ({
    consultas: linhas.reduce((s, l) => s + l.consultas, 0),
    serasa: linhas.reduce((s, l) => s + l.serasa, 0),
    bd: linhas.reduce((s, l) => s + l.bd, 0),
    outras: linhas.reduce((s, l) => s + l.outras, 0),
    contratos: linhas.reduce((s, l) => s + l.contratos, 0),
    empresas: linhas.length,
  }), [linhas]);

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Relatórios de Uso</h1>
        <p className="text-sm text-muted-foreground">Consultas e contratos gerados por empresa, com filtro de período.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Empresa</label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Data início</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataInicio && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataInicio ? format(dataInicio, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataInicio} onSelect={setDataInicio} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Data fim</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataFim && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataFim ? format(dataFim, "dd/MM/yyyy", { locale: ptBR }) : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataFim} onSelect={setDataFim} initialFocus className={cn("p-3 pointer-events-auto")} />
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Empresas</p>
              <p className="mt-1 text-2xl font-bold">{totais.empresas}</p>
            </div>
            <Building2 className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Consultas (total)</p>
              <p className="mt-1 text-2xl font-bold">{totais.consultas}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Serasa + BD</p>
            </div>
            <Search className="h-5 w-5 text-accent" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Serasa</p>
              <p className="mt-1 text-2xl font-bold">{totais.serasa}</p>
            </div>
            <Database className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Outras consultas</p>
              <p className="mt-1 text-2xl font-bold">{totais.outras}</p>
            </div>
            <Zap className="h-5 w-5 text-amber-500" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Contratos</p>
              <p className="mt-1 text-2xl font-bold">{totais.contratos}</p>
            </div>
            <FileSignature className="h-5 w-5 text-emerald-500" />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Detalhamento</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Consultas</TableHead>
                <TableHead className="text-right">Serasa</TableHead>
                <TableHead className="text-right">BD</TableHead>
                <TableHead className="text-right">Outras</TableHead>
                <TableHead className="text-right">Contratos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {loading ? "Carregando..." : "Nenhum dado para o período selecionado."}
                  </TableCell>
                </TableRow>
              )}
              {linhas.map((l) => (
                <TableRow key={l.company_id ?? "sem"}>
                  <TableCell className="font-medium">{l.nome}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.consultas}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.serasa}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.bd}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.outras}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.contratos}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
