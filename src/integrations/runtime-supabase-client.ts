import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type RuntimeConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

declare global {
  interface Window {
    __CRM_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const runtimeConfig = window.__CRM_RUNTIME_CONFIG__ ?? {};

const SUPABASE_URL = runtimeConfig.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = runtimeConfig.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Configuração do backend ausente. Defina runtime-config.js ou as variáveis VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY.");
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});