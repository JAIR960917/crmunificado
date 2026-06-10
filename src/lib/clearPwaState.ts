/** Limpa service worker e caches (recuperação de tela de erro / PWA travado). */
export async function clearPwaState(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // no-op
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister().catch(() => undefined)));
    }
  } catch {
    // no-op
  }

  try {
    localStorage.removeItem("crm_sw_gen");
    sessionStorage.removeItem("crm_sw_reload");
  } catch {
    // no-op
  }
}
