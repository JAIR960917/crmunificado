export type AppRuntimeConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  disableRealtime?: boolean;
};

export function getRuntimeConfig(): AppRuntimeConfig {
  return ((window as Window & { __CRM_RUNTIME_CONFIG__?: AppRuntimeConfig }).__CRM_RUNTIME_CONFIG__ ?? {});
}

export function isRealtimeEnabled(): boolean {
  return getRuntimeConfig().disableRealtime !== true;
}
