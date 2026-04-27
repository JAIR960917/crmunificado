import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Settings = {
  system_name: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  button_color: string;
  logo_url: string;
};

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
  refresh: () => Promise<void>;
};

const SystemSettingsContext = createContext<Ctx>({
  settings: defaults,
  loading: true,
  refresh: async () => {},
});

export function useSystemSettings() {
  return useContext(SystemSettingsContext);
}

function applyCSS(s: Settings) {
  const root = document.documentElement;
  root.style.setProperty("--primary", s.button_color || s.primary_color);
  root.style.setProperty("--ring", s.primary_color);
  root.style.setProperty("--sidebar-primary", s.primary_color);
  root.style.setProperty("--sidebar-ring", s.primary_color);
  root.style.setProperty("--sidebar-accent", s.primary_color);

  if (root.classList.contains("dark")) {
    // Apply dark overrides
    root.style.setProperty("--background", s.background_color);
    root.style.setProperty("--foreground", s.text_color);
    root.style.setProperty("--card-foreground", s.text_color);
    root.style.setProperty("--popover-foreground", s.text_color);
  } else {
    // Remove inline overrides so light-mode CSS variables from index.css take effect
    root.style.removeProperty("--background");
    root.style.removeProperty("--foreground");
    root.style.removeProperty("--card-foreground");
    root.style.removeProperty("--popover-foreground");
  }

  // Update favicon dynamically
  if (s.logo_url) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = s.logo_url;

    let appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (appleLink) {
      appleLink.href = s.logo_url;
    }
  }

  // Update page title
  if (s.system_name) {
    document.title = s.system_name;
  }
}

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { loading: authLoading, session } = useAuth();
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("system_settings")
      .select("setting_key, setting_value");

    if (error || !data) {
      setSettings(defaults);
      setLoading(false);
      return;
    }

    const merged = { ...defaults };
    data.forEach((row: any) => {
      if (row.setting_key in merged) {
        (merged as any)[row.setting_key] = row.setting_value;
      }
    });

    setSettings(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    applyCSS(settings);
  }, [settings]);

  useEffect(() => {
    if (authLoading) return;
    fetchSettings();
  }, [authLoading, session?.user?.id, fetchSettings]);

  // Re-apply CSS when theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      applyCSS(settings);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [settings]);

  return (
    <SystemSettingsContext.Provider value={{ settings, loading, refresh: fetchSettings }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
