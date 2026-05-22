/**
 * Catálogo de páginas do sistema (para a tela de Funções e Permissões).
 * - `key`: chave estável (mesma usada na tabela role_page_permissions)
 * - `path`: rota React Router que esta página representa
 * - `label`: nome amigável exibido nos checkboxes
 *
 * Para adicionar uma nova página gerenciável:
 *   1) Acrescente uma entrada aqui (chave única + path + label)
 *   2) Garanta que a key também exista em role_page_permissions para cada função
 */
export type AppPage = {
  key: string;
  label: string;
  path: string;
};

export const APP_PAGES: AppPage[] = [
  { key: "leads",                label: "Leads",                  path: "/" },
  { key: "novo_lead",            label: "Novo Lead",              path: "/novo-lead" },
  { key: "agendamentos",         label: "Agendamentos",           path: "/agendamentos" },
  { key: "page_orcamentos",      label: "Orçamentos",             path: "/orcamentos" },

  { key: "clientes_ativos",      label: "Renovação",              path: "/clientes-ativos" },
  { key: "cobrancas",            label: "Cobranças",              path: "/cobrancas" },
  { key: "cobrancas_fluxo",      label: "Fluxo de Cobrança",      path: "/cobrancas/fluxo" },
  { key: "dashboard",            label: "Dashboard",              path: "/dashboard" },
  { key: "relatorio_vendas",     label: "Relatório de Vendas",    path: "/relatorio-vendas" },
  { key: "usuarios",             label: "Usuários",               path: "/usuarios" },
  { key: "empresas",             label: "Empresas",               path: "/empresas" },
  { key: "colunas",              label: "Colunas CRM",            path: "/colunas" },
  { key: "formulario",           label: "Formulário Lead",        path: "/formulario" },
  { key: "formulario_renovacao", label: "Formulário Renovação",   path: "/formulario-renovacao" },
  { key: "whatsapp",             label: "WhatsApp",               path: "/whatsapp" },
  { key: "importar",             label: "Importar Leads",         path: "/importar" },
  { key: "integracoes_ssotica",  label: "Integrações SSótica",    path: "/integracoes-ssotica" },
  { key: "status_ssotica",       label: "Status SSótica",         path: "/status-ssotica" },
  { key: "logs_movimentacao",    label: "Logs Movimentação",      path: "/logs-movimentacao" },
  { key: "configuracoes",        label: "Configurações",          path: "/configuracoes" },
];

/** Rotas sempre liberadas (perfil pessoal, notificações, instalação do PWA). */
export const ALWAYS_ALLOWED_PATHS = new Set<string>([
  "/perfil",
  "/notificacoes",
  "/instalar",
  "/login",
]);

export function pageKeyForPath(path: string): string | null {
  const direct = APP_PAGES.find((p) => p.path === path);
  if (direct) return direct.key;
  // Fallback: trata sub-rotas (ex: /cobrancas/fluxo casa exatamente; outras descem)
  const prefix = APP_PAGES
    .filter((p) => p.path !== "/" && path.startsWith(p.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return prefix?.key ?? null;
}
