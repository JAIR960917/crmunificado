import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Phone, PhoneOff, Check, X, ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Atendeu = "sim" | "nao" | null;
type Renegociou = "sim" | "nao" | null;

type Props = {
  cobrancaId: string;
  userId: string;
  userName?: string;
  cobrancaData: Record<string, any>;
  /** Status atual do card (ex.: "31_dias_de_atraso_ligao") — usado para registrar tratativa por coluna */
  cobrancaStatus?: string | null;
  onSaved?: () => void;
};

export default function CobrancaContactAttemptForm({
  cobrancaId, userId, userName, cobrancaData, cobrancaStatus, onSaved,
}: Props) {
  const [atendeu, setAtendeu] = useState<Atendeu>(null);
  const [observacao, setObservacao] = useState("");
  const [renegociou, setRenegociou] = useState<Renegociou>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setAtendeu(null);
    setObservacao("");
    setRenegociou(null);
  };

  const buildNoteContent = () => {
    const lines: string[] = [];
    lines.push(`📞 Tentativa de contato — Cliente ${atendeu === "sim" ? "ATENDEU" : "NÃO ATENDEU"}`);
    if (atendeu === "sim") {
      if (observacao.trim()) lines.push(`Observação: ${observacao.trim()}`);
      if (renegociou === "sim") lines.push("✅ Cliente RENEGOCIOU");
      else if (renegociou === "nao") lines.push("❌ Cliente NÃO renegociou");
    }
    return lines.join("\n");
  };

  const handleSave = async () => {
    if (!atendeu) {
      toast.error("Selecione se o cliente atendeu");
      return;
    }
    if (atendeu === "sim" && !observacao.trim()) {
      toast.error("Descreva a observação do contato");
      return;
    }
    if (atendeu === "sim" && !renegociou) {
      toast.error("Informe se o cliente renegociou");
      return;
    }

    setSaving(true);
    try {
      // 1) Cria a nota da tentativa
      const { error: noteErr } = await supabase.from("crm_cobranca_notes").insert({
        cobranca_id: cobrancaId,
        user_id: userId,
        content: buildNoteContent(),
      });
      if (noteErr) throw noteErr;

      // 2) Atualiza o card: marca tratativa para o fluxo + flag de renegociação (se houver)
      const nowIso = new Date().toISOString();
      const newData: Record<string, any> = {
        ...cobrancaData,
        // Tratativa para o fluxo automático: começa a contar a partir daqui
        tratativa_em: nowIso,
        tratativa_status_key: cobrancaStatus || cobrancaData?.tratativa_status_key || null,
        tratativa_by: userId,
        tratativa_by_name: userName || null,
        tratativa_atendeu: atendeu,
      };
      if (atendeu === "sim" && renegociou) {
        newData.renegociou = renegociou;
        newData.renegociou_at = nowIso;
        newData.renegociou_by = userId;
        newData.renegociou_by_name = userName || null;
        newData.renegociou_observacao = observacao.trim();
      }
      const { error: updErr } = await supabase
        .from("crm_cobrancas")
        .update({ data: newData })
        .eq("id", cobrancaId);
      if (updErr) throw updErr;

      // 3) Registra evento na timeline do fluxo
      await (supabase as any).from("crm_cobranca_flow_events").insert({
        cobranca_id: cobrancaId,
        status_key: cobrancaStatus || null,
        event_type: "tratativa",
        created_by: userId,
        details: {
          atendeu,
          renegociou: atendeu === "sim" ? renegociou : null,
          observacao: atendeu === "sim" ? observacao.trim() : null,
        },
      });

      // 4) Se renegociou: cria card em Renovações e remove a cobrança
      if (atendeu === "sim" && renegociou === "sim") {
        // Busca dados completos da cobrança para migrar
        const { data: cob } = await supabase
          .from("crm_cobrancas")
          .select("*")
          .eq("id", cobrancaId)
          .maybeSingle();

        if (cob) {
          const renovacaoData = {
            ...(cob.data as any),
            origem_cobranca_id: cobrancaId,
            renegociado_em: nowIso,
            renegociado_por: userId,
            renegociado_por_nome: userName || null,
            renegociado_observacao: observacao.trim(),
          };

          const { error: renovErr } = await supabase.from("crm_renovacoes").insert({
            status: "novo",
            assigned_to: cob.assigned_to,
            created_by: userId,
            data: renovacaoData,
            data_ultima_compra: null,
            ssotica_cliente_id: cob.ssotica_cliente_id,
            ssotica_company_id: cob.ssotica_company_id || cob.company_id,
            valor: cob.valor || 0,
          } as any);
          if (renovErr) {
            console.error("Falha ao criar renovação:", renovErr);
            toast.error("Renegociado salvo, mas falhou ao mover para Renovações: " + renovErr.message);
          } else {
            // Remove a cobrança da tela
            const { error: delErr } = await supabase
              .from("crm_cobrancas")
              .delete()
              .eq("id", cobrancaId);
            if (delErr) {
              console.error("Falha ao remover cobrança:", delErr);
              toast.error("Renovação criada, mas cobrança permanece: " + delErr.message);
            } else {
              toast.success("Cliente renegociou — movido para Renovações!");
              reset();
              onSaved?.();
              return;
            }
          }
        }
      }

      toast.success("Contato registrado!");
      reset();
      onSaved?.();
    } catch (err: any) {
      console.error("CobrancaContactAttemptForm save error:", err);
      toast.error("Erro ao registrar contato: " + (err?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const renegociouAtual = (cobrancaData?.renegociou as string | undefined) || null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-destructive" />
          <span className="text-sm font-semibold">Tentativa de contato</span>
        </div>
        {renegociouAtual && (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
              renegociouAtual === "sim"
                ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                : "bg-red-500/15 text-red-600 border border-red-500/30"
            }`}
          >
            {renegociouAtual === "sim" ? "Renegociou" : "Não renegociou"}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">O cliente atendeu?</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={atendeu === "sim" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setAtendeu("sim")}
          >
            <Phone className="h-3.5 w-3.5 mr-1" /> Sim, atendeu
          </Button>
          <Button
            type="button"
            size="sm"
            variant={atendeu === "nao" ? "destructive" : "outline"}
            className="flex-1"
            onClick={() => { setAtendeu("nao"); setRenegociou(null); }}
          >
            <PhoneOff className="h-3.5 w-3.5 mr-1" /> Não atendeu
          </Button>
        </div>
      </div>

      {atendeu === "sim" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Observação <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              placeholder="Descreva o que foi conversado com o cliente..."
              className="text-sm min-h-[80px]"
              maxLength={1000}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              O cliente renegociou? <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={renegociou === "sim" ? "default" : "outline"}
                className={`flex-1 ${renegociou === "sim" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                onClick={() => setRenegociou("sim")}
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Sim, Renegociei
              </Button>
              <Button
                type="button"
                size="sm"
                variant={renegociou === "nao" ? "destructive" : "outline"}
                className="flex-1"
                onClick={() => setRenegociou("nao")}
              >
                <ThumbsDown className="h-3.5 w-3.5 mr-1" /> Não, Renegociou
              </Button>
            </div>
          </div>
        </>
      )}

      {atendeu && (
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={handleSave}
          disabled={saving}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {saving ? "Salvando..." : "Salvar contato"}
        </Button>
      )}
    </div>
  );
}
