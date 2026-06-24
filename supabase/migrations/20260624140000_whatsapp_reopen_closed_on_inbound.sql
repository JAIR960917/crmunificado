-- Inbox WhatsApp: cliente volta a falar numa conversa já ENCERRADA (sem
-- atendente ativo) deve voltar pra fila de Pendentes, pra qualquer usuário
-- da empresa daquele número poder aceitar — em vez de ficar presa em
-- "closed" pra sempre (a função só atualizava preview/last_message_at,
-- nunca o status).
--
-- Conversas "open" (já com alguém atendendo) NÃO são afetadas — continuam
-- com o mesmo atendente, só uma conversa SEM dono ativo (closed) é reaberta.

DROP FUNCTION IF EXISTS public.apply_whatsapp_conversation_message_meta(
  uuid, text, timestamptz, text, text, timestamptz, text, uuid, boolean
);

CREATE OR REPLACE FUNCTION public.apply_whatsapp_conversation_message_meta(
  p_conversation_id uuid,
  p_preview text,
  p_last_message_at timestamptz,
  p_phone_display text,
  p_wa_id text,
  p_window_expires_at timestamptz DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL,
  p_increment_unread boolean DEFAULT false,
  p_is_inbound boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_conversations
  SET
    last_message_at = p_last_message_at,
    last_preview = left(coalesce(p_preview, ''), 200),
    phone_display = p_phone_display,
    wa_id = p_wa_id,
    window_expires_at = COALESCE(p_window_expires_at, window_expires_at),
    contact_name = COALESCE(nullif(trim(p_contact_name), ''), contact_name),
    instance_id = COALESCE(p_instance_id, instance_id),
    unread_count = CASE
      WHEN p_increment_unread THEN unread_count + 1
      ELSE unread_count
    END,
    status = CASE
      WHEN p_is_inbound AND status = 'closed' THEN 'pending'
      ELSE status
    END,
    assigned_to = CASE
      WHEN p_is_inbound AND status = 'closed' THEN NULL
      ELSE assigned_to
    END,
    routed_to_company_id = CASE
      WHEN p_is_inbound AND status = 'closed' THEN NULL
      ELSE routed_to_company_id
    END,
    updated_at = now()
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_whatsapp_conversation_message_meta(
  uuid, text, timestamptz, text, text, timestamptz, text, uuid, boolean, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_whatsapp_conversation_message_meta(
  uuid, text, timestamptz, text, text, timestamptz, text, uuid, boolean, boolean
) TO service_role;

NOTIFY pgrst, 'reload schema';
