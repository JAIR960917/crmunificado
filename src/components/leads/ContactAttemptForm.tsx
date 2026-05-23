import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, PhoneOff, CalendarCheck, CalendarX, CalendarIcon, Clock, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CANAIS_AGENDAMENTO = [
  "Ligação Leads",
  "Ligação Renovação",
  "Loja",
  "Rede Social",
  "Ação Adam",
  "Convênios",
  "PAP",
  "Reavaliação",
  "Recomendação",
  "Teste de Visão Online",
  "Tráfego Pago",
  "Cortesia",
];

const FORMAS_PAGAMENTO = [
  "Dinheiro",
  "Cartão de Crédito",
  "Cartão de Débito",
  "PIX",
  "Convênio",
  "Boleto",
  "Cortesia",
];

type Props = {
  leadId: string;
  userId: string;
  leadStatus: string;
  leadSnapshot: { nome: string; telefone: string; idade: string };
  onSaved?: () => void;
};

type Atendeu = "sim" | "nao" | null;
type Marcou = "sim" | "nao" | null;

export default function ContactAttemptForm({ leadId, userId, leadStatus, leadSnapshot, onSaved }: Props) {
  const [atendeu, setAtendeu] = useState<Atendeu>(null);
  const [tratativa, setTratativa] = useState("");
  const [tentativasObs, setTentativasObs] = useState("");
  const [marcou, setMarcou] = useState<Marcou>(null);
  const [dateStr, setDateStr] = useState("");
  const [time, setTime] = useState("09:00");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [canal, setCanal] = useState("Ligação Leads");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setAtendeu(null);
    setTratativa("");
    setTentativasObs("");
    setMarcou(null);
    setDateStr("");
    setTime("09:00");
    setFormaPagamento("");
    setCanal("Ligação Leads");
  };

  const buildNoteContent = () => {
    const lines: string[] = [];
    lines.push(`📞 Tentativa de contato — Cliente ${atendeu === "sim" ? "ATENDEU" : "NÃO ATENDEU"}`);
    if (atendeu === "sim") {
      if (tratativa.trim()) lines.push(`Tratativa: ${tratativa.trim()}`);
      if (marcou === "sim") {
        const dt = dateStr && time ? `${dateStr.split("-").reverse().join("/")} às ${time}` : "";
        lines.push(`✅ Consulta marcada${dt ? ` para ${dt}` : ""}`);
      } else if (marcou === "nao") {
        lines.push("❌ Consulta NÃO marcada");
      }
    } else if (atendeu === "nao") {
      if (tentativasObs.trim()) lines.push(`Tentativas de contato: ${tentativasObs.trim()}`);
    }
    return lines.join("\n");
  };


  const handleSave = async () => {
    if (!atendeu) {
      toast.error("Selecione se o cliente atendeu");
      return;
    }
    if (atendeu === "sim" && !tratativa.trim()) {
      toast.error("Descreva a tratativa do contato");
      return;
    }
    if (atendeu === "nao" && !tentativasObs.trim()) {
      toast.error("Descreva como tentou contato com o cliente");
      return;
    }

    if (atendeu === "sim" && marcou === "sim") {
      if (!dateStr || !time || !formaPagamento || !canal) {
        toast.error("Preencha todos os campos do agendamento");
        return;
      }
    }

    setSaving(true);
    try {
      // 1) Save note registering the contact attempt
      const noteContent = buildNoteContent();
      const { error: noteErr } = await supabase.from("crm_lead_notes").insert({
        lead_id: leadId,
        user_id: userId,
        content: noteContent,
      });
      if (noteErr) throw noteErr;

      // 1.1) Marca a tratativa no card (para colorir verde/vermelho e mandar para o final)
      {
        const { data: cur } = await supabase
          .from("crm_leads")
          .select("data")
          .eq("id", leadId)
          .maybeSingle();
        const curData = ((cur?.data as Record<string, any>) || {});
        const newData = {
          ...curData,
          tratativa_em: new Date().toISOString(),
          tratativa_atendeu: atendeu,
          tratativa_by: userId,
        };
        await supabase.from("crm_leads").update({ data: newData }).eq("id", leadId);
      }


      // 2) If consultation was scheduled, create the appointment
      if (atendeu === "sim" && marcou === "sim") {
        const [y, mo, d] = dateStr.split("-").map(Number);
        const [h, m] = time.split(":").map(Number);
        const dt = new Date(y, mo - 1, d, h, m, 0, 0);

        const { error: apptErr } = await supabase.from("crm_appointments").insert({
          lead_id: leadId,
          scheduled_by: userId,
          scheduled_datetime: dt.toISOString(),
          valor: 0,
          forma_pagamento: formaPagamento,
          canal_agendamento: canal,
          previous_status: leadStatus,
          nome: leadSnapshot.nome,
          telefone: leadSnapshot.telefone,
          idade: leadSnapshot.idade,
        } as any);
        if (apptErr) throw apptErr;

        toast.success("Contato registrado e consulta agendada!");
      } else {
        toast.success("Contato registrado!");
      }

      reset();
      onSaved?.();
    } catch (err: any) {
      console.error("ContactAttemptForm save error:", err);
      toast.error("Erro ao registrar contato: " + (err?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Tentativa de contato</span>
      </div>

      {/* Step 1: Did the client answer? */}
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
            onClick={() => { setAtendeu("nao"); setMarcou(null); }}
          >
            <PhoneOff className="h-3.5 w-3.5 mr-1" /> Não atendeu
          </Button>
        </div>
      </div>

      {/* Step 2a: If "não atendeu", ask for description of attempts */}
      {atendeu === "nao" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Como tentou contato? <span className="text-destructive">*</span></Label>
          <Textarea
            value={tentativasObs}
            onChange={(e) => setTentativasObs(e.target.value)}
            rows={3}
            placeholder="Descreva as formas que tentou contato (ligação, WhatsApp, etc)..."
            className="text-sm min-h-[80px]"
            maxLength={1000}
          />
        </div>
      )}

      {/* Step 2: If answered, ask for tratativa + marcou */}

      {atendeu === "sim" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tratativa do contato <span className="text-destructive">*</span></Label>
            <Textarea
              value={tratativa}
              onChange={(e) => setTratativa(e.target.value)}
              rows={3}
              placeholder="Descreva o que foi conversado com o cliente..."
              className="text-sm min-h-[80px]"
              maxLength={1000}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">O cliente marcou a consulta?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={marcou === "sim" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setMarcou("sim")}
              >
                <CalendarCheck className="h-3.5 w-3.5 mr-1" /> Sim, marcou
              </Button>
              <Button
                type="button"
                size="sm"
                variant={marcou === "nao" ? "destructive" : "outline"}
                className="flex-1"
                onClick={() => setMarcou("nao")}
              >
                <CalendarX className="h-3.5 w-3.5 mr-1" /> Não marcou
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Step 3: If marked appointment, show scheduling fields */}
      {atendeu === "sim" && marcou === "sim" && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
          <p className="text-xs font-medium text-primary flex items-center gap-1">
            <CalendarCheck className="h-3.5 w-3.5" /> Dados do agendamento
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Data <span className="text-destructive">*</span></Label>
              <div className="relative">
                <CalendarIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-destructive pointer-events-none" />
                <Input
                  type="date"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  onClick={(e) => (e.currentTarget as any).showPicker?.()}
                  className="pl-7 h-9 text-sm cursor-pointer"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Horário <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-destructive pointer-events-none" />
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="pl-7 h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Forma de Pagamento <span className="text-destructive">*</span></Label>
            <Select value={formaPagamento} onValueChange={setFormaPagamento}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {FORMAS_PAGAMENTO.map((fp) => (
                  <SelectItem key={fp} value={fp}>{fp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Canal de Agendamento <span className="text-destructive">*</span></Label>
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {CANAIS_AGENDAMENTO.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
          {saving ? "Salvando..." : atendeu === "sim" && marcou === "sim" ? "Salvar e Agendar" : "Salvar contato"}
        </Button>
      )}
    </div>
  );
}
