import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Empresa (loja) do usuário logado — usada pelas páginas do Crediário para
 *  escopar vendas/contratos/credenciais Cora pela loja correta. */
export function useMyCompanyId() {
  const { user } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCompanyId(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setCompanyId(data?.company_id ?? null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  return { companyId, loading };
}
