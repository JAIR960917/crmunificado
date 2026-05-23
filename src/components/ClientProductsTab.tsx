import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, RefreshCw, ShoppingBag, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type ItemVenda = {
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
  ordem_servico: { numero: number; status_detalhado: string; entrega: string | null; responsavel_nome?: string | null } | null;
};

type Venda = {
  id: number;
  ssotica_company_id?: string | null;
  loja_nome?: string | null;
  data: string;
  hora: string;
  numero: number;
  status: string;
  valor_bruto: number;
  valor_liquido: number;
  desconto: number;
  funcionario: { id: number; nome: string; funcao: string } | null;
  itens: ItemVenda[];
};

type Props = {
  ssoticaClienteId: number | null | undefined;
  ssoticaCompanyId: string | null | undefined;
  /** CPF do cliente — quando informado, busca vendas em todas as lojas do mesmo CPF */
  cpf?: string | null;
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const groupColor = (grupo: string | null) => {
  if (!grupo) return "bg-muted text-muted-foreground";
  const g = grupo.toLowerCase();
  if (g.includes("lente")) return "bg-blue-500/15 text-blue-500 border-blue-500/30";
  if (g.includes("armaç") || g.includes("armac")) return "bg-purple-500/15 text-purple-500 border-purple-500/30";
  if (g.includes("solar") || g.includes("sol")) return "bg-amber-500/15 text-amber-500 border-amber-500/30";
  if (g.includes("contato")) return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  if (g.includes("acess")) return "bg-pink-500/15 text-pink-500 border-pink-500/30";
  return "bg-muted text-muted-foreground";
};

const cacheKey = (cli: number | string, comp: string, months: number, cpf?: string | null) =>
  `ssotica-vendas:${comp}:${cli}:${months}m${cpf ? `:cpf=${cpf}` : ""}`;

export default function ClientProductsTab({ ssoticaClienteId, ssoticaCompanyId, cpf }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [monthsBack, setMonthsBack] = useState(24);

  const fetchVendas = async (months: number, force = false) => {
    if (!ssoticaClienteId || !ssoticaCompanyId) {
      setError("Cliente sem vínculo SSótica — não é possível buscar produtos.");
      return;
    }
    const key = cacheKey(ssoticaClienteId, ssoticaCompanyId, months, cpf);
    if (!force) {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const parsed = JSON.parse(cached);
          setVendas(parsed.vendas);
          return;
        }
      } catch {}
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("ssotica-cliente-vendas", {
        body: { ssoticaClienteId, ssoticaCompanyId, monthsBack: months, cpf: cpf ?? null },
      });
      if (invErr) throw invErr;
      if (data?.error) throw new Error(data.error);
      setVendas(data.vendas || []);
      try {
        sessionStorage.setItem(key, JSON.stringify({ vendas: data.vendas || [], at: Date.now() }));
      } catch {}
    } catch (err: any) {
      setError(err?.message || "Erro ao buscar produtos do cliente.");
      setVendas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ssoticaClienteId && ssoticaCompanyId && vendas === null) {
      fetchVendas(monthsBack);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssoticaClienteId, ssoticaCompanyId, cpf]);

  if (!ssoticaClienteId || !ssoticaCompanyId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        Este registro não está vinculado a um cliente SSótica, então não é possível listar os produtos.
      </div>
    );
  }

  const totalItens = vendas?.reduce((acc, v) => acc + v.itens.length, 0) ?? 0;
  const totalGeral = vendas?.reduce((acc, v) => acc + v.valor_liquido, 0) ?? 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Histórico de compras</span>
          {vendas && (
            <Badge variant="outline" className="ml-1">
              {vendas.length} venda{vendas.length !== 1 ? "s" : ""} · {totalItens} produto{totalItens !== 1 ? "s" : ""} · {fmtBRL(totalGeral)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background text-xs px-2"
            value={monthsBack}
            onChange={(e) => {
              const m = Number(e.target.value);
              setMonthsBack(m);
              fetchVendas(m);
            }}
            disabled={loading}
          >
            <option value={12}>12 meses</option>
            <option value={24}>24 meses</option>
            <option value={48}>4 anos</option>
            <option value={96}>8 anos</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchVendas(monthsBack, true)}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Buscando histórico de produtos no SSótica…
              <span className="text-xs">Pode levar alguns segundos.</span>
            </div>
          )}

          {!loading && error && (
            <div className="text-center text-sm text-destructive py-8">{error}</div>
          )}

          {!loading && !error && vendas && vendas.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Nenhuma venda encontrada para este cliente nos últimos {monthsBack} meses.
            </div>
          )}

          {!loading && vendas && vendas.length > 0 && vendas.map((v) => (
            <div key={v.id} className="border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Calendar className="h-3.5 w-3.5" />
                    {v.data ? format(new Date(v.data + "T00:00:00"), "dd 'de' MMM 'de' yyyy", { locale: ptBR }) : "—"}
                  </div>
                  <span className="text-muted-foreground">Venda #{v.numero}</span>
                  {v.loja_nome && (
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                      Loja: {v.loja_nome}
                    </Badge>
                  )}
                  {v.funcionario?.nome && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <User className="h-3 w-3" />
                      {v.funcionario.nome}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold">{fmtBRL(v.valor_liquido)}</div>
              </div>

              <div className="divide-y">
                {v.itens.length === 0 && (
                  <div className="px-4 py-3 text-xs text-muted-foreground italic">
                    Sem itens detalhados nesta venda.
                  </div>
                )}
                {v.itens.map((it) => (
                  <div key={it.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="mt-0.5 h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {it.produto?.descricao || "Produto sem descrição"}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                          {it.produto?.grupo && (
                            <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${groupColor(it.produto.grupo)}`}>
                              {it.produto.grupo}
                            </Badge>
                          )}
                          {it.produto?.grife && it.produto.grife !== it.produto.grupo && (
                            <span className="text-[11px] text-muted-foreground">{it.produto.grife}</span>
                          )}
                          {it.produto?.referencia && (
                            <span className="text-[11px] text-muted-foreground">Ref: {it.produto.referencia}</span>
                          )}
                          {it.ordem_servico?.status_detalhado && (
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                              OS {it.ordem_servico.numero}
                              {it.ordem_servico.responsavel_nome ? ` · ${it.ordem_servico.responsavel_nome}` : ""}
                              {`: ${it.ordem_servico.status_detalhado}`}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium">{fmtBRL(it.valor_total_liquido)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {it.quantidade}× {fmtBRL(it.valor_unitario_liquido)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
