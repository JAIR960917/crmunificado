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
  { key: "tarefas_crediario",    label: "Tarefas Cobrança",      path: "/tarefas-crediario" },
  { key: "dashboard",            label: "Dashboard",              path: "/dashboard" },
  { key: "meu_dashboard",        label: "Meu Dashboard",          path: "/meu-dashboard" },
  { key: "meu_dashboard_cobranca", label: "Dashboard Cobrança",   path: "/meu-dashboard-cobranca" },
  { key: "relatorio_vendas",     label: "Relatório de Vendas",    path: "/relatorio-vendas" },
  { key: "usuarios",             label: "Usuários",               path: "/usuarios" },
  { key: "empresas",             label: "Empresas",               path: "/empresas" },
  { key: "colunas",              label: "Colunas CRM",            path: "/colunas" },
  { key: "formulario",           label: "Formulário Lead",        path: "/formulario" },
  { key: "formulario_renovacao", label: "Formulário Renovação",   path: "/formulario-renovacao" },
  { key: "whatsapp",             label: "WhatsApp",               path: "/whatsapp" },
  { key: "whatsapp_inbox_demo",  label: "Inbox WhatsApp",         path: "/whatsapp-inbox" },
  { key: "importar",             label: "Importar Leads",         path: "/importar" },
  { key: "campanhas_copa",       label: "Campanhas Copa",         path: "/campanhas-copa" },
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
  "/privacidade",
  "/termos",
  "/exclusao-dados",
  "/campanha-copa",
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

/** Inbox WhatsApp: usuário dedicado à cobrança (sem acesso a leads/renovação). */
export function isCobrancaInboxUser(params: {
  isFinanceiro: boolean;
  canAccessPath: (path: string) => boolean;
}): boolean {
  if (params.isFinanceiro) return true;
  const hasLeads = params.canAccessPath("/");
  const hasRenovacao = params.canAccessPath("/clientes-ativos");
  const hasCobranca = params.canAccessPath("/cobrancas");
  return hasCobranca && !hasLeads && !hasRenovacao;
}

export type InboxModuleKey = "leads" | "cobrancas" | "renovacoes";

/** Linha WhatsApp configurada para cobrança (nome ou instância marcada nas settings). */
export function isCobrancaWhatsAppInstanceName(name: string | null | undefined): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("cobran");
}

/** Admin/gerente na linha de cobrança também usa o painel de cobrança. */
export function shouldUseCobrancaInboxPanel(params: {
  dedicatedCobrancaUser: boolean;
  conversationModule: string | null;
  instanceId: string | null;
  cobrancaInstanceIds?: ReadonlySet<string>;
  instanceName?: string | null;
}): boolean {
  if (params.dedicatedCobrancaUser) return true;
  if (params.conversationModule === "cobrancas") return true;
  if (params.instanceId && params.cobrancaInstanceIds?.has(params.instanceId)) return true;
  if (isCobrancaWhatsAppInstanceName(params.instanceName)) return true;
  return false;
}

function isInboxModuleKey(m: string | null | undefined): m is InboxModuleKey {
  return m === "cobrancas" || m === "renovacoes" || m === "leads";
}

/** Módulo exibido no Inbox: prioriza onde o card foi encontrado/vinculado no CRM. */
export function inboxDisplayModuleForConversation(params: {
  dedicatedCobrancaUser: boolean;
  storedModule: string | null;
  cardId: string | null;
  instanceId: string | null;
  cobrancaInstanceIds?: ReadonlySet<string>;
  instanceName?: string | null;
}): InboxModuleKey {
  if (params.cardId && isInboxModuleKey(params.storedModule)) {
    return params.storedModule;
  }
  return inboxModuleForConversation(params);
}

export function inboxModuleForConversation(params: {
  dedicatedCobrancaUser: boolean;
  storedModule: string | null;
  instanceId: string | null;
  cobrancaInstanceIds?: ReadonlySet<string>;
  instanceName?: string | null;
}): InboxModuleKey {
  if (
    params.storedModule === "cobrancas"
    || params.storedModule === "renovacoes"
    || params.storedModule === "leads"
  ) {
    if (params.storedModule === "renovacoes" || params.storedModule === "leads") {
      const onCobrancaLine = shouldUseCobrancaInboxPanel({
        dedicatedCobrancaUser: params.dedicatedCobrancaUser,
        conversationModule: null,
        instanceId: params.instanceId,
        cobrancaInstanceIds: params.cobrancaInstanceIds,
        instanceName: params.instanceName,
      });
      if (onCobrancaLine && params.storedModule !== "cobrancas") {
        return "cobrancas";
      }
    }
    return params.storedModule;
  }
  if (
    shouldUseCobrancaInboxPanel({
      dedicatedCobrancaUser: params.dedicatedCobrancaUser,
      conversationModule: null,
      instanceId: params.instanceId,
      cobrancaInstanceIds: params.cobrancaInstanceIds,
      instanceName: params.instanceName,
    })
  ) {
    return "cobrancas";
  }
  return "leads";
}

export function inboxModuleKeyForUser(
  cobrancaMode: boolean,
  storedModule: string | null,
): InboxModuleKey {
  if (cobrancaMode) return "cobrancas";
  return storedModule === "cobrancas" || storedModule === "renovacoes" ? storedModule : "leads";
}
