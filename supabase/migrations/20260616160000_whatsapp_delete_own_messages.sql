-- Permite que cada atendente exclua mensagens que ele mesmo enviou.
-- Gerentes podem excluir qualquer mensagem de saída (para correção de erros da equipe).
-- Admins já possuem acesso total via policy existente.
CREATE POLICY "Staff delete own whatsapp_messages"
  ON public.whatsapp_messages FOR DELETE TO authenticated
  USING (
    sent_by = auth.uid()
    OR has_role(auth.uid(), 'gerente'::app_role)
  );
