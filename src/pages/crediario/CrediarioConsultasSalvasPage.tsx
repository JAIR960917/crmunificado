import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, Database, Clock, Trash2, Filter, Users } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface CacheRow {
  id: string;
  cpf: string;
  nome: string | null;
  data_nascimento: string | null;
  score: number | null;
  consultado_em: string;
  expira_em: string;
}

function formatCPF(cpf: string) {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

interface ConsultaRow {
  id: string;
  user_id: string;
  cpf: string;
  nome: string | null;
  score: number | null;
  status: string;
  created_at: string;
}

interface OperadorOpt { user_id: string; full_name: string; email: string }

export default function CrediarioConsultasSalvasPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [consultas, setConsultas] = useState<ConsultaRow[]>([]);
  const [operadores, setOperadores] = useState<OperadorOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState("");

  // Filtros do relatório por gerente
  const [gerenteFiltro, setGerenteFiltro] = useState<string>("todos");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [filtrosAplicados, setFiltrosAplicados] = useState({
    gerente: "todos", dataInicio: "", dataFim: "",
  });

  const carregar = async () => {
    setLoading(true);
    const [{ data: cache, error }, { data: cons }, { data: profs }] = await Promise.all([
      supabase
        .from("crediario_consultas_cache")
        .select("id, cpf, nome, data_nascimento, score, consultado_em, expira_em")
        .order("consultado_em", { ascending: false })
        .limit(500),
      supabase
        .from("crediario_consultas")
        .select("id, user_id, cpf, nome, score, status, created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase.from("profiles").select("user_id, full_name, email"),
    ]);
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar consultas salvas");
      return;
    }
    setRows(cache ?? []);
    setConsultas((cons as ConsultaRow[]) ?? []);
    setOperadores((profs as OperadorOpt[]) ?? []);
  };

  useEffect(() => { carregar(); }, []);

  const filtradas = useMemo(() => {
    const q = filtro.replace(/\D/g, "");
    if (!q && !filtro.trim()) return rows;
    return rows.filter((r) => {
      const cpfMatch = q && r.cpf.includes(q);
      const nomeMatch = filtro.trim() && r.nome?.toLowerCase().includes(filtro.trim().toLowerCase());
      return cpfMatch || nomeMatch;
    });
  }, [rows, filtro]);

  const opMap = useMemo(() => {
    const m = new Map<string, OperadorOpt>();
    operadores.forEach((o) => m.set(o.user_id, o));
    return m;
  }, [operadores]);

  const consultasFiltradas = useMemo(() => {
    return consultas.filter((c) => {
      if (filtrosAplicados.gerente !== "todos" && c.user_id !== filtrosAplicados.gerente) return false;
      if (filtrosAplicados.dataInicio && c.created_at < filtrosAplicados.dataInicio) return false;
      if (filtrosAplicados.dataFim && c.created_at > filtrosAplicados.dataFim + "T23:59:59") return false;
      return true;
    });
  }, [consultas, filtrosAplicados]);

  const porGerente = useMemo(() => {
    const map = new Map<string, { user_id: string; nome: string; email: string; total: number; sucesso: number; erro: number }>();
    consultasFiltradas.forEach((c) => {
      const op = opMap.get(c.user_id);
      const key = c.user_id;
      const cur = map.get(key) ?? {
        user_id: c.user_id,
        nome: op?.full_name || "—",
        email: op?.email || "",
        total: 0, sucesso: 0, erro: 0,
      };
      cur.total += 1;
      if (c.status === "sucesso") cur.sucesso += 1;
      else cur.erro += 1;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [consultasFiltradas, opMap]);

  const aplicarFiltros = () => {
    setFiltrosAplicados({ gerente: gerenteFiltro, dataInicio, dataFim });
  };
  const limparFiltros = () => {
    setGerenteFiltro("todos"); setDataInicio(""); setDataFim("");
    setFiltrosAplicados({ gerente: "todos", dataInicio: "", dataFim: "" });
  };

  const remover = async (id: string) => {
    if (!confirm("Remover esta consulta do cache? Na próxima consulta o sistema buscará novamente na Serasa.")) return;
    const { error } = await supabase.from("crediario_consultas_cache").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Removida do cache");
    setRows((r) => r.filter((x) => x.id !== id));
  };

  const ativos = rows.filter((r) => new Date(r.expira_em) > new Date()).length;
  const expirados = rows.length - ativos;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Consultas Salvas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            CPFs consultados nos últimos 3 meses são reutilizados automaticamente, evitando uma nova chamada à Serasa.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Total no cache</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{rows.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Ativos (válidos)</CardTitle>
              <Clock className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-emerald-500">{ativos}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Expirados</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-muted-foreground">{expirados}</div></CardContent>
          </Card>
        </div>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Consultas por gerente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filtros</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <Label className="text-xs">Gerente</Label>
                  <Select value={gerenteFiltro} onValueChange={setGerenteFiltro}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {operadores.map((o) => (
                        <SelectItem key={o.user_id} value={o.user_id}>
                          {o.full_name || o.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Data inicial</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Data final</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={aplicarFiltros} className="flex-1">Aplicar</Button>
                  <Button variant="outline" onClick={limparFiltros}>Limpar</Button>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                Total de consultas no período: <strong className="text-foreground">{consultasFiltradas.length}</strong>
              </div>

              {porGerente.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma consulta no período selecionado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gerente</TableHead>
                        <TableHead>E-mail</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Serasa</TableHead>
                        <TableHead className="text-right">BD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {porGerente.map((g) => (
                        <TableRow key={g.user_id}>
                          <TableCell className="font-medium">{g.nome}</TableCell>
                          <TableCell className="text-muted-foreground">{g.email}</TableCell>
                          <TableCell className="text-right font-bold">{g.total}</TableCell>
                          <TableCell className="text-right text-emerald-600">{g.sucesso}</TableCell>
                          <TableCell className="text-right text-destructive">{g.erro}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Buscar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar por CPF ou nome…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{filtradas.length} consulta(s)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : filtradas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma consulta encontrada.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CPF</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Nascimento</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Consultado</TableHead>
                      <TableHead>Validade</TableHead>
                      {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtradas.map((r) => {
                      const expirado = new Date(r.expira_em) <= new Date();
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono">{formatCPF(r.cpf)}</TableCell>
                          <TableCell>{r.nome ?? "—"}</TableCell>
                          <TableCell>
                            {r.data_nascimento
                              ? format(new Date(r.data_nascimento + "T00:00:00"), "dd/MM/yyyy")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{r.score ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(r.consultado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </TableCell>
                          <TableCell>
                            {expirado ? (
                              <Badge variant="secondary">Expirado</Badge>
                            ) : (
                              <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                                Expira {formatDistanceToNow(new Date(r.expira_em), { locale: ptBR, addSuffix: true })}
                              </Badge>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <Button size="sm" variant="ghost" onClick={() => remover(r.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
