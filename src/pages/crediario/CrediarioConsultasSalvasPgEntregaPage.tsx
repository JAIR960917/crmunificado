import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, Trash2, Wallet } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Row {
  id: string;
  user_id: string;
  cpf: string;
  nome: string | null;
  cidade: string | null;
  created_at: string;
}

function formatCPF(cpf: string) {
  const d = (cpf || "").replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function CrediarioConsultasSalvasPgEntregaPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState("");

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crediario_consultas_pg_entrega")
      .select("id, user_id, cpf, nome, cidade, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar consultas");
      return;
    }
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => { carregar(); }, []);

  const filtradas = useMemo(() => {
    const q = filtro.replace(/\D/g, "");
    const t = filtro.trim().toLowerCase();
    if (!q && !t) return rows;
    return rows.filter((r) =>
      (q && r.cpf.includes(q)) || (t && r.nome?.toLowerCase().includes(t))
    );
  }, [rows, filtro]);

  const remover = async (id: string) => {
    if (!confirm("Remover esta consulta?")) return;
    const { error } = await supabase.from("crediario_consultas_pg_entrega").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Removida");
    setRows((r) => r.filter((x) => x.id !== id));
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            Consultas Salvas — Pagamento na Entrega
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico de CPFs consultados pela tela de Pagamento na Entrega.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle>Buscar</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>{filtradas.length} consulta(s)</CardTitle></CardHeader>
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
                      <TableHead>Cidade</TableHead>
                      <TableHead>Consultado</TableHead>
                      {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtradas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{formatCPF(r.cpf)}</TableCell>
                        <TableCell>{r.nome ?? "—"}</TableCell>
                        <TableCell>{r.cidade || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(r.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => remover(r.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
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
