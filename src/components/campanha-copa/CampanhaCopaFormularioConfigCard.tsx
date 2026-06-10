import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ImageUploadField from "@/components/whatsapp/ImageUploadField";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CAMPANHA_COPA_BANNER_URL_KEY } from "@/lib/campanha-copa-jogo";
import {
  CAMPANHA_COPA_PERIODO_FIM_KEY,
  CAMPANHA_COPA_PERIODO_INICIO_KEY,
  datetimeLocalToIso,
  formatPeriodLabel,
  isoToDatetimeLocal,
} from "@/lib/campanha-copa-periodo";

type Props = {
  initialPeriodoInicio: string;
  initialPeriodoFim: string;
  initialBannerUrl: string;
  onSaved?: () => void;
};

export default function CampanhaCopaFormularioConfigCard({
  initialPeriodoInicio,
  initialPeriodoFim,
  initialBannerUrl,
  onSaved,
}: Props) {
  const [periodoInicio, setPeriodoInicio] = useState(() => isoToDatetimeLocal(initialPeriodoInicio));
  const [periodoFim, setPeriodoFim] = useState(() => isoToDatetimeLocal(initialPeriodoFim));
  const [bannerUrl, setBannerUrl] = useState(initialBannerUrl);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPeriodoInicio(isoToDatetimeLocal(initialPeriodoInicio));
    setPeriodoFim(isoToDatetimeLocal(initialPeriodoFim));
    setBannerUrl(initialBannerUrl);
  }, [initialPeriodoInicio, initialPeriodoFim, initialBannerUrl]);

  const periodoResumo = useMemo(() => {
    const ini = datetimeLocalToIso(periodoInicio);
    const fim = datetimeLocalToIso(periodoFim);
    if (!ini && !fim) return "Sem restrição — palpites aceitos a qualquer momento.";
    return `De ${formatPeriodLabel(ini)} até ${formatPeriodLabel(fim)}.`;
  }, [periodoInicio, periodoFim]);

  const save = async () => {
    const inicioIso = datetimeLocalToIso(periodoInicio);
    const fimIso = datetimeLocalToIso(periodoFim);

    if (inicioIso && fimIso && new Date(inicioIso) >= new Date(fimIso)) {
      toast.error("O início do período deve ser anterior ao fim.");
      return;
    }

    setSaving(true);
    try {
      const rows = [
        { setting_key: CAMPANHA_COPA_PERIODO_INICIO_KEY, setting_value: inicioIso },
        { setting_key: CAMPANHA_COPA_PERIODO_FIM_KEY, setting_value: fimIso },
        { setting_key: CAMPANHA_COPA_BANNER_URL_KEY, setting_value: (bannerUrl || "").trim() },
      ].map((row) => ({ ...row, updated_at: new Date().toISOString() }));

      const { error } = await supabase.from("system_settings").upsert(rows, {
        onConflict: "setting_key",
      });
      if (error) throw error;

      toast.success("Configurações do formulário salvas.");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          Formulário público — período e banner
        </CardTitle>
        <CardDescription className="space-y-2">
          <p>
            Defina quando os palpites podem ser enviados e o banner exibido no topo de{" "}
            <code className="text-xs">/campanha-copa</code>. Deixe as datas em branco para aceitar
            palpites a qualquer momento.
          </p>
          <p className="text-sm">{periodoResumo}</p>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="periodo-inicio">Início do período</Label>
            <Input
              id="periodo-inicio"
              type="datetime-local"
              value={periodoInicio}
              onChange={(e) => setPeriodoInicio(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="periodo-fim">Fim do período</Label>
            <Input
              id="periodo-fim"
              type="datetime-local"
              value={periodoFim}
              onChange={(e) => setPeriodoFim(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Banner do topo
          </Label>
          <p className="text-xs text-muted-foreground">
            Imagem larga exibida acima do título no formulário público. Recomendado: proporção
            horizontal (ex.: 1200×400 px).
          </p>
          <ImageUploadField
            value={bannerUrl || null}
            onChange={(url) => setBannerUrl(url || "")}
            label="Banner da campanha"
          />
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando..." : "Salvar período e banner"}
        </Button>
      </CardContent>
    </Card>
  );
}
