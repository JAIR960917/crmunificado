import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      try {
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

      // INITIAL_SESSION é tratado pelo restoreSession()
      if (event === "INITIAL_SESSION") {
        return;
      }

      // Só limpa a sessão em logout explícito ou usuário removido.
      // TOKEN_REFRESHED com falha temporária pode emitir nextSession=null
      // sem que o usuário tenha realmente saído — ignorar evita "fechar" o CRM.
      if (event === "SIGNED_OUT") {
        setSession(null);
        setRoles([]);
        setLoading(false);
        return;
      }

      // Para SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, etc. só atualiza se houver sessão.
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
      setRoles([]);
      return;
    }

    setRoles([]);

    void fetchRoles(userId).then((nextRoles) => {
      if (mounted) {
        setRoles(nextRoles);
      }
    });

    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
