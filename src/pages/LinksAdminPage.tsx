import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveStoragePublicUrl } from "@/lib/storage-url";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Trash2, ExternalLink } from "lucide-react";
import CompanyLinksManager from "@/components/settings/CompanyLinksManager";

const DEFAULT_BG_COLOR = "#000000";
const DEFAULT_CARD_COLOR = "#9c1c1c";

async function loadLinksSettings() {
  const { data } = await supabase
    .from("system_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["links_logo_url", "links_bg_color", "links_card_color", "links_meta_pixel_id", "links_whatsapp_channel_url"]);
  const map = new Map((data || []).map((r: any) => [r.setting_key, r.setting_value || ""]));
  return {
    linksLogoUrl: map.get("links_logo_url") || "",
    bgColor: map.get("links_bg_color") || DEFAULT_BG_COLOR,
    cardColor: map.get("links_card_color") || DEFAULT_CARD_COLOR,
    metaPixelId: map.get("links_meta_pixel_id") || "",
    whatsappChannelUrl: map.get("links_whatsapp_channel_url") || "",
  };
}

async function saveColorSetting(key: string, value: string) {
  await supabase.from("system_settings").upsert(
    { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
    { onConflict: "setting_key" },
  );
}

export default function LinksAdminPage() {
  const { isAdmin } = useAuth();
  const [linksLogoUrl, setLinksLogoUrl] = useState("");
  const [linksLogoUploading, setLinksLogoUploading] = useState(false);
  const [bgColor, setBgColor] = useState(DEFAULT_BG_COLOR);
  const [cardColor, setCardColor] = useState(DEFAULT_CARD_COLOR);
  const [metaPixelId, setMetaPixelId] = useState("");
  const [whatsappChannelUrl, setWhatsappChannelUrl] = useState("");

  useEffect(() => {
    loadLinksSettings().then(({ linksLogoUrl: logo, bgColor: bg, cardColor: card, metaPixelId: pixel, whatsappChannelUrl: wppUrl }) => {
      setLinksLogoUrl(logo);
      setBgColor(bg);
      setCardColor(card);
      setMetaPixelId(pixel);
      setWhatsappChannelUrl(wppUrl);
    });
  }, []);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
      reader.readAsDataURL(file);
    });

  const handleLinksLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 5 MB)");
      e.target.value = "";
      return;
    }
    setLinksLogoUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fileName = `links_logo_${Date.now()}.${ext}`;
      const data = await fileToBase64(file);
      const contentType = file.type || "image/png";
      const { data: result, error } = await supabase.functions.invoke("upload-system-logo", {
        body: { fileName, contentType, data, settingKey: "links_logo_url" },
      });
      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);
      const publicUrl = resolveStoragePublicUrl(result.publicUrl as string);
      setLinksLogoUrl(publicUrl);
      toast.success("Logo da página /links atualizada!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar logo");
    } finally {
      setLinksLogoUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveLinksLogo = async () => {
    setLinksLogoUrl("");
    await supabase
      .from("system_settings")
      .update({ setting_value: "", updated_at: new Date().toISOString() })
      .eq("setting_key", "links_logo_url");
    toast.success("Logo removida");
  };

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="text-center py-12 text-muted-foreground">
          Acesso restrito a administradores.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold">Links Públicos</h1>
          <a href="/links" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            <ExternalLink className="h-3.5 w-3.5" /> Ver página /links
          </a>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Gerencie os links, banners, títulos e parágrafos exibidos em <a href="/links" target="_blank" rel="noopener noreferrer" className="text-primary underline">/links</a>.
          Arraste para reordenar.
        </p>
      </div>

      <div className="max-w-lg space-y-6 mb-8">
        {/* Cores */}
        <div className="space-y-4 border rounded-lg p-4">
          <p className="font-semibold text-sm">Cores da página</p>

          <div className="space-y-2">
            <Label>Cor do fundo</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                className="h-9 w-14 cursor-pointer rounded border p-1"
                onChange={(e) => setBgColor(e.target.value)}
                onBlur={async () => {
                  await saveColorSetting("links_bg_color", bgColor);
                  toast.success("Cor do fundo salva");
                }}
              />
              <Input
                value={bgColor}
                className="h-9 w-32 font-mono text-sm"
                onChange={(e) => setBgColor(e.target.value)}
                onBlur={async () => {
                  await saveColorSetting("links_bg_color", bgColor);
                  toast.success("Cor do fundo salva");
                }}
              />
              <div className="h-9 w-9 rounded border shrink-0" style={{ backgroundColor: bgColor }} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cor do cartão (área central)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cardColor}
                className="h-9 w-14 cursor-pointer rounded border p-1"
                onChange={(e) => setCardColor(e.target.value)}
                onBlur={async () => {
                  await saveColorSetting("links_card_color", cardColor);
                  toast.success("Cor do cartão salva");
                }}
              />
              <Input
                value={cardColor}
                className="h-9 w-32 font-mono text-sm"
                onChange={(e) => setCardColor(e.target.value)}
                onBlur={async () => {
                  await saveColorSetting("links_card_color", cardColor);
                  toast.success("Cor do cartão salva");
                }}
              />
              <div className="h-9 w-9 rounded border shrink-0" style={{ backgroundColor: cardColor }} />
            </div>
          </div>
        </div>

        {/* Meta Pixel */}
        <div className="space-y-2 border rounded-lg p-4">
          <p className="font-semibold text-sm">Meta Pixel (Facebook)</p>
          <p className="text-[11px] text-muted-foreground">
            O ID numérico do seu Pixel da Meta (ex.: <span className="font-mono">123456789012345</span>).
            Quando preenchido, o código de rastreamento é injetado automaticamente na página /links.
          </p>
          <div className="space-y-1">
            <Label>ID do Pixel</Label>
            <Input
              value={metaPixelId}
              placeholder="Ex.: 123456789012345"
              className="h-9 font-mono"
              onChange={(e) => setMetaPixelId(e.target.value.replace(/\D/g, ""))}
              onBlur={async () => {
                await saveColorSetting("links_meta_pixel_id", metaPixelId);
                toast.success(metaPixelId ? "Pixel ID salvo" : "Pixel ID removido");
              }}
            />
          </div>
        </div>

        {/* Canal Oficial WhatsApp */}
        <div className="space-y-2 border rounded-lg p-4">
          <p className="font-semibold text-sm">Botão Canal Oficial no WhatsApp</p>
          <p className="text-[11px] text-muted-foreground">
            Quando preenchido, exibe um botão verde fixo no final da página /links com o texto
            "ACESSAR CANAL OFICIAL NO WHATSAPP", apontando para o link informado.
          </p>
          <div className="space-y-1">
            <Label>Link do canal/grupo do WhatsApp</Label>
            <Input
              value={whatsappChannelUrl}
              placeholder="Ex.: https://whatsapp.com/channel/..."
              className="h-9"
              onChange={(e) => setWhatsappChannelUrl(e.target.value)}
              onBlur={async () => {
                await saveColorSetting("links_whatsapp_channel_url", whatsappChannelUrl);
                toast.success(whatsappChannelUrl ? "Link do canal salvo" : "Link do canal removido");
              }}
            />
          </div>
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo da página /links</Label>
          <p className="text-[11px] text-muted-foreground">
            Exibida no topo de <a href="/links" target="_blank" rel="noopener noreferrer" className="text-primary underline">/links</a>.
            Se não enviar uma, usa a Logo do Sistema das Configurações. Prefira imagem quadrada/redonda.
          </p>
          <div className="flex items-center gap-4">
            {linksLogoUrl ? (
              <div className="relative">
                <img
                  src={resolveStoragePublicUrl(linksLogoUrl)}
                  alt="Logo da página /links"
                  className="h-16 w-16 rounded-full object-contain border bg-card"
                />
                <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6" onClick={handleRemoveLinksLogo}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="h-16 w-16 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                <Upload className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )}
            <div>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild disabled={linksLogoUploading}>
                  <span>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {linksLogoUploading ? "Enviando..." : "Enviar Logo"}
                  </span>
                </Button>
                <input type="file" accept="image/*" className="hidden" onChange={handleLinksLogoUpload} />
              </label>
              <p className="text-[11px] text-muted-foreground mt-1">PNG, JPG ou SVG</p>
            </div>
          </div>
        </div>
      </div>

      <CompanyLinksManager />
    </AppLayout>
  );
}
