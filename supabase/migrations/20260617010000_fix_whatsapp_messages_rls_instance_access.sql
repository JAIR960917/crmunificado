-- ==========================================================
-- Corrige RLS de whatsapp_messages: a politica de SELECT criada em
-- 20260617000000_security_rls_fixes.sql verificava apenas a empresa
-- (is_my_company), sem checar se o usuario tem acesso ao numero/instancia
-- (user_has_whatsapp_inbox_access), como a politica de whatsapp_conversations
-- ja fazia. Resultado: usuarios nao-admin viam a conversa na lista mas a
-- query de mensagens retornava vazio.
-- ==========================================================

DROP POLICY IF EXISTS "Staff read whatsapp_messages" ON public.whatsapp_messages;

CREATE POLICY "Staff read whatsapp_messages"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      JOIN public.whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id = whatsapp_messages.conversation_id
        AND public.is_my_company(i.company_id)
        AND public.user_has_whatsapp_inbox_access(c.instance_id)
    )
  );
