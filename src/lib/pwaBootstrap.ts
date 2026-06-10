/** Bump quando precisar limpar SW/cache antigo (ex.: tela branca no iPhone). */
const SW_CACHE_GENERATION = "5";

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;

/** WhatsApp, Instagram, etc. — WebViews costumam quebrar PWA / módulos ES. */
export const isIOSInAppBrowser = () => {
  if (!isIOS()) return false;
  return /CriOS|FxiOS|EdgiOS|OPiOS|WhatsApp|FBAN|FBAV|Instagram|Line|MicroMessenger/i.test(
    navigator.userAgent,
  );
};

/** WebView do WhatsApp/Instagram no Android não instala PWA — só atalho no navegador embutido. */
export const isAndroidInAppBrowser = () => {
  if (!/Android/i.test(navigator.userAgent)) return false;
  return /; wv\)|WhatsApp|Instagram|FBAN|FBAV|Line|MicroMessenger/i.test(navigator.userAgent);
};

async function clearStalePwaCaches() {
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}

async function unregisterAllServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister().catch(() => undefined)));
}

/**
 * Limpa service workers e caches legados (causa comum de tela branca no iPhone/PWA).
 * Roda uma vez por geração ou sempre no iOS standalone na primeira carga da sessão.
 */
export async function runPwaBootstrap() {
  if (typeof window === "undefined") return;

  let lastGen = "";
  try {
    lastGen = localStorage.getItem("crm_sw_gen") || "";
  } catch {
    // Safari modo privado / restrição de storage
  }

  const needsCleanup = lastGen !== SW_CACHE_GENERATION;

  if (!needsCleanup) return;

  await clearStalePwaCaches();
  await unregisterAllServiceWorkers();

  try {
    localStorage.setItem("crm_sw_gen", SW_CACHE_GENERATION);
  } catch {
    // no-op
  }
}

export async function registerPushServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  } catch {
    return false;
  }
}
