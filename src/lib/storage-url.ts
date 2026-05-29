import { getRuntimeConfig } from "@/lib/runtime-config";

/** Reescreve URLs do Storage para o Supabase atual (útil após migração de domínio). */
export function resolveStoragePublicUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";

  const cfg = getRuntimeConfig();
  const base = (cfg.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const storagePath = url.match(/\/storage\/v1\/object\/public\/(.+)$/i);
  if (base && storagePath) {
    return `${base}/storage/v1/object/public/${storagePath[1]}`;
  }
  return url;
}
