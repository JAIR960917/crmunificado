/**
 * Hook que carrega as permissões de colunas (statuses) para a função do usuário
 * logado, retornando um filtro `isVisible(statusKey, isSystemExcluded)`.
 *
 * Regras:
 * - Admin enxerga tudo.
 * - Coluna "Excluídos" (is_system_excluded) só aparece para admin.
 * - Para demais colunas, se existir registro em role_status_permissions com
 *   visible=false → oculta. Sem registro → visível por padrão.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Module = "leads" | "renovacao";

export function useVisibleStatusKeys(module: Module) {
  const { roleKey, isAdmin } = useAuth();
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!roleKey || isAdmin) {
      setHiddenKeys(new Set());
      setLoaded(true);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("role_status_permissions" as any)
        .select("status_key, visible")
        .eq("role_key", roleKey)
        .eq("module", module);
      if (!mounted) return;
      const hidden = new Set<string>();
      (((data || []) as unknown) as Array<{ status_key: string; visible: boolean }>).forEach((r) => {
        if (!r.visible) hidden.add(r.status_key);
      });
      setHiddenKeys(hidden);
      setLoaded(true);
    })();
    return () => { mounted = false; };
  }, [roleKey, isAdmin, module]);

  const isVisible = (statusKey: string, isSystemExcluded?: boolean) => {
    // Coluna "Excluídos" sempre restrita a admin (segurança extra caso o cache
    // local ainda não tenha o flag is_system_excluded sincronizado).
    if (isSystemExcluded || statusKey === "excluidos") return isAdmin;
    if (isAdmin) return true;
    return !hiddenKeys.has(statusKey);
  };

  return { isVisible, loaded };
}
