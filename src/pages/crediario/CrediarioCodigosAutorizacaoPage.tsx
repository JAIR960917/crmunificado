import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Copy, Trash2, CheckCircle2, Clock } from "lucide-react";
import { maskCpf } from "@/lib/crediarioFinance";

interface CodigoRow {
  id: string;
  codigo: string;
  criado_em: string;
  usado_em: string | null;
  usado_por: string | null;
  venda_id: string | null;
  venda_nome: string | null;
  venda_cpf: string | null;
  empresa_nome: string | null;
}

const MAX_LOTE = 50;

interface ResumoLoja { nome: string; total: number; }

export default function CrediarioCodigosAutorizacaoPage() {
  const [codigos, setCodigos] = useState<CodigoRow[]>([]);
  const [resumoLojas, setResumoLojas] = useState<ResumoLoja[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [quantidade, setQuantidade] = useState("1");
  const [ultimosCodigos, setUltimosCodigos] = useState<string[]>([]);

  const fetchCodigos = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crediario_codigos_autorizacao")
      .select("id, codigo, criado_em, usado_em, usado_por, venda_id, venda_nome, venda_cpf, empresa_nome")
      .order("criado_em", { ascending: false })
      .limit(100);
    if (error) {
      toast.error("Erro ao carregar histórico de códigos", { description: error.message });
      setCodigos([]);
      setLoading(false);
      return;
    }
    setCodigos((data ?? []) as CodigoRow[]);
    setLoading(false);
  };

  const fetchResumoLojas = async () => {
    const { data, error } = await supabase
      .from("crediario_codigos_autorizacao")
      .select("empresa_nome")
      .not("usado_em", "is", null)
      .limit(5000);
    if (error) return;
    const contagem = new Map<string, number>();
    for (const row of data ?? []) {
      const nome = row.empresa_nome ?? "Loja não identificada";
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }
    setResumoLojas(
      [...contagem.entries()]
        .map(([nome, total]) => ({ nome, total }))
        .sort((a, b) => b.total - a.total),
    );
  };

  useEffect(() => { fetchCodigos(); fetchResumoLojas(); }, []);

  const gerarCodigos = async () => {
    const qtd = Math.min(MAX_LOTE, Math.max(1, Number(quantidade) || 1));
    setGerando(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast.error("Sessão expirada"); setGerando(false); return; }

    const gerados: string[] = [];
    for (let i = 0; i < qtd; i++) {
      let inseriu = false;
      for (let tentativa = 0; tentativa < 5 && !inseriu; tentativa++) {
        const codigo = String(Math.floor(100000 + Math.random() * 900000));
        const { error } = await supabase.from("crediario_codigos_autorizacao").insert({ codigo, criado_por: u.user.id });
        if (!error) { inseriu = true; gerados.push(codigo); break; }
        if (error.code !== "23505") {
          toast.error("Erro ao gerar código", { description: error.message });
          setGerando(false);
          if (gerados.length) { setUltimosCodigos(gerados); fetchCodigos(); }
          return;
        }
      }
    }
    setGerando(false);
    if (gerados.length === 0) { toast.error("Não foi possível gerar os códigos, tente novamente"); return; }
    setUltimosCodigos(gerados);
    toast.success(`${gerados.length} código(s) gerado(s)`);
    fetchCodigos();
  };

  const copy = (text?: string | null) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success("Copiado");
  };

  const revogar = async (id: string) => {
    if (!confirm("Revogar este código? Ele deixará de funcionar.")) return;
    const { error } = await supabase.from("crediario_codigos_autorizacao").delete().eq("id", id).is("usado_em", null);
    if (error) { toast.error("Erro ao revogar", { description: error.message }); return; }
    toast.success("Código revogado");
    fetchCodigos();
  };

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" /> Códigos de Autorização
        </h1>
        <p className="text-muted-foreground">
          Gere códigos de uso único para liberar, por telefone, vendas com entrada abaixo
          do mínimo. O gerente digita o código na tela do contrato e a venda é aprovada
          automaticamente.
        </p>
      </header>

      <Card className="mb-6">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">Gerar novos códigos</h2>
              <p className="text-sm text-muted-foreground">
                Cada código não fica preso a uma venda específica e vale até ser usado uma única vez.
              </p>
            </div>
            <div className="space-y-1.5 w-28">
              <Label htmlFor="quantidade" className="text-xs">Quantidade</Label>
              <Input
                id="quantidade"
                type="number"
                min={1}
                max={MAX_LOTE}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
              />
            </div>
            <Button onClick={gerarCodigos} disabled={gerando} size="lg">
              {gerando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Gerar código(s)
            </Button>
          </div>

          {ultimosCodigos.length > 0 && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-medium">{ultimosCodigos.length} código(s) gerado(s)</p>
                <Button variant="outline" size="sm" onClick={() => copy(ultimosCodigos.join("\n"))}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Copiar todos
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {ultimosCodigos.map((cod) => (
                  <button
                    key={cod}
                    onClick={() => copy(cod)}
                    title="Copiar"
                    className="font-mono text-sm font-semibold tracking-widest rounded-md border px-3 py-1.5 hover:bg-accent transition-colors"
                  >
                    {cod}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {resumoLojas.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-6 space-y-4">
            <h2 className="font-semibold">Uso por loja</h2>
            <p className="text-sm text-muted-foreground">
              Quantos códigos cada loja já usou para liberar vendas com entrada abaixo do mínimo.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead className="text-right">Códigos usados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumoLojas.map((r) => (
                  <TableRow key={r.nome}>
                    <TableCell>{r.nome}</TableCell>
                    <TableCell className="text-right font-semibold">{r.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="font-semibold">Histórico</h2>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : codigos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum código gerado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Gerado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Venda autorizada</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codigos.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.codigo}</TableCell>
                    <TableCell className="text-xs">{new Date(c.criado_em).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      {c.usado_em ? (
                        <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-500/40">
                          <CheckCircle2 className="h-3 w-3" />
                          Usado em {new Date(c.usado_em).toLocaleString("pt-BR")}
                          {c.empresa_nome ? ` · ${c.empresa_nome}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="h-3 w-3" /> Disponível
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.venda_nome ? `${c.venda_nome} · CPF ${maskCpf(c.venda_cpf ?? "")}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {!c.usado_em && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => revogar(c.id)}
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
