-- Inbox WhatsApp: acesso por EMPRESA da instância, além da atribuição manual.
--
-- Até agora, ver/responder uma conversa exigia uma linha explícita em
-- whatsapp_instance_assignments (usuário ↔ instância) — vínculo por empresa
-- (whatsapp_instances.company_id) só afetava a listagem de nomes das
-- instâncias, não o acesso real.
--
-- Esta migration faz: qualquer usuário da MESMA empresa da instância
-- (profiles.company_id ou manager_companies) passa a ver e poder aceitar
-- as conversas pendentes daquele número, sem precisar de atribuição manual.
-- Quando uma conversa é TRANSFERIDA para alguém de outra empresa, esse
-- destinatário passa a ter acesso automaticamente (porque agora é o
-- assigned_to daquela conversa naquela instância) — cobre o caso de handoff
-- entre empresas (ex.: loja Caicó → Cobrança Joonker, e vice-versa).

CREATE OR REPLACE FUNCTION public.user_has_whatsapp_inbox_access(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN has_role(auth.uid(), 'admin'::app_role) THEN true
    WHEN p_instance_id IS NULL THEN false
    ELSE
      EXISTS (
        SELECT 1 FROM public.whatsapp_instance_assignments a
        WHERE a.user_id = auth.uid() AND a.instance_id = p_instance_id
      )
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_instances i
        WHERE i.id = p_instance_id
          AND i.company_id IS NOT NULL
          AND public.is_my_company(i.company_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_conversations c
        WHERE c.instance_id = p_instance_id AND c.assigned_to = auth.uid()
      )
  END;
$$;

-- Lista de destinos para "Transferir": antes só listava quem já tinha
-- acesso ao número (o que tornava impossível transferir para alguém de
-- outra empresa — exatamente o caso que queremos suportar). Agora lista
-- qualquer membro da equipe (qualquer empresa); o acesso real é concedido
-- no momento da transferência.
CREATE OR REPLACE FUNCTION public.list_whatsapp_inbox_assignable_users(p_instance_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.user_id, p.full_name, p.email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id
  WHERE p_instance_id IS NOT NULL
    AND ur.role IN ('admin', 'gerente', 'vendedor', 'financeiro')
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

-- Transferir conversa: o destino só precisa ser um membro válido da equipe
-- (não precisa já ter acesso ao número — é a própria transferência que
-- concede o acesso, via user_has_whatsapp_inbox_access acima).
CREATE OR REPLACE FUNCTION public.transfer_whatsapp_conversation(p_conversation_id uuid, p_to_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
  v_assigned_to uuid;
  v_status text;
  v_target_is_staff boolean;
BEGIN
  SELECT instance_id, assigned_to, status INTO v_instance_id, v_assigned_to, v_status
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT (
    v_assigned_to = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (v_status = 'pending' AND public.user_has_whatsapp_inbox_access(v_instance_id))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para transferir esta conversa';
  END IF;

  v_target_is_staff := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_to_user_id
      AND ur.role IN ('admin', 'gerente', 'vendedor', 'financeiro')
  );

  IF NOT v_target_is_staff THEN
    RAISE EXCEPTION 'Usuário de destino inválido';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'open', assigned_to = p_to_user_id, updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
