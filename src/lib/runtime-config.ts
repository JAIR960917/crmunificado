type RuntimeConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  disableRealtime?: boolean;
};

declare global {
  interface Window {
    __CRM_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  return window.__CRM_RUNTIME_CONFIG__ ?? {};
}

export function isRealtimeEnabled(): boolean {
  return getRuntimeConfig().disableRealtime !== true;
}
