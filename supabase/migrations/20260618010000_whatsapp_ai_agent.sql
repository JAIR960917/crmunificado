-- ============================================================
-- Agente de IA (n8n) no Inbox WhatsApp.
--
-- ai_enabled / ai_webhook_url / ai_webhook_secret (whatsapp_instances):
--   configurado pelo admin por NUMERO. Quando ai_enabled = true, mensagens
--   recebidas nesse numero sao encaminhadas para ai_webhook_url (workflow
--   n8n), que processa com IA e chama de volta a function ai-agent-reply
--   (autenticada com ai_webhook_secret) para enviar a resposta.
--
-- ai_active (whatsapp_conversations):
--   por conversa. Comeca true (IA responde). Quando um atendente ACEITA a
--   conversa, vira false (IA para). O atendente pode reativar manualmente.
-- ============================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_webhook_url text,
  ADD COLUMN IF NOT EXISTS ai_webhook_secret text;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ai_active boolean NOT NULL DEFAULT true;

-- Aceitar conversa: alem do fluxo normal, desativa a IA para esse contato.
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
  SET status = 'open', assigned_to = auth.uid(), ai_active = false, updated_at = now()
  WHERE id = p_conversation_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa já foi aceita por outro atendente';
  END IF;
END;
$$;

-- Liga/desliga manualmente a IA numa conversa (botao "Reativar IA" / "Pausar IA").
CREATE OR REPLACE FUNCTION public.set_whatsapp_conversation_ai_active(
  p_conversation_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
  v_assigned_to uuid;
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
    OR public.user_has_whatsapp_inbox_access(v_instance_id)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET ai_active = p_active, updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_whatsapp_conversation_ai_active(uuid, boolean) TO authenticated;

-- Lista de conversas do inbox: agora inclui ai_active e se o numero tem IA habilitada.
DROP FUNCTION IF EXISTS public.list_whatsapp_inbox_conversations(int);

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
  status text,
  ai_active boolean,
  ai_enabled boolean
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
    c.status,
    c.ai_active,
    COALESCE(i.ai_enabled, false) AS ai_enabled
  FROM public.whatsapp_conversations c
  LEFT JOIN LATERAL (
    SELECT m.direction, m.created_at
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = c.id
    ORDER BY m.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN public.profiles p ON p.user_id = c.assigned_to
  LEFT JOIN public.whatsapp_instances i ON i.id = c.instance_id
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
