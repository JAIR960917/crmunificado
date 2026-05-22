/**
 * ============================================================================
 * App.tsx — Componente raiz: providers globais + roteamento + controle de acesso
 * ============================================================================
 * Responsabilidades:
 *   1) Configura providers globais (React Query, Tooltip, Toast, Auth, Settings)
 *   2) Define TODAS as rotas da aplicação (mapa URL → página)
 *   3) Implementa controle de acesso por papel (admin / gerente / financeiro / vendedor)
 *
 * Hierarquia de providers (de fora pra dentro):
 *   QueryClient → Tooltip → BrowserRouter → AuthProvider → SystemSettingsProvider → Routes
 *
 * Wrappers de rota:
 *   - <PublicRoute>     : só usuários DESLOGADOS (ex.: /login)
 *   - <ProtectedRoute>  : exige sessão (não usado diretamente — RoleGate já cobre)
 *   - <RoleGate>        : exige sessão + valida o papel para a rota atual
 * ============================================================================
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SystemSettingsProvider } from "@/contexts/SystemSettingsContext";
import { usePushNotifications } from "@/hooks/use-push-notifications";

// ----- Páginas (cada import = uma rota) -----
import Login from "./pages/Login";
import LeadsPage from "./pages/LeadsPage";
import UsersPage from "./pages/UsersPage";
import ColumnsPage from "./pages/ColumnsPage";
import CompaniesPage from "./pages/CompaniesPage";
import FormBuilderPage from "./pages/FormBuilderPage";
import RenovacaoFormBuilderPage from "./pages/RenovacaoFormBuilderPage";
import NewLeadPage from "./pages/NewLeadPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import InstallPage from "./pages/InstallPage";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";
import WhatsAppPage from "./pages/WhatsAppPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import OrcamentosPage from "./pages/OrcamentosPage";

import ActiveClientsPage from "./pages/ActiveClientsPage";
import ImportLeadsPage from "./pages/ImportLeadsPage";
import CobrancasPage from "./pages/CobrancasPage";
import CobrancaFlowPage from "./pages/CobrancaFlowPage";
import SSoticaIntegrationsPage from "./pages/SSoticaIntegrationsPage";
import SSoticaStatusPage from "./pages/SSoticaStatusPage";
import TransitionLogsPage from "./pages/TransitionLogsPage";
import DashboardPage from "./pages/DashboardPage";
import SalesReportPage from "./pages/SalesReportPage";
import NotFound from "./pages/NotFound";

/** Cliente React Query — cache compartilhado de chamadas ao backend. */
const queryClient = new QueryClient();

/**
 * Componente "fantasma" que apenas dispara o hook de push notifications.
 * Existe para que o hook rode UMA vez, dentro do AuthProvider.
 */
function PushNotificationsBootstrap() {
  usePushNotifications();
  return null;
}

/**
 * Wrapper genérico: bloqueia acesso se o usuário NÃO está logado.
 * Mostra "Carregando..." enquanto a sessão é restaurada do localStorage.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Wrapper principal de rotas privadas: exige sessão + valida acesso à página
 * com base nas permissões da função do usuário (tabela role_page_permissions).
 */
function RoleGate({ children }: { children: React.ReactNode }) {
  const { session, loading, canAccessPath, roleKey } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (!session) return <Navigate to="/login" replace />;

  // Espera o roleKey carregar antes de decidir (evita redirect prematuro).
  if (!roleKey) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando...</div>;

  const path = window.location.pathname;
  if (!canAccessPath(path)) {
    return <Navigate to={canAccessPath("/") ? "/" : "/perfil"} replace />;
  }
  return <>{children}</>;
}

/**
 * Wrapper para páginas públicas (ex.: /login).
 * Se o usuário JÁ estiver logado, manda pra home apropriada.
 */
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, isAdmin } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando...</div>;
  if (session) return <Navigate to={isAdmin ? "/dashboard" : "/"} replace />;
  return <>{children}</>;
}

/** Mapa de URLs → componentes (o "índice" do sistema). */
const AppRoutes = () => {
  return (
    <Routes>
      {/* Pública */}
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />

      {/* Privadas — todas passam por RoleGate */}
      <Route path="/" element={<RoleGate><LeadsPage /></RoleGate>} />
      <Route path="/usuarios" element={<RoleGate><UsersPage /></RoleGate>} />
      <Route path="/empresas" element={<RoleGate><CompaniesPage /></RoleGate>} />
      <Route path="/colunas" element={<RoleGate><ColumnsPage /></RoleGate>} />
      <Route path="/formulario" element={<RoleGate><FormBuilderPage /></RoleGate>} />
      <Route path="/formulario-renovacao" element={<RoleGate><RenovacaoFormBuilderPage /></RoleGate>} />
      <Route path="/novo-lead" element={<RoleGate><NewLeadPage /></RoleGate>} />
      <Route path="/configuracoes" element={<RoleGate><SettingsPage /></RoleGate>} />
      <Route path="/perfil" element={<RoleGate><ProfilePage /></RoleGate>} />
      <Route path="/notificacoes" element={<RoleGate><NotificationSettingsPage /></RoleGate>} />
      <Route path="/whatsapp" element={<RoleGate><WhatsAppPage /></RoleGate>} />
      <Route path="/agendamentos" element={<RoleGate><AppointmentsPage /></RoleGate>} />
      <Route path="/orcamentos" element={<RoleGate><OrcamentosPage /></RoleGate>} />

      <Route path="/clientes-ativos" element={<RoleGate><ActiveClientsPage /></RoleGate>} />
      <Route path="/importar" element={<RoleGate><ImportLeadsPage /></RoleGate>} />
      <Route path="/cobrancas" element={<RoleGate><CobrancasPage /></RoleGate>} />
      <Route path="/cobrancas/fluxo" element={<RoleGate><CobrancaFlowPage /></RoleGate>} />
      <Route path="/integracoes-ssotica" element={<RoleGate><SSoticaIntegrationsPage /></RoleGate>} />
      <Route path="/status-ssotica" element={<RoleGate><SSoticaStatusPage /></RoleGate>} />
      <Route path="/logs-movimentacao" element={<RoleGate><TransitionLogsPage /></RoleGate>} />
      <Route path="/dashboard" element={<RoleGate><DashboardPage /></RoleGate>} />
      <Route path="/relatorio-vendas" element={<RoleGate><SalesReportPage /></RoleGate>} />

      {/* /instalar é semipública (orienta a instalar PWA) */}
      <Route path="/instalar" element={<InstallPage />} />

      {/* Catch-all 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

/**
 * Árvore de providers da aplicação.
 * IMPORTANTE: a ordem importa — AuthProvider precisa estar DENTRO do BrowserRouter
 * (usa hooks de roteamento) e SystemSettingsProvider DENTRO do Auth (lê o usuário).
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />        {/* Toasts antigos (shadcn) */}
      <Sonner />         {/* Toasts novos (sonner) — usados em todo o app */}
      <BrowserRouter>
        <AuthProvider>
          <PushNotificationsBootstrap />
          <SystemSettingsProvider>
            <AppRoutes />
          </SystemSettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
