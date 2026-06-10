import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CAMPANHA_COPA_PIXEL_FORM_KEY,
  CAMPANHA_COPA_PIXEL_SUCCESS_KEY,
} from "@/lib/campanha-copa-jogo";

type Props = {
  initialFormPixel: string;
  initialSuccessPixel: string;
  onSaved?: () => void;
};

export default function CampanhaCopaPixelConfigCard({
  initialFormPixel,
  initialSuccessPixel,
  onSaved,
}: Props) {
  const [pixelForm, setPixelForm] = useState(initialFormPixel);
  const [pixelSuccess, setPixelSuccess] = useState(initialSuccessPixel);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPixelForm(initialFormPixel);
    setPixelSuccess(initialSuccessPixel);
  }, [initialFormPixel, initialSuccessPixel]);

  const save = async () => {
    setSaving(true);
    try {
      const rows = [
        { setting_key: CAMPANHA_COPA_PIXEL_FORM_KEY, setting_value: pixelForm.trim() },
        { setting_key: CAMPANHA_COPA_PIXEL_SUCCESS_KEY, setting_value: pixelSuccess.trim() },
      ].map((row) => ({ ...row, updated_at: new Date().toISOString() }));

      const { error } = await supabase.from("system_settings").upsert(rows, {
        onConflict: "setting_key",
      });
      if (error) throw error;

      toast.success("Pixels atualizados. O formulário público carregará na próxima visita.");
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar pixels");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Code2 className="h-4 w-4" />
          Pixels de rastreamento (Meta, Google etc.)
        </CardTitle>
        <CardDescription>
          Cole o código do pixel fornecido pela plataforma de anúncios. O script da{" "}
          <strong>tela do formulário</strong> roda ao abrir a página; o da{" "}
          <strong>tela pós-envio</strong> roda somente após o participante concluir o cadastro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pixel-form">Pixel — tela do formulário</Label>
          <Textarea
            id="pixel-form"
            value={pixelForm}
            onChange={(e) => setPixelForm(e.target.value)}
            placeholder={'<!-- Ex.: Meta Pixel + fbq("track", "PageView") -->'}
            rows={6}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pixel-success">Pixel — tela pós-preenchimento (sucesso)</Label>
          <Textarea
            id="pixel-success"
            value={pixelSuccess}
            onChange={(e) => setPixelSuccess(e.target.value)}
            placeholder={'<!-- Ex.: fbq("track", "Lead") ou CompleteRegistration -->'}
            rows={6}
            className="font-mono text-xs"
          />
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando..." : "Salvar pixels"}
        </Button>
      </CardContent>
    </Card>
  );
}
