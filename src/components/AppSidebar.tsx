/**
 * ============================================================================
 * AppSidebar.tsx — Menu lateral de navegação
 * ============================================================================
 * O QUE FAZ:
 *   - Lista todas as páginas do sistema (filtradas por papel do usuário)
 *   - Botões inferiores: Atualizar Sistema (limpa cache PWA), Instalar App,
 *     Tema (dark/light), Meu Perfil, Sair
 *   - Mostra nome e logo do sistema (vem de SystemSettingsContext)
 *
 * REGRAS DE PERMISSÃO (canSee):
 *   - Item COM `roles`: aparece se o usuário tem PELO MENOS UM dos papéis
 *   - Item SEM `roles`: aparece para todos EXCETO financeiro puro
 *     (financeiro só vê o que estiver explicitamente liberado)
 * ============================================================================
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, LogOut, Columns3, Building2, FileText,
  Sun, Moon, Download, Settings, UserCircle, Bell, MessageSquare,
  CalendarCheck, UserCheck, Upload, Receipt, Plug, CalendarHeart,
  History, BarChart3, FileBarChart, RefreshCw, Workflow, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { pageKeyForPath } from "@/lib/pagePermissions";

/** Estrutura de um item do menu. */
type NavItem = {
  path: string;
  label: string;
  icon: any;
};

/** Itens do menu principal — ORDEM IMPORTA (é a ordem visual). */
const navItems: NavItem[] = [
  { path: "/dashboard",            label: "Dashboard",              icon: BarChart3 },
  { path: "/meu-dashboard",        label: "Meu Dashboard",          icon: LayoutDashboard },
  { path: "/relatorio-vendas",     label: "Relatório de Vendas",    icon: FileBarChart },
  { path: "/",                     label: "Leads",                  icon: LayoutDashboard },
  { path: "/cobrancas",            label: "Cobranças",              icon: Receipt },
  { path: "/cobrancas/fluxo",      label: "Fluxo Cobrança",         icon: Workflow },
  { path: "/agendamentos",         label: "Agendamentos",           icon: CalendarCheck },
  { path: "/orcamentos",           label: "Orçamentos",             icon: Receipt },

  { path: "/clientes-ativos",      label: "Renovação",              icon: UserCheck },
  { path: "/usuarios",             label: "Usuários",               icon: Users },
  { path: "/empresas",             label: "Empresas",               icon: Building2 },
  { path: "/colunas",              label: "Colunas CRM",            icon: Columns3 },
  { path: "/formulario",           label: "Formulário Lead",        icon: FileText },
  { path: "/formulario-renovacao", label: "Formulário Renovação",   icon: CalendarHeart },
  { path: "/configuracoes",        label: "Configurações",          icon: Settings },
  { path: "/notificacoes",         label: "Notificações",           icon: Bell },
  { path: "/whatsapp",             label: "WhatsApp",               icon: MessageSquare },
  { path: "/importar",             label: "Importar Leads",         icon: Upload },
  { path: "/integracoes-ssotica",  label: "Integrações SSótica",    icon: Plug },
  { path: "/status-ssotica",       label: "Status SSótica",         icon: Activity },
  { path: "/logs-movimentacao",    label: "Logs Movimentação",      icon: History },
];

interface Props {
  /** Callback chamado após navegação — usado pelo mobile para fechar o drawer. */
  onNavigate?: () => void;
}

export default function AppSidebar({ onNavigate }: Props) {
  const { user, canAccessPath, signOut } = useAuth();
  const { settings } = useSystemSettings();

  const [signingOut, setSigningOut] = useState(false);
  const [updating, setUpdating] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  /** Decide se o item de menu deve aparecer (com base nas permissões da função). */
  const canSee = (item: NavItem) => {
    // /notificacoes é sempre liberado pelo AuthContext
    if (item.path === "/notificacoes") return true;
    // Item sem chave catalogada → sempre exibe
    if (!pageKeyForPath(item.path)) return true;
    return canAccessPath(item.path);
  };

  /** Navega para a rota e (no mobile) fecha o drawer. */
  const handleNav = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  /** Faz logout e redireciona para /login. */
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

  /**
   * "Atualizar Sistema": força a versão mais nova quando o PWA está com
   * cache antigo. Apaga caches do browser, desregistra Service Workers
   * e recarrega a página.
   */
  const handleUpdateSystem = async () => {
    if (updating) return;
    setUpdating(true);
    toast.loading("Atualizando sistema...", { id: "update-system" });
    try {
      // 1. Apaga caches do navegador (PWA / Service Worker).
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 2. Desregistra todos os Service Workers ativos.
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(async (r) => {
            try { await r.update(); } catch {}
            try { await r.unregister(); } catch {}
          })
        );
      }
      toast.success("Recarregando...", { id: "update-system" });
      // 3. Pequeno delay para o toast aparecer antes do reload.
      setTimeout(() => window.location.reload(), 400);
    } catch {
      toast.error("Falha ao atualizar. Tente novamente.", { id: "update-system" });
      setUpdating(false);
    }
  };

  return (
    <aside className="flex h-screen w-60 flex-col bg-sidebar text-sidebar-foreground">
      {/* ===== Topo: logo + nome do sistema ===== */}
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

      {/* ===== Menu principal (rolável) ===== */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 min-h-0">
        {navItems.filter(canSee).map((item) => (
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

      {/* ===== Rodapé: ações utilitárias + sair ===== */}
      <div className="space-y-2 border-t border-sidebar-border px-3 py-4 flex-shrink-0">
        {/* Atualizar (limpa cache PWA) */}
        <button
          onClick={handleUpdateSystem}
          disabled={updating}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-sidebar-accent/50 disabled:pointer-events-none disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", updating && "animate-spin")} />
          {updating ? "Atualizando..." : "Atualizar Sistema"}
        </button>

        {/* Instalar PWA */}
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

        {/* Toggle de tema dark/light (persistido em localStorage) */}
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

        {/* Meu Perfil */}
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

        {/* E-mail do usuário (apenas exibição) */}
        <div className="truncate px-3 text-xs text-sidebar-foreground/60">
          {user?.email}
        </div>

        {/* Sair */}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50 disabled:pointer-events-none disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Saindo..." : "Sair"}
        </button>

        {/* Badge de versão (atualize manualmente quando publicar uma versão nova) */}
        <div className="mx-3 rounded-md border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-center text-xs font-semibold text-emerald-400">
          v1.0.4
        </div>
      </div>
    </aside>
  );
}
