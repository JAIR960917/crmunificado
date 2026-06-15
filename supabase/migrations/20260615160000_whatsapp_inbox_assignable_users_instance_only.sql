-- Transferir conversa: listar apenas quem tem permissão cadastrada para o
-- número (whatsapp_instance_assignments), em vez de qualquer admin/gerente/
-- financeiro do sistema.

CREATE OR REPLACE FUNCTION public.list_whatsapp_inbox_assignable_users(p_instance_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.whatsapp_instance_assignments a
    ON a.user_id = p.user_id AND a.instance_id = p_instance_id
  WHERE
    p_instance_id IS NOT NULL
    AND public.user_has_whatsapp_inbox_access(p_instance_id)
  ORDER BY p.full_name NULLS LAST, p.email;
$$;
