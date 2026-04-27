import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";

import { useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, LogOut, Columns3, Building2, FileText, Sun, Moon, Download, Settings, UserCircle, Bell, MessageSquare, CalendarCheck, UserCheck, Upload, Receipt, Plug, CalendarHeart, History, BarChart3, FileBarChart, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Role = "admin" | "gerente" | "financeiro" | "vendedor";

type NavItem = {
  path: string;
  label: string;
  icon: any;
  // If `roles` is set, only those roles see it.
  // If omitted, every role EXCEPT financeiro sees it (financeiro is restricted by default).
  roles?: Role[];
};

const navItems: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: BarChart3, roles: ["admin"] },
  { path: "/relatorio-vendas", label: "Relatório de Vendas", icon: FileBarChart, roles: ["admin"] },
  { path: "/", label: "Leads", icon: LayoutDashboard },
  { path: "/cobrancas", label: "Cobranças", icon: Receipt, roles: ["admin", "financeiro"] },
  { path: "/agendamentos", label: "Agendamentos", icon: CalendarCheck },
  { path: "/clientes-ativos", label: "Renovação", icon: UserCheck },
  { path: "/usuarios", label: "Usuários", icon: Users, roles: ["admin", "gerente"] },
  { path: "/empresas", label: "Empresas", icon: Building2, roles: ["admin"] },
  { path: "/colunas", label: "Colunas CRM", icon: Columns3, roles: ["admin"] },
  { path: "/formulario", label: "Formulário Lead", icon: FileText, roles: ["admin"] },
  { path: "/formulario-renovacao", label: "Formulário Renovação", icon: CalendarHeart, roles: ["admin"] },
  { path: "/configuracoes", label: "Configurações", icon: Settings, roles: ["admin"] },
  { path: "/notificacoes", label: "Notificações", icon: Bell },
  { path: "/whatsapp", label: "WhatsApp", icon: MessageSquare, roles: ["admin", "gerente"] },
  { path: "/importar", label: "Importar Leads", icon: Upload, roles: ["admin"] },
  { path: "/integracoes-ssotica", label: "Integrações SSótica", icon: Plug, roles: ["admin"] },
  { path: "/logs-movimentacao", label: "Logs Movimentação", icon: History, roles: ["admin"] },
];

interface Props {
  onNavigate?: () => void;
}

export default function AppSidebar({ onNavigate }: Props) {
  const { user, isAdmin, isGerente, isFinanceiro, signOut } = useAuth();
  const { settings } = useSystemSettings();
  
  const [signingOut, setSigningOut] = useState(false);
  const [updating, setUpdating] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const canSee = (item: NavItem) => {
    if (item.roles) {
      if (isAdmin && item.roles.includes("admin")) return true;
      if (isGerente && item.roles.includes("gerente")) return true;
      if (isFinanceiro && item.roles.includes("financeiro")) return true;
      return false;
    }
    // No explicit roles: hide from financeiro by default (financeiro only sees explicit pages)
    if (isFinanceiro && !isAdmin && !isGerente) return false;
    return true;
  };

  const handleNav = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      onNavigate?.();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const handleUpdateSystem = async () => {
    if (updating) return;
    setUpdating(true);
    toast.loading("Atualizando sistema...", { id: "update-system" });
    try {
      // Limpa todos os caches do navegador (Service Worker / PWA)
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Atualiza/desregistra service workers para forçar nova versão
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(async (r) => {
            try {
              await r.update();
            } catch {}
            try {
              await r.unregister();
            } catch {}
          })
        );
      }
      toast.success("Recarregando...", { id: "update-system" });
      // Pequeno delay para o toast aparecer antes do reload
      setTimeout(() => {
        // Força bypass de cache
        window.location.reload();
      }, 400);
    } catch (e) {
      toast.error("Falha ao atualizar. Tente novamente.", { id: "update-system" });
      setUpdating(false);
    }
  };

  return (
    <aside className="flex h-screen w-60 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-5 py-5 flex-shrink-0">
        {settings.logo_url ? (
          <img src={settings.logo_url} alt="Logo" className="h-8 w-8 rounded-lg object-contain" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <LayoutDashboard className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
        )}
        <span className="text-lg font-bold text-sidebar-primary-foreground truncate">{settings.system_name}</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 min-h-0">
        {navItems
          .filter(canSee)
          .map((item) => (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                location.pathname === item.path
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
      </nav>

      <div className="space-y-2 border-t border-sidebar-border px-3 py-4 flex-shrink-0">
        <button
          onClick={handleUpdateSystem}
          disabled={updating}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-sidebar-accent/50 disabled:pointer-events-none disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", updating && "animate-spin")} />
          {updating ? "Atualizando..." : "Atualizar Sistema"}
        </button>
        <button
          onClick={() => handleNav("/instalar")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            location.pathname === "/instalar"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-primary hover:bg-sidebar-accent/50"
          )}
        >
          <Download className="h-4 w-4" />
          Instalar App
        </button>
        <button
          onClick={() => {
            const html = document.documentElement;
            const isDark = html.classList.contains("dark");
            html.classList.toggle("dark", !isDark);
            localStorage.setItem("theme", isDark ? "light" : "dark");
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50"
        >
          <Sun className="hidden h-4 w-4 dark:block" />
          <Moon className="h-4 w-4 dark:hidden" />
          <span className="dark:hidden">Modo Escuro</span>
          <span className="hidden dark:inline">Modo Claro</span>
        </button>
        <button
          onClick={() => handleNav("/perfil")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            location.pathname === "/perfil"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
          )}
        >
          <UserCircle className="h-4 w-4" />
          Meu Perfil
        </button>
        <div className="truncate px-3 text-xs text-sidebar-foreground/60">
          {user?.email}
        </div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 disabled:pointer-events-none disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Saindo..." : "Sair"}
        </button>
        <div className="mx-3 rounded-md border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-center text-xs font-semibold text-emerald-400">
          v1.0.2
        </div>
      </div>
    </aside>
  );
}
