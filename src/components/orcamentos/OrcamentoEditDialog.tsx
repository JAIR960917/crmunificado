import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Phone, PhoneOff, Plus, Trash2, Check, X, CalendarCheck, CalendarX, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneBR, unformatPhone } from "@/lib/phoneFormat";

type ProdutoItem = { nome: string; valor: string };

export type OrcamentoEditData = {
  id: string;
  nome: string;
  telefone: string;
  nao_vendido_motivo: string | null;
  orcamento_observacao: string | null;
  orcamento_produtos_itens: ProdutoItem[] | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orcamento: OrcamentoEditData | null;
  onSaved?: () => void;
};

type Tab = "atividade" | "comentario" | "tarefa";

export default function OrcamentoEditDialog({ open, onOpenChange, orcamento, onSaved }: Props) {
  const { isGerente, isAdmin } = useAuth();
  const canEditMotivo = !isGerente || isAdmin;
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<ProdutoItem[]>([{ nome: "", valor: "" }]);
  const [saving, setSaving] = useState(false);

  // Right column state
  const [tab, setTab] = useState<Tab>("atividade");
  const [atendeu, setAtendeu] = useState<"sim" | "nao" | null>(null);
  const [tratativa, setTratativa] = useState("");
  const [tentativasObs, setTentativasObs] = useState("");
  const [comentario, setComentario] = useState("");
  const [tarefa, setTarefa] = useState("");
  const [tarefaData, setTarefaData] = useState("");

  useEffect(() => {
    if (open && orcamento) {
      setNome(orcamento.nome || "");
      setTelefone(formatPhoneBR(orcamento.telefone || ""));
      setMotivo(orcamento.nao_vendido_motivo || "");
      setObservacao(orcamento.orcamento_observacao || "");
      const arr = Array.isArray(orcamento.orcamento_produtos_itens) ? orcamento.orcamento_produtos_itens : [];
      setItens(arr.length > 0 ? arr : [{ nome: "", valor: "" }]);
      setAtendeu(null);
      setTratativa("");
      setTentativasObs("");
      setComentario("");
      setTarefa("");
      setTarefaData("");
      setTab("atividade");
    }
  }, [open, orcamento]);

  if (!orcamento) return null;

  const valorTotal = itens.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);

  const appendObservacao = (extra: string) => {
    const stamp = new Date().toLocaleString("pt-BR");
    return (observacao.trim() + `\n\n— ${stamp} —\n${extra}`).trim();
  };

  const handleSave = async () => {
    setSaving(true);
    const itensValidos = itens.filter(p => p.nome.trim() && p.valor);

    let novaObs = observacao.trim();
    if (atendeu) {
      if (atendeu === "sim") {
        const partes = ["📞 Cliente ATENDEU"];
        if (tratativa.trim()) partes.push(`Tratativa: ${tratativa.trim()}`);
        novaObs = appendObservacao(partes.join("\n"));
      } else {
        const partes = ["📞 Cliente NÃO ATENDEU"];
        if (tentativasObs.trim()) partes.push(`Tentativas: ${tentativasObs.trim()}`);
        novaObs = appendObservacao(partes.join("\n"));
      }
    }
    if (comentario.trim()) {
      novaObs = (observacao !== novaObs ? novaObs : observacao.trim());
      novaObs = appendObservacao(`💬 Comentário: ${comentario.trim()}`).replace(observacao.trim(), novaObs).trim();
      // simpler:
      const stamp = new Date().toLocaleString("pt-BR");
      novaObs = (novaObs + `\n\n— ${stamp} —\n💬 Comentário: ${comentario.trim()}`).trim();
    }
    if (tarefa.trim()) {
      const stamp = new Date().toLocaleString("pt-BR");
      const dtStr = tarefaData ? ` (para ${tarefaData.split("-").reverse().join("/")})` : "";
      novaObs = (novaObs + `\n\n— ${stamp} —\n📋 Tarefa${dtStr}: ${tarefa.trim()}`).trim();
    }

    const payload: any = {
      nome: nome.trim(),
      telefone: unformatPhone(telefone),
      nao_vendido_motivo: motivo.trim() || null,
      orcamento_observacao: novaObs || null,
      orcamento_produtos_itens: itensValidos,
      orcamento_produtos: itensValidos.map(p => `${p.nome} - R$ ${p.valor}`).join("; ") || null,
      orcamento_valor: itensValidos.reduce((a, p) => a + (parseFloat(p.valor) || 0), 0),
    };

    const { error } = await supabase.from("crm_appointments").update(payload).eq("id", orcamento.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Orçamento atualizado!");
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <DialogTitle asChild>
            <h2 className="text-base font-semibold">Editar Orçamento</h2>
          </DialogTitle>
          <button onClick={() => onOpenChange(false)} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 max-h-[calc(90vh-110px)]">
          {/* LEFT: form fields */}
          <ScrollArea className="border-r max-h-[calc(90vh-110px)]">
            <div className="p-5 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Cliente</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhoneBR(e.target.value))}
                  placeholder="(11) 98765-4321"
                  inputMode="tel"
                />
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Produtos do orçamento</Label>
                  <span className="text-xs text-muted-foreground">Total: R$ {valorTotal.toFixed(2)}</span>
                </div>
                {itens.map((p, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      placeholder="Nome do produto"
                      value={p.nome}
                      onChange={(e) => setItens(itens.map((x, idx) => idx === i ? { ...x, nome: e.target.value } : x))}
                      className="flex-1 h-9 text-sm"
                    />
                    <Input
                      placeholder="Valor"
                      type="number"
                      step="0.01"
                      value={p.valor}
                      onChange={(e) => setItens(itens.map((x, idx) => idx === i ? { ...x, valor: e.target.value } : x))}
                      className="w-28 h-9 text-sm"
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9"
                      onClick={() => setItens(itens.length > 1 ? itens.filter((_, idx) => idx !== i) : [{ nome: "", valor: "" }])}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setItens([...itens, { nome: "", valor: "" }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar produto
                </Button>
              </div>

              {canEditMotivo && (
                <div className="space-y-1">
                  <Label className="text-xs">Motivo da não compra</Label>
                  <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
              )}


            </div>
          </ScrollArea>

          {/* RIGHT: tabs Atividade / Comentário / Tarefa */}
          <ScrollArea className="max-h-[calc(90vh-110px)]">
            <div className="p-5 space-y-4">
              {motivo.trim() && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-semibold text-destructive uppercase tracking-wide">
                      Motivo da não compra
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{motivo}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {(["atividade", "comentario", "tarefa"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      tab === t ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t === "atividade" ? "Atividade" : t === "comentario" ? "Comentário" : "Tarefa"}
                  </button>
                ))}
              </div>

              {tab === "atividade" && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">Tentativa de contato</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">O cliente atendeu?</Label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant={atendeu === "sim" ? "default" : "outline"} className="flex-1"
                        onClick={() => setAtendeu("sim")}>
                        <Phone className="h-3.5 w-3.5 mr-1" /> Sim, atendeu
                      </Button>
                      <Button type="button" size="sm" variant={atendeu === "nao" ? "destructive" : "outline"} className="flex-1"
                        onClick={() => setAtendeu("nao")}>
                        <PhoneOff className="h-3.5 w-3.5 mr-1" /> Não atendeu
                      </Button>
                    </div>
                  </div>
                  {atendeu === "sim" && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Tratativa do contato</Label>
                      <Textarea value={tratativa} onChange={(e) => setTratativa(e.target.value)} rows={3} className="text-sm" placeholder="Descreva o que foi conversado..." />
                      <Button type="button" size="sm" variant="destructive" className="w-full"
                        onClick={() => {
                          if (!tratativa.trim()) { toast.error("Descreva a tratativa"); return; }
                          setObservacao(appendObservacao(`📞 Cliente ATENDEU\nTratativa: ${tratativa.trim()}`));
                          setTratativa("");
                          setAtendeu(null);
                          toast.success("Tratativa registrada");
                        }}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Salvar tratativa
                      </Button>
                    </div>
                  )}
                  {atendeu === "nao" && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Como tentou contato?</Label>
                      <Textarea value={tentativasObs} onChange={(e) => setTentativasObs(e.target.value)} rows={3} className="text-sm" placeholder="Ligação, WhatsApp..." />
                      <Button type="button" size="sm" variant="destructive" className="w-full"
                        onClick={() => {
                          if (!tentativasObs.trim()) { toast.error("Descreva as tentativas"); return; }
                          setObservacao(appendObservacao(`📞 Cliente NÃO ATENDEU\nTentativas: ${tentativasObs.trim()}`));
                          setTentativasObs("");
                          setAtendeu(null);
                          toast.success("Tentativa registrada");
                        }}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Salvar tentativa
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {tab === "atividade" && (() => {
                const entries = observacao
                  .split(/\n\n— /)
                  .map(s => s.trim())
                  .filter(Boolean)
                  .map(block => {
                    const m = block.match(/^(.*?) —\n([\s\S]*)$/);
                    return m ? { when: m[1].replace(/^— /, ""), body: m[2] } : { when: "", body: block };
                  })
                  .reverse();
                if (entries.length === 0) {
                  return (
                    <p className="text-center text-muted-foreground text-sm py-12">
                      Nenhuma atividade registrada ainda.
                    </p>
                  );
                }
                return (
                  <div className="relative pl-6">
                    <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
                    <div className="space-y-3">
                      {entries.map((e, i) => (
                        <div key={i} className="relative">
                          <div className="absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary" />
                          <div className="rounded-lg border bg-muted/30 p-3">
                            {e.when && <div className="text-[11px] text-muted-foreground mb-1">{e.when}</div>}
                            <div className="text-sm whitespace-pre-wrap">{e.body}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {tab === "comentario" && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <Label className="text-xs">Adicionar comentário</Label>
                  <div className="flex gap-2">
                    <Input
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      placeholder="Adicionar comentário..."
                      className="flex-1"
                    />
                    <Button type="button" variant="destructive" size="sm" onClick={() => toast.success("Comentário será salvo ao salvar o orçamento")}>
                      Enviar
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setTab("tarefa")}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Tarefa
                    </Button>
                  </div>
                </div>
              )}

              {tab === "tarefa" && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <Label className="text-xs">Nova tarefa</Label>
                  <Textarea value={tarefa} onChange={(e) => setTarefa(e.target.value)} rows={3} placeholder="Descreva a tarefa..." className="text-sm" />
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Data prevista</Label>
                    <Input type="date" value={tarefaData} onChange={(e) => setTarefaData(e.target.value)} className="h-9 text-sm" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            <Check className="h-3.5 w-3.5 mr-1" />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
