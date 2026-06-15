-- Inbox WhatsApp: somente admin mantém acesso global.
--
-- gerente/vendedor/financeiro (e qualquer outro papel não-admin) só veem
-- pendentes e conversas atribuídas a si mesmos para números aos quais têm
-- permissão explícita via whatsapp_instance_assignments. Para transferência,
-- admin pode enviar para qualquer usuário da empresa; os demais só para quem
-- tem permissão cadastrada para aquele número.

-- 1) Acesso ao número: remove o bônus de "gerente vê tudo".
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
    ELSE EXISTS (
      SELECT 1 FROM public.whatsapp_instance_assignments a
      WHERE a.user_id = auth.uid() AND a.instance_id = p_instance_id
    )
  END;
$$;

-- 2) RLS: só admin tem acesso global; o restante depende de
--    user_has_whatsapp_inbox_access (agora baseada só em assignments).
DROP POLICY IF EXISTS "Staff read whatsapp_conversations" ON public.whatsapp_conversations;

CREATE POLICY "Staff read whatsapp_conversations"
  ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      instance_id IS NOT NULL
      AND public.user_has_whatsapp_inbox_access(instance_id)
      AND (status = 'pending' OR assigned_to = auth.uid())
    )
  );

-- 3) Mesmo filtro de visibilidade na RPC de listagem.
CREATE OR REPLACE FUNCTION public.list_whatsapp_inbox_conversations(p_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid,
  instance_id uuid,
  wa_id text,
  contact_name text,
  phone_display text,
  module text,
  card_id uuid,
  window_expires_at timestamptz,
  last_message_at timestamptz,
  last_preview text,
  unread_count int,
  last_message_direction text,
  last_read_at timestamptz,
  assigned_to uuid,
  assigned_to_name text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.instance_id,
    c.wa_id,
    c.contact_name,
    c.phone_display,
    c.module,
    c.card_id,
    c.window_expires_at,
    c.last_message_at,
    c.last_preview,
    GREATEST(
      COALESCE(c.unread_count, 0),
      CASE
        WHEN lm.direction = 'in'
          AND (c.last_read_at IS NULL OR c.last_read_at < lm.created_at)
        THEN 1
        ELSE 0
      END
    )::int AS unread_count,
    COALESCE(c.last_message_direction, lm.direction) AS last_message_direction,
    c.last_read_at,
    c.assigned_to,
    p.full_name AS assigned_to_name,
    c.status
  FROM public.whatsapp_conversations c
  LEFT JOIN LATERAL (
    SELECT m.direction, m.created_at
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN public.profiles p ON p.user_id = c.assigned_to
  WHERE
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      c.instance_id IS NOT NULL
      AND public.user_has_whatsapp_inbox_access(c.instance_id)
      AND (c.status = 'pending' OR c.assigned_to = auth.uid())
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;

-- 4) Transferir: admin pode enviar para qualquer usuário da empresa; os
--    demais só para quem tem permissão cadastrada para o número.
CREATE OR REPLACE FUNCTION public.list_whatsapp_inbox_assignable_users(p_instance_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.email
  FROM public.profiles p
  WHERE
    p_instance_id IS NOT NULL
    AND public.user_has_whatsapp_inbox_access(p_instance_id)
    AND (
      (
        has_role(auth.uid(), 'admin'::app_role)
        AND p.company_id = public.get_my_company_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_instance_assignments a
        WHERE a.user_id = p.user_id AND a.instance_id = p_instance_id
      )
    )
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

-- 5) Fechar conversa: admin, dono atual, ou quem tem acesso ao número
--    enquanto ela ainda está pendente (ainda sem dono).
CREATE OR REPLACE FUNCTION public.close_whatsapp_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
  v_assigned_to uuid;
  v_status text;
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
    RAISE EXCEPTION 'Sem permissão para encerrar esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'closed', updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

-- 6) Transferir conversa: mesma permissão de quem pode fechar; destino
--    precisa ser admin ou ter permissão cadastrada para o número.
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
  v_target_has_access boolean;
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

  v_target_has_access :=
    has_role(p_to_user_id, 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_instance_assignments a
      WHERE a.user_id = p_to_user_id AND a.instance_id = v_instance_id
    );

  IF NOT v_target_has_access THEN
    RAISE EXCEPTION 'Usuário de destino não tem acesso a este número';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'open', assigned_to = p_to_user_id, updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;
