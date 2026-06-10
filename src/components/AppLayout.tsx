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
import AppSidebar from "./AppSidebar";
import PwaInstallBanner from "./PwaInstallBanner";
import NotificationBell from "./NotificationBell";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

/**
 * @param children Conteúdo da página renderizado à direita da sidebar.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  // Controla a abertura do drawer no mobile.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings } = useSystemSettings();

  return (
    <div className="flex h-[100dvh] overflow-hidden">
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
      <main className="flex-1 overflow-auto min-w-0">
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

        {/* Conteúdo da página com padding responsivo */}
        <div className="p-3 sm:p-4 lg:p-6 min-w-0 max-w-full">{children}</div>
      </main>
    </div>
  );
}
