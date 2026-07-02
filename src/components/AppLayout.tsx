/**
 * ============================================================================
 * AppLayout.tsx — Layout principal autenticado (sidebar + conteúdo)
 * ============================================================================
 * Estrutura visual de TODAS as páginas internas do CRM:
 *
 *   ┌────────────┬───────────────────────────────────┐
 *   │            │ [header com sino de notificações] │
 *   │  Sidebar   ├───────────────────────────────────┤
 *   │  (lateral) │                                   │
 *   │            │       {children}  ← página        │
 *   └────────────┴───────────────────────────────────┘
 *
 * Responsivo:
 *   - Desktop (lg+): sidebar fixa à esquerda
 *   - Mobile: sidebar vira drawer aberto pelo botão "Menu"
 * ============================================================================
 */
import { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import PwaInstallBanner from "./PwaInstallBanner";
import NotificationBell from "./NotificationBell";
import DailyGoalsPopup from "./DailyGoalsPopup";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { useCrediarioTheme } from "@/contexts/CrediarioThemeContext";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * @param children Conteúdo da página renderizado à direita da sidebar.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  // Controla a abertura do drawer no mobile.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings } = useSystemSettings();
  const { theme: crediarioTheme, hasCustomTheme } = useCrediarioTheme();
  const location = useLocation();

  // Cores do Crediário (Configurações → Crediário → Cores) valem só dentro de
  // /crediario/* e só na área de conteúdo — a sidebar segue o tema geral do CRM.
  const isCrediarioRoute = location.pathname.startsWith("/crediario");
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  // O app original do Crediário usa vermelho até para os estados de "sucesso"
  // (Assinado, Baixar contrato assinado) — --success era 0 84% 45/50%, não o
  // verde convencional do CRM. Aplica esse padrão sempre, mesmo sem cores
  // customizadas em Configurações.
  const contentStyle: React.CSSProperties | undefined = isCrediarioRoute
    ? {
        "--success": isDark ? "0 84% 50%" : "0 84% 45%",
        "--success-foreground": "0 0% 100%",
        ...(hasCustomTheme
          ? {
              ...(crediarioTheme.primary_color || crediarioTheme.button_color
                ? {
                    "--primary": crediarioTheme.button_color || crediarioTheme.primary_color,
                    "--ring": crediarioTheme.primary_color || crediarioTheme.button_color,
                  }
                : {}),
              ...(isDark && crediarioTheme.background_color ? { "--background": crediarioTheme.background_color } : {}),
              ...(isDark && crediarioTheme.text_color
                ? {
                    "--foreground": crediarioTheme.text_color,
                    "--card-foreground": crediarioTheme.text_color,
                    "--popover-foreground": crediarioTheme.text_color,
                  }
                : {}),
            }
          : {}),
      } as React.CSSProperties
    : undefined;

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <DailyGoalsPopup />
      {/* Sidebar fixa (desktop apenas) */}
      <div className="hidden lg:block flex-shrink-0">
        <AppSidebar />
      </div>

      {/* Sidebar como overlay (mobile apenas) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop escuro — clicar fecha o menu */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          {/* Painel deslizante da esquerda */}
          <div className="relative z-50 h-full w-60 animate-in slide-in-from-left duration-200">
            <AppSidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Área principal de conteúdo */}
      <main className="flex-1 overflow-auto min-w-0" style={contentStyle}>
        <PwaInstallBanner />
        {/* Header mobile: botão de menu + nome + sino */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-bold text-lg truncate flex-1">{settings.system_name}</span>
          <NotificationBell />
        </div>

        {/* Header desktop: apenas o sino de notificações alinhado à direita */}
        <div className="sticky top-0 z-30 hidden lg:flex items-center justify-end border-b bg-background px-6 py-2">
          <NotificationBell />
        </div>

        {/* Conteúdo da página com padding responsivo.
            O app original do Crediário limitava todo o conteúdo a max-w-6xl
            centralizado (mesmo padrão aqui, só dentro de /crediario/*). */}
        <div className={cn("p-3 sm:p-4 lg:p-6 min-w-0 max-w-full", isCrediarioRoute && "mx-auto max-w-6xl")}>
          {children}
        </div>
      </main>
    </div>
  );
}
