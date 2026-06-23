import { clearPwaState } from "@/lib/clearPwaState";

const AUTO_RECOVER_KEY = "crm_auto_recover_v6";

/** Erros de DOM (corrida de render) — não são causados por falta de rede. */
const DOM_ERROR_PATTERN = /removeChild|insertBefore|not a child/i;

/** Falhas de carregamento de chunk/módulo — esperadas quando offline e a rota nunca foi aberta antes. */
const NETWORK_ERROR_PATTERN = /ChunkLoadError|dynamically imported module|Loading chunk|Failed to fetch/i;

export function isRecoverableBootError(message: string): boolean {
  return DOM_ERROR_PATTERN.test(message) || NETWORK_ERROR_PATTERN.test(message);
}

/**
 * Decide se vale a pena limpar cache/SW e redirecionar para /login.
 * Offline, NUNCA vale a pena: não há rede para recarregar /login do zero,
 * e limpar o cache destruiria o shell que permite o app abrir offline —
 * isso fazia o app navegar para fora de um formulário em preenchimento e
 * "travar" sem internet (o usuário perdia os dados e entrava em loop ao
 * reabrir o app, já que o cache do shell tinha sido apagado). Erros de DOM
 * (corrida de render) e de rede só justificam a limpeza quando há internet.
 */
export function shouldHardRecover(message: string): boolean {
  if (!navigator.onLine) return false;
  return DOM_ERROR_PATTERN.test(message) || NETWORK_ERROR_PATTERN.test(message);
}

/** Uma tentativa automática de limpar cache/SW e reabrir (evita loop infinito). */
export async function tryAutoRecoverOnce(): Promise<boolean> {
  try {
    if (sessionStorage.getItem(AUTO_RECOVER_KEY)) return false;
    sessionStorage.setItem(AUTO_RECOVER_KEY, "1");
  } catch {
    return false;
  }

  try {
    await clearPwaState();
  } catch {
    // no-op
  }

  const base = `${window.location.origin}/login`;
  window.location.replace(`${base}?recover=${Date.now()}`);
  return true;
}

export function clearAutoRecoverFlag(): void {
  try {
    sessionStorage.removeItem(AUTO_RECOVER_KEY);
  } catch {
    // no-op
  }
}

export function setupGlobalRecoverHandlers(): void {
  const handle = (message: string) => {
    if (!shouldHardRecover(message)) return;
    void tryAutoRecoverOnce();
  };

  window.addEventListener("error", (event) => {
    if (event.message) handle(event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
    if (message) handle(message);
  });
}
