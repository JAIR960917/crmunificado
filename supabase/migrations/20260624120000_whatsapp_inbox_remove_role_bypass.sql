-- Remove o bypass de "gerente/financeiro vê tudo" no inbox do WhatsApp.
--
-- A migration 20260623130000 (feature de "encaminhar para empresa") adicionou
-- has_role(... 'gerente') / has_role(... 'financeiro') como condição extra de
-- visibilidade nas policies de whatsapp_conversations/whatsapp_messages e na
-- RPC list_whatsapp_inbox_conversations. Isso dá acesso GLOBAL a qualquer
-- conversa de QUALQUER empresa/instância pra todo usuário com papel gerente
-- ou financeiro — inclusive instâncias de Marketing sem relação com Cobrança.
--
-- O controle por empresa já existe e é suficiente via
-- user_has_whatsapp_inbox_access (empresa da instância) e
-- can_act_on_pending_conversation (empresa de roteamento), então o bypass por
-- papel é removido: volta a valer só admin (acesso global), dono atual
-- (assigned_to), ou pendente que o usuário pode agir (mesma empresa da
-- instância ou empresa de destino do roteamento).

DROP POLICY IF EXISTS "Staff read whatsapp_conversations" ON public.whatsapp_conversations;

CREATE POLICY "Staff read whatsapp_conversations"
  ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR assigned_to = auth.uid()
    OR (status = 'pending' AND public.can_act_on_pending_conversation(id))
  );

DROP POLICY IF EXISTS "Staff read whatsapp_messages" ON public.whatsapp_messages;

CREATE POLICY "Staff read whatsapp_messages"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      WHERE c.id = whatsapp_messages.conversation_id
        AND (
          c.assigned_to = auth.uid()
          OR (c.status = 'pending' AND public.can_act_on_pending_conversation(c.id))
        )
    )
  );

-- Mesmo filtro na RPC de listagem (colunas inalteradas — não precisa DROP).
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
  ai_enabled boolean,
  routed_to_company_id uuid
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
    COALESCE(i.ai_enabled, false) AS ai_enabled,
    c.routed_to_company_id
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
    OR c.assigned_to = auth.uid()
    OR (c.status = 'pending' AND public.can_act_on_pending_conversation(c.id))
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;

REVOKE ALL ON FUNCTION public.list_whatsapp_inbox_conversations(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_whatsapp_inbox_conversations(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
