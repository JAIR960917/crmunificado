import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Save, Upload, Trash2, Clock, Wrench } from "lucide-react";
import RolePermissionsManager from "@/components/settings/RolePermissionsManager";

type SettingField = {
  key: string;
  label: string;
  type: "text" | "color-hsl";
  placeholder?: string;
};

const FIELDS: SettingField[] = [
  { key: "system_name", label: "Nome do Sistema", type: "text", placeholder: "Ex: Meu CRM" },
  { key: "twilio_whatsapp_number", label: "Número WhatsApp (Twilio)", type: "text", placeholder: "+5511999999999" },
  { key: "primary_color", label: "Cor Primária (HSL)", type: "color-hsl", placeholder: "220 72% 50%" },
  { key: "background_color", label: "Cor de Fundo (HSL)", type: "color-hsl", placeholder: "222 47% 6%" },
  { key: "text_color", label: "Cor dos Textos (HSL)", type: "color-hsl", placeholder: "210 20% 92%" },
  { key: "button_color", label: "Cor dos Botões (HSL)", type: "color-hsl", placeholder: "220 72% 55%" },
];

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const { settings, refresh } = useSystemSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<Array<{ user_id: string; full_name: string }>>([]);

  useEffect(() => {
    const loadExtraSettings = async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("setting_key, setting_value")
        .in("setting_key", [
          "twilio_whatsapp_number",
          "whatsapp_cron_interval",
          "maintenance_mode",
          "maintenance_admin_1",
          "maintenance_admin_2",
        ]);
      const extra: Record<string, string> = {};
      (data || []).forEach((r: any) => { extra[r.setting_key] = r.setting_value; });
      setValues({
        system_name: settings.system_name,
        primary_color: settings.primary_color,
        background_color: settings.background_color,
        text_color: settings.text_color,
        button_color: settings.button_color,
        logo_url: settings.logo_url,
        twilio_whatsapp_number: extra.twilio_whatsapp_number || "",
        whatsapp_cron_interval: extra.whatsapp_cron_interval || "5",
        maintenance_mode: extra.maintenance_mode || "false",
        maintenance_admin_1: extra.maintenance_admin_1 || "",
        maintenance_admin_2: extra.maintenance_admin_2 || "",
      });
    };
    loadExtraSettings();
  }, [settings]);

  useEffect(() => {
    const loadAdmins = async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const ids = Array.from(new Set((roles || []).map((r: any) => r.user_id)));
      if (ids.length === 0) { setAdminUsers([]); return; }
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      setAdminUsers(((profs || []) as any[]).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    };
    loadAdmins();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(values)) {
        await supabase
          .from("system_settings")
          .upsert(
            { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
            { onConflict: "setting_key" }
          );
      }
      await refresh();
      toast.success("Configurações salvas!");
    } catch {
      toast.error("Erro ao salvar");
    }
    setSaving(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const ext = file.name.split(".").pop();
    const fileName = `logo_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      toast.error("Erro ao enviar logo");
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("logos").getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    setValues((prev) => ({ ...prev, logo_url: publicUrl }));

    // Save immediately
    await supabase
      .from("system_settings")
      .update({ setting_value: publicUrl, updated_at: new Date().toISOString() })
      .eq("setting_key", "logo_url");

    await refresh();
    toast.success("Logo atualizada!");
    setUploading(false);
  };

  const handleRemoveLogo = async () => {
    setValues((prev) => ({ ...prev, logo_url: "" }));
    await supabase
      .from("system_settings")
      .update({ setting_value: "", updated_at: new Date().toISOString() })
      .eq("setting_key", "logo_url");
    await refresh();
    toast.success("Logo removida");
  };

  // Convert HSL string "H S% L%" to hex for native color input
  const hslToHex = (hsl: string): string => {
    try {
      const parts = hsl.trim().split(/\s+/);
      const h = parseFloat(parts[0]) || 0;
      const s = (parseFloat(parts[1]) || 0) / 100;
      const l = (parseFloat(parts[2]) || 0) / 100;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, "0");
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    } catch {
      return "#888888";
    }
  };

  // Convert hex to HSL string "H S% L%"
  const hexToHsl = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        case b: h = ((r - g) / d + 4) * 60; break;
      }
    }
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  // Helper to convert HSL string to CSS color for preview
  const hslPreview = (hsl: string) => {
    try {
      return `hsl(${hsl})`;
    } catch {
      return "#888";
    }
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
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold">Configurações do Sistema</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Personalize a aparência do sistema
        </p>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo do Sistema</Label>
          <div className="flex items-center gap-4">
            {values.logo_url ? (
              <div className="relative">
                <img
                  src={values.logo_url}
                  alt="Logo"
                  className="h-16 w-16 rounded-lg object-contain border bg-card"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-6 w-6"
                  onClick={handleRemoveLogo}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="h-16 w-16 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                <Upload className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )}
            <div>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <span>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {uploading ? "Enviando..." : "Enviar Logo"}
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </label>
              <p className="text-[11px] text-muted-foreground mt-1">PNG, JPG ou SVG</p>
            </div>
          </div>
        </div>

        {/* Fields */}
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label>{field.label}</Label>
            <div className="flex gap-2 items-center">
              <Input
                value={values[field.key] || ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="flex-1"
              />
              {field.type === "color-hsl" && (
                <div className="relative">
                  <div
                    className="h-9 w-9 rounded-md border shrink-0 cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    style={{ backgroundColor: hslPreview(values[field.key] || "") }}
                    onClick={() => {
                      const input = document.getElementById(`color-picker-${field.key}`) as HTMLInputElement;
                      input?.click();
                    }}
                    title="Clique para escolher a cor"
                  />
                  <input
                    id={`color-picker-${field.key}`}
                    type="color"
                    className="absolute inset-0 opacity-0 w-0 h-0"
                    value={hslToHex(values[field.key] || "0 0% 50%")}
                    onChange={(e) => {
                      const hsl = hexToHsl(e.target.value);
                      setValues((prev) => ({ ...prev, [field.key]: hsl }));
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* WhatsApp Cron Interval */}
        <div className="space-y-2 border-t pt-4">
          <Label className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Intervalo de Envio Automático (WhatsApp)
          </Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min={1}
              max={1440}
              value={values.whatsapp_cron_interval || "5"}
              onChange={(e) => setValues((prev) => ({ ...prev, whatsapp_cron_interval: e.target.value }))}
              placeholder="5"
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">minutos</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Define a cada quantos minutos o sistema envia mensagens das campanhas ativas automaticamente.
          </p>
        </div>

        {/* Modo Manutenção */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Modo Manutenção
            </Label>
            <Switch
              checked={values.maintenance_mode === "true"}
              onCheckedChange={(checked) =>
                setValues((prev) => ({ ...prev, maintenance_mode: checked ? "true" : "false" }))
              }
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Quando ativado, todos os usuários verão a tela de manutenção. Apenas os 2 administradores abaixo continuarão acessando normalmente.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[1, 2].map((n) => {
              const key = `maintenance_admin_${n}`;
              return (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">Admin {n} liberado</Label>
                  <Select
                    value={values[key] || "__none__"}
                    onValueChange={(v) =>
                      setValues((prev) => ({ ...prev, [key]: v === "__none__" ? "" : v }))
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione um admin" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Nenhum —</SelectItem>
                      {adminUsers.map((u) => (
                        <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>


        <Button onClick={handleSave} disabled={saving} className="w-full">
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>
      </div>

      <div className="mt-10 border-t pt-8">
        <RolePermissionsManager />
      </div>
    </AppLayout>
  );
}
