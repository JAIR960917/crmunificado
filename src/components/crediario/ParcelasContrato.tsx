import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Receipt, Copy, ExternalLink, RefreshCw, Zap, FileDown } from "lucide-react";
import { brl } from "@/lib/crediarioFinance";
import { downloadCarnePdf } from "@/lib/crediarioCarne";

interface Parcela {
  id: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  vencimento: string;
  status: string;
  cora_invoice_id: string | null;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  pdf_url: string | null;
  pix_emv: string | null;
  pix_qrcode: string | null;
  erro_mensagem: string | null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-muted text-muted-foreground" },
  emitido: { label: "Emitido", cls: "bg-primary text-primary-foreground" },
  pago: { label: "Pago", cls: "bg-success text-success-foreground" },
  erro: { label: "Erro", cls: "bg-destructive text-destructive-foreground" },
};

const INFO_TEXT = "Os boletos serão gerados sempre no mesmo dia que o cliente escolheu anteriormente";

export function ParcelasContrato({ contratoId, contratoAssinado, vendaAutorizada = true }: {
  contratoId: string;
  contratoAssinado: boolean;
  vendaAutorizada?: boolean;
}) {
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [loading, setLoading] = useState(true);
  const [emitindo, setEmitindo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [baixandoCarne, setBaixandoCarne] = useState(false);
  const [intervalo] = useState("30");

  const carregar = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("crediario_parcelas")
      .select("*")
      .eq("contrato_id", contratoId)
      .order("numero_parcela", { ascending: true });
    setParcelas((data as Parcela[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [contratoId]);

  const emitir = async () => {
    setEmitindo(true);
    try {
      const { data, error } = await supabase.functions.invoke("gerar-emitir-boletos", {
        body: { contrato_id: contratoId, intervalo_dias: Number(intervalo) },
      });
      if (error) {
        toast.error("Falha", { description: error.message });
      } else if (!data?.ok && data?.error) {
        toast.error("Erro", { description: data.error });
      } else {
        toast.success(data?.message || "Boletos processados");
      }
      await carregar();
    } finally {
      setEmitindo(false);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const { data, error } = await supabase.functions.invoke("sincronizar-status-boletos", {
        body: { contrato_id: contratoId },
      });
      if (error) toast.error("Falha ao sincronizar", { description: error.message });
      else if (!data?.ok) toast.error("Erro", { description: data?.error });
      else toast.success(data?.message || "Status sincronizado");
      await carregar();
    } finally {
      setSincronizando(false);
    }
  };

  const copy = (text?: string | null) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success("Copiado");
  };

  const baixarCarne = async () => {
    const emitidas = parcelas.filter((p) =>
      p.cora_invoice_id && (p.linha_digitavel || p.codigo_barras)
    );
    if (emitidas.length === 0) {
      toast.error("Nenhum boleto com código de barras e Pix disponível para gerar o carnê");
      return;
    }
    setBaixandoCarne(true);
    try {
      const { data: contrato } = await supabase
        .from("crediario_contracts").select("nome, cpf, company_id").eq("id", contratoId).maybeSingle();
      const { data: template } = await supabase
        .from("crediario_contract_template")
        .select("company_name, company_cnpj")
        .limit(1)
        .maybeSingle();

      let empresa = {
        nome: template?.company_name || "Empresa",
        cnpj: template?.company_cnpj || "",
      };

      if (contrato?.company_id) {
        const { data: empresaRow } = await supabase
          .from("companies")
          .select("name, cnpj")
          .eq("id", contrato.company_id)
          .maybeSingle();
        if (empresaRow) empresa = { nome: empresaRow.name, cnpj: empresaRow.cnpj ?? "" };
      }

      const safeName = (contrato?.nome || "cliente").replace(/[^\w]+/g, "_").toLowerCase();
      const filename = `carne_${safeName}.pdf`;

      await downloadCarnePdf({
        empresa,
        pagador: { nome: contrato?.nome || "Cliente", cpf: contrato?.cpf || "" },
        data_emissao: new Date().toISOString().slice(0, 10),
        parcelas: emitidas
          .sort((a, b) => a.numero_parcela - b.numero_parcela)
          .map((p) => ({
            numero_parcela: p.numero_parcela,
            total_parcelas: p.total_parcelas,
            valor: Number(p.valor),
            vencimento: p.vencimento,
            linha_digitavel: p.linha_digitavel,
            codigo_barras: p.codigo_barras,
            pix_emv: p.pix_emv || p.pix_qrcode,
            cora_invoice_id: p.cora_invoice_id,
            numero_documento: p.cora_invoice_id,
          })),
      }, filename);
      toast.success("Carnê gerado");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Falha ao gerar carnê", { description: msg });
    } finally {
      setBaixandoCarne(false);
    }
  };

  const naoEmitidas = parcelas.filter((p) => !p.cora_invoice_id).length;
  const todasEmitidas = parcelas.length > 0 && naoEmitidas === 0;

  return (
    <Card className="shadow-elegant mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="h-5 w-5 text-primary" />
          Parcelas e boletos
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {parcelas.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {INFO_TEXT}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {parcelas.some((p) => p.cora_invoice_id) && (
            <>
              <Button variant="outline" size="sm" onClick={sincronizar} disabled={sincronizando}>
                {sincronizando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sincronizar status
              </Button>
              <Button variant="outline" size="sm" onClick={baixarCarne} disabled={baixandoCarne}>
                {baixandoCarne ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                Baixar carnê (PDF)
              </Button>
            </>
          )}
          {contratoAssinado && vendaAutorizada && !todasEmitidas && (
            <Button onClick={emitir} disabled={emitindo} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {emitindo ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Emitindo...</>
              ) : (
                <><Zap className="mr-2 h-4 w-4" />
                  {parcelas.length === 0 ? "Gerar e emitir boletos" : `Emitir ${naoEmitidas} pendentes`}
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!contratoAssinado ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Os boletos só podem ser emitidos após a assinatura do contrato.
          </div>
        ) : !vendaAutorizada ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Os boletos só podem ser emitidos após um administrador autorizar esta venda (entrada abaixo do mínimo).
          </div>
        ) : loading ? (
          <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : parcelas.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma parcela gerada. Clique em "Gerar e emitir boletos" para criar e emitir.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linha digitável</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parcelas.map((p) => {
                const s = STATUS[p.status] ?? STATUS.pendente;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.numero_parcela}/{p.total_parcelas}</TableCell>
                    <TableCell className="text-sm">{new Date(p.vencimento + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-sm font-medium">{brl(Number(p.valor))}</TableCell>
                    <TableCell>
                      <Badge className={s.cls}>{s.label}</Badge>
                      {p.erro_mensagem && (
                        <p className="text-xs text-destructive mt-1 max-w-xs truncate" title={p.erro_mensagem}>{p.erro_mensagem}</p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate" title={p.linha_digitavel ?? ""}>
                      {p.linha_digitavel ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {p.linha_digitavel && (
                          <Button size="sm" variant="ghost" onClick={() => copy(p.linha_digitavel)} title="Copiar linha digitável">
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        {p.pdf_url && (
                          <Button size="sm" variant="ghost" asChild title="Abrir PDF">
                            <a href={p.pdf_url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
