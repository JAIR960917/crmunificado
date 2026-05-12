/**
 * ============================================================================
 * AuthContext.tsx — Estado global de autenticação e papéis (roles)
 * ============================================================================
 * O QUE FAZ:
 *   - Restaura a sessão do Supabase ao carregar a página
 *   - Escuta mudanças de auth (login, logout, refresh de token)
 *   - Busca os papéis do usuário na tabela `user_roles`
 *   - Expõe `useAuth()` com: session, user, roles, flags (isAdmin, ...), signOut
 *
 * SEGURANÇA:
 *   - Papéis NÃO ficam no JWT — sempre lidos do banco com RLS
 *   - Lista de papéis: 'admin' | 'gerente' | 'vendedor' | 'financeiro'
 *
 * DETALHE IMPORTANTE (não remover sem entender):
 *   - Em TOKEN_REFRESHED com sessão null (falha temporária de rede), NÃO
 *     limpamos a sessão — isso evitava o CRM "deslogar sozinho" do usuário.
 *   - Só SIGNED_OUT explícito limpa o estado.
 * ============================================================================
 */
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Tipos de papel reconhecidos pelo sistema (espelha o enum app_role no DB). */
type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";

/** Forma do contexto exposto via useAuth(). */
interface AuthContextType {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  isAdmin: boolean;
  isGerente: boolean;
  isFinanceiro: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const BACKEND_STORAGE_KEY = "crm_backend_url";

function syncPersistedAuthWithCurrentBackend() {
  const runtimeConfig = window.__CRM_RUNTIME_CONFIG__;
  const currentBackendUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || "";

  if (!currentBackendUrl) return;

  const previousBackendUrl = localStorage.getItem(BACKEND_STORAGE_KEY);

  if (previousBackendUrl && previousBackendUrl !== currentBackendUrl) {
    for (const key of Object.keys(localStorage)) {
      if (key === "supabase.auth.token" || /^sb-.*auth-token/.test(key)) {
        localStorage.removeItem(key);
      }
    }

    console.warn("[Auth] Backend alterado; sessão local anterior foi limpa para evitar token inválido.", {
      previousBackendUrl,
      currentBackendUrl,
    });
  }

  localStorage.setItem(BACKEND_STORAGE_KEY, currentBackendUrl);
}

/**
 * Busca os papéis do usuário no banco.
 * Falhas retornam array vazio (usuário sem papel = sem permissão extra).
 * @param userId UUID do usuário autenticado
 */
async function fetchRoles(userId: string): Promise<AppRole[]> {
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    return (data || []).map((r) => r.role as AppRole);
  } catch {
    return [];
  }
}

/**
 * Provider que envolve a aplicação e fornece o contexto de autenticação.
 * Deve ficar DENTRO do BrowserRouter (App.tsx).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  // ----- Efeito 1: restaurar sessão + escutar eventos do Supabase Auth -----
  useEffect(() => {
    let mounted = true; // evita setState após unmount

    /** Lê a sessão persistida no localStorage (refresh da página). */
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

    // Listener de eventos de auth (login, logout, refresh de token...).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;

      // INITIAL_SESSION já foi tratado por restoreSession() acima — ignoramos.
      if (event === "INITIAL_SESSION") return;

      // Logout explícito ou usuário deletado: limpa tudo.
      if (event === "SIGNED_OUT") {
        setSession(null);
        setRoles([]);
        setLoading(false);
        return;
      }

      // Demais eventos (SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED) só atualizam
      // se nextSession existe — evita "deslogar fantasma" em refresh falho.
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

  // ----- Efeito 2: buscar papéis sempre que o usuário muda -----
  useEffect(() => {
    let mounted = true;
    const userId = session?.user?.id;

    if (!userId) {
      setRoles([]);
      return;
    }

    setRoles([]); // reseta enquanto carrega (evita papéis "antigos" piscando)

    void fetchRoles(userId).then((nextRoles) => {
      if (mounted) setRoles(nextRoles);
    });

    return () => { mounted = false; };
  }, [session?.user?.id]);

  /** Faz logout no Supabase — o listener acima limpa o estado. */
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Valor exposto a quem chama useAuth().
  const value: AuthContextType = {
    session,
    user: session?.user ?? null,
    roles,
    isAdmin: roles.includes("admin"),
    isGerente: roles.includes("gerente"),
    isFinanceiro: roles.includes("financeiro"),
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook para consumir o contexto de autenticação.
 * @throws se usado fora de <AuthProvider>
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
