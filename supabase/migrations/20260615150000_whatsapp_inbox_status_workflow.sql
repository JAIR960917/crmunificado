-- Inbox WhatsApp: fila de atendimento (pendente / aceito / fechado).
--
-- pending: ninguém assumiu ainda — visível para todos com acesso ao número.
-- open:    aceito por `assigned_to` — visível só para ele (e admin/gerente/financeiro).
-- closed:  atendimento encerrado — some das listas até o cliente responder de novo,
--          quando volta para `pending` com `assigned_to = NULL`.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'open', 'closed'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_status
  ON public.whatsapp_conversations (status);

-- Backfill: conversas já atribuídas continuam "ativas"; o resto entra na fila.
UPDATE public.whatsapp_conversations
SET status = 'open'
WHERE assigned_to IS NOT NULL;

-- Reabre conversas fechadas quando o cliente escreve de novo, devolvendo à fila.
CREATE OR REPLACE FUNCTION public.on_whatsapp_message_insert_sync_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preview text;
BEGIN
  v_preview := public._whatsapp_message_preview(NEW);

  UPDATE public.whatsapp_conversations
  SET
    last_message_at = NEW.created_at,
    last_preview = v_preview,
    last_message_direction = NEW.direction,
    unread_count = CASE
      WHEN NEW.direction = 'in' THEN unread_count + 1
      ELSE unread_count
    END,
    status = CASE
      WHEN NEW.direction = 'in' AND status = 'closed' THEN 'pending'
      ELSE status
    END,
    assigned_to = CASE
      WHEN NEW.direction = 'in' AND status = 'closed' THEN NULL
      ELSE assigned_to
    END,
    updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

-- RLS: além do acesso ao número, conversas "open"/"closed" só ficam visíveis
-- para quem está atribuído (admin/gerente/financeiro continuam vendo tudo).
DROP POLICY IF EXISTS "Staff read whatsapp_conversations" ON public.whatsapp_conversations;

CREATE POLICY "Staff read whatsapp_conversations"
  ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
    OR (
      instance_id IS NOT NULL
      AND public.user_has_whatsapp_inbox_access(instance_id)
      AND (status = 'pending' OR assigned_to = auth.uid())
    )
  );

-- Lista de conversas do inbox com status + nome do responsável.
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
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
    OR (
      c.instance_id IS NOT NULL
      AND public.user_has_whatsapp_inbox_access(c.instance_id)
      AND (c.status = 'pending' OR c.assigned_to = auth.uid())
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;

REVOKE ALL ON FUNCTION public.list_whatsapp_inbox_conversations(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_inbox_conversations(int) TO authenticated;

-- Aceitar: tira da fila de pendentes e atribui ao usuário atual.
CREATE OR REPLACE FUNCTION public.accept_whatsapp_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
BEGIN
  SELECT instance_id INTO v_instance_id
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT public.user_has_whatsapp_inbox_access(v_instance_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'open', assigned_to = auth.uid(), updated_at = now()
  WHERE id = p_conversation_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa já foi aceita por outro atendente';
  END IF;
END;
$$;

-- Fechar: encerra o atendimento (volta para pendente se o cliente responder de novo).
CREATE OR REPLACE FUNCTION public.close_whatsapp_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_to uuid;
BEGIN
  SELECT assigned_to INTO v_assigned_to
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT (
    v_assigned_to = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para encerrar esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'closed', updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

-- Transferir: reatribui a conversa para outro usuário com acesso ao número.
CREATE OR REPLACE FUNCTION public.transfer_whatsapp_conversation(p_conversation_id uuid, p_to_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
  v_assigned_to uuid;
  v_target_has_access boolean;
BEGIN
  SELECT instance_id, assigned_to INTO v_instance_id, v_assigned_to
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT (
    v_assigned_to = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para transferir esta conversa';
  END IF;

  v_target_has_access :=
    has_role(p_to_user_id, 'admin'::app_role)
    OR has_role(p_to_user_id, 'gerente'::app_role)
    OR has_role(p_to_user_id, 'financeiro'::app_role)
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

-- Lista usuários que podem atender um número (para o seletor de Transferir).
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
      EXISTS (
        SELECT 1 FROM public.whatsapp_instance_assignments a
        WHERE a.user_id = p.user_id AND a.instance_id = p_instance_id
      )
      OR has_role(p.user_id, 'admin'::app_role)
      OR has_role(p.user_id, 'gerente'::app_role)
      OR has_role(p.user_id, 'financeiro'::app_role)
    )
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

REVOKE ALL ON FUNCTION public.accept_whatsapp_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_whatsapp_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_whatsapp_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_whatsapp_inbox_assignable_users(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.accept_whatsapp_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_whatsapp_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_whatsapp_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_inbox_assignable_users(uuid) TO authenticated;

COMMENT ON COLUMN public.whatsapp_conversations.status IS
  'pending = aguardando atendimento (visível a todos com acesso ao número); open = aceito por assigned_to; closed = encerrado (volta a pending se o cliente responder).';
