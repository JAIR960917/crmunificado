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
  onSaved?: () => void;
};

export default function CobrancaContactAttemptForm({
  cobrancaId, userId, userName, cobrancaData, onSaved,
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

      // 2) Se atendeu, atualiza o flag de renegociação no JSON `data` da cobrança
      if (atendeu === "sim" && renegociou) {
        const newData = {
          ...cobrancaData,
          renegociou,
          renegociou_at: new Date().toISOString(),
          renegociou_by: userId,
          renegociou_by_name: userName || null,
          renegociou_observacao: observacao.trim(),
        };
        const { error: updErr } = await supabase
          .from("crm_cobrancas")
          .update({ data: newData })
          .eq("id", cobrancaId);
        if (updErr) throw updErr;
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
