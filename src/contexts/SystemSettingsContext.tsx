/**
 * ============================================================================
 * SystemSettingsContext.tsx — Configurações visuais e de marca do sistema
 * ============================================================================
 * O QUE FAZ:
 *   - Lê chave/valor da tabela `system_settings` no banco
 *   - Aplica as cores escolhidas como variáveis CSS no <html>
 *   - Atualiza o título da aba e o favicon dinamicamente
 *   - Se o admin trocar a logo/cor em /configuracoes, todo o app reflete
 *
 * COMO USAR:
 *   const { settings, refresh } = useSystemSettings();
 *   <img src={settings.logo_url} />  // logo do sistema
 *   <h1>{settings.system_name}</h1>  // nome do CRM
 *
 * IMPORTANTE:
 *   Cores são strings HSL (ex.: "220 72% 50%") — não hex. Isso é exigido
 *   pelo design system do projeto (ver index.css e tailwind.config.ts).
 * ============================================================================
 */
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const BRANDING_SETTING_KEYS = [
  "system_name",
  "primary_color",
  "background_color",
  "text_color",
  "button_color",
  "logo_url",
] as const;

/** Forma das configurações persistidas. */
type Settings = {
  system_name: string;
  primary_color: string;     // HSL
  background_color: string;  // HSL
  text_color: string;        // HSL
  button_color: string;      // HSL
  logo_url: string;
};

/** Defaults usados antes de buscar do banco e em caso de erro. */
const defaults: Settings = {
  system_name: "CRM Óticas Joonker",
  primary_color: "220 72% 50%",
  background_color: "222 47% 6%",
  text_color: "210 20% 92%",
  button_color: "220 72% 55%",
  logo_url: "",
};

type Ctx = {
  settings: Settings;
  loading: boolean;
  /** Recarrega as configurações (chame após salvar mudanças). */
  refresh: () => Promise<void>;
};

const SystemSettingsContext = createContext<Ctx>({
  settings: defaults,
  loading: true,
  refresh: async () => {},
});

/** Hook público para consumir as configurações. */
export function useSystemSettings() {
  return useContext(SystemSettingsContext);
}

/**
 * Aplica as configurações como CSS no <html>:
 *   - Variáveis HSL (--primary, --background, etc.)
 *   - Favicon dinâmico
 *   - Título da aba
 */
function applyCSS(s: Settings) {
  const root = document.documentElement;

  // Cores de marca (sempre aplicadas)
  root.style.setProperty("--primary", s.button_color || s.primary_color);
  root.style.setProperty("--ring", s.primary_color);
  root.style.setProperty("--sidebar-primary", s.primary_color);
  root.style.setProperty("--sidebar-ring", s.primary_color);
  root.style.setProperty("--sidebar-accent", s.primary_color);

  // No modo escuro, sobrescrevemos fundo/texto.
  // No claro, removemos para que index.css volte a mandar.
  if (root.classList.contains("dark")) {
    root.style.setProperty("--background", s.background_color);
    root.style.setProperty("--foreground", s.text_color);
    root.style.setProperty("--card-foreground", s.text_color);
    root.style.setProperty("--popover-foreground", s.text_color);
  } else {
    root.style.removeProperty("--background");
    root.style.removeProperty("--foreground");
    root.style.removeProperty("--card-foreground");
    root.style.removeProperty("--popover-foreground");
  }

  // Favicon dinâmico (logo do sistema vira o ícone da aba).
  if (s.logo_url) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = s.logo_url;

    const appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (appleLink) appleLink.href = s.logo_url;
  }

  // Título da aba do navegador.
  if (s.system_name) document.title = s.system_name;
}

/** Provider — envolva o app dentro de <AuthProvider> e antes das rotas. */
export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading, session } = useAuth();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(true);

  /** Lê todas as linhas de system_settings e mescla com defaults. */
  const fetchSettings = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("system_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [...BRANDING_SETTING_KEYS]);

    if (error || !data) {
      setSettings(defaults);
      setLoading(false);
      return;
    }

    // Mescla apenas chaves conhecidas (defaults é a fonte da verdade da forma).
    const merged = { ...defaults };
    data.forEach((row: any) => {
      if (row.setting_key in merged) {
        (merged as any)[row.setting_key] = row.setting_value;
      }
    });

    setSettings(merged);
    setLoading(false);
  }, []);

  // Aplica CSS sempre que settings muda.
  useEffect(() => {
    applyCSS(settings);
  }, [settings]);

  // Busca settings quando a sessão fica disponível.
  useEffect(() => {
    if (authLoading) return;
    fetchSettings();
  }, [authLoading, session?.user?.id, fetchSettings]);

  // Reaplica CSS quando o tema muda (toggle dark/light no AppSidebar).
  useEffect(() => {
    const observer = new MutationObserver(() => applyCSS(settings));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [settings]);

  return (
    <SystemSettingsContext.Provider value={{ settings, loading, refresh: fetchSettings }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
