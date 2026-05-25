/**
 * ============================================================================
 * AuthContext.tsx — Estado global de autenticação, papéis e permissões
 * ============================================================================
 * - Restaura sessão Supabase + escuta mudanças de auth
 * - Carrega papéis do usuário (enum app_role) E o role_key (função customizada)
 * - Carrega o conjunto de páginas permitidas para a função do usuário
 * - Expõe useAuth() com isAdmin/isGerente/isFinanceiro + canAccessPath()
 *
 * REGRAS DE PERMISSÃO DE PÁGINA:
 *   - admin (key='admin') sempre vê tudo
 *   - demais: precisa ter a página marcada como allowed=true em role_page_permissions
 *   - rotas sempre liberadas: /perfil, /notificacoes, /instalar, /login
 * ============================================================================
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ALWAYS_ALLOWED_PATHS, pageKeyForPath } from "@/lib/pagePermissions";

type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  roleKey: string | null;          // chave da função (custom ou nome do enum)
  isAdmin: boolean;
  isGerente: boolean;
  isFinanceiro: boolean;
  loading: boolean;
  /** true quando papéis + permissões do usuário já foram carregados. */
  permissionsLoaded: boolean;
  /** true se a página atual (path) está permitida para a função do usuário. */
  canAccessPath: (path: string) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const BACKEND_STORAGE_KEY = "crm_backend_fingerprint";

function clearPersistedAuthTokens() {
  for (const key of Object.keys(localStorage)) {
    if (key === "supabase.auth.token" || /^sb-.*auth-token/.test(key)) {
      localStorage.removeItem(key);
    }
  }
}

function syncPersistedAuthWithCurrentBackend() {
  const runtimeConfig = (window as Window & { __CRM_RUNTIME_CONFIG__?: { supabaseUrl?: string; supabasePublishableKey?: string } }).__CRM_RUNTIME_CONFIG__;
  const currentBackendUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || "";
  const currentPublishableKey =
    runtimeConfig?.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!currentBackendUrl) return;
  const currentBackendFingerprint = `${currentBackendUrl}::${currentPublishableKey}`;
  const previousBackendFingerprint = localStorage.getItem(BACKEND_STORAGE_KEY);
  if (previousBackendFingerprint && previousBackendFingerprint !== currentBackendFingerprint) {
    clearPersistedAuthTokens();
  }
  localStorage.setItem(BACKEND_STORAGE_KEY, currentBackendFingerprint);
}

type RoleRow = { role: AppRole; role_key: string | null };

async function fetchRoles(userId: string): Promise<RoleRow[]> {
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("role, role_key")
      .eq("user_id", userId);
    return (data || []) as RoleRow[];
  } catch {
    return [];
  }
}

async function fetchAllowedPages(roleKey: string): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("role_page_permissions")
      .select("page_key, allowed")
      .eq("role_key", roleKey)
      .eq("allowed", true);
    return new Set((data || []).map((r: any) => r.page_key as string));
  } catch {
    return new Set();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [allowedPages, setAllowedPages] = useState<Set<string>>(new Set());
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        syncPersistedAuthWithCurrentBackend();
        const { data: { session: restoredSession } } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(restoredSession);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setRoles([]);
        setRoleKey(null);
        setAllowedPages(new Set());
        setLoading(false);
        return;
      }
      if (nextSession) {
        setSession(nextSession);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const userId = session?.user?.id;
    if (!userId) {
      setRoles([]); setRoleKey(null); setAllowedPages(new Set()); setPermissionsLoaded(false);
      return;
    }

    setRoles([]);
    setAllowedPages(new Set());
    setPermissionsLoaded(false);

    (async () => {
      const rows = await fetchRoles(userId);
      if (!mounted) return;
      const enumRoles = rows.map((r) => r.role);
      const primary = rows[0];
      const key = primary?.role_key || primary?.role || null;
      setRoles(enumRoles);
      setRoleKey(key);
      if (key) {
        const pages = await fetchAllowedPages(key);
        if (mounted) setAllowedPages(pages);
      }
      if (mounted) setPermissionsLoaded(true);
    })();

    return () => { mounted = false; };
  }, [session?.user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };

  const canAccessPath = (path: string) => {
    if (ALWAYS_ALLOWED_PATHS.has(path)) return true;
    if (roleKey === "admin") return true;
    const key = pageKeyForPath(path);
    if (!key) return true; // rota não catalogada → não bloqueia (ex: dialogs)
    return allowedPages.has(key);
  };

  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    roles,
    roleKey,
    isAdmin: roles.includes("admin"),
    isGerente: roles.includes("gerente"),
    isFinanceiro: roles.includes("financeiro"),
    loading,
    permissionsLoaded,
    canAccessPath,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
