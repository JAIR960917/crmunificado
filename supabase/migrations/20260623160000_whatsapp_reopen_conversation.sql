-- Permite reabrir uma conversa ENCERRADA (status='closed') sem esperar o
-- cliente mandar outra mensagem — só quem fechou (ou admin) pode reabrir, e
-- só enquanto ela ainda existir (o frontend só mostra o botão dentro da
-- janela de 24h, mas a regra de negócio aqui é simples: dono original ou
-- admin podem retomar o atendimento quando quiserem).
CREATE OR REPLACE FUNCTION public.reopen_whatsapp_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_to uuid;
  v_status text;
BEGIN
  SELECT assigned_to, status INTO v_assigned_to, v_status
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF v_status <> 'closed' THEN
    RAISE EXCEPTION 'Esta conversa não está encerrada';
  END IF;

  IF NOT (
    v_assigned_to = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reabrir esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET status = 'open', assigned_to = auth.uid(), updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_whatsapp_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_whatsapp_conversation(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
