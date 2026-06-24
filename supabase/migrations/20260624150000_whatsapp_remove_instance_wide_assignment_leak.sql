-- Inbox WhatsApp: remove vazamento de acesso por "já fui responsável por
-- UMA conversa nessa instância alguma vez".
--
-- user_has_whatsapp_inbox_access() tinha uma 3ª cláusula:
--   EXISTS (SELECT 1 FROM whatsapp_conversations c
--           WHERE c.instance_id = p_instance_id AND c.assigned_to = auth.uid())
-- pensada para cobrir handoff entre empresas (após uma transferência, o novo
-- responsável continua enxergando a conversa). Na prática isso libera acesso
-- à INSTÂNCIA INTEIRA (todas as pendentes daquele número) pra qualquer
-- usuário que JÁ teve qualquer conversa atribuída ali — mesmo fechada, mesmo
-- de anos atrás, mesmo depois de mudar de empresa. Foi assim que um usuário
-- da empresa Marketing (sem nenhum vínculo com Cobrança) ficou vendo a fila
-- de pendentes inteira da Cobrança: bastou ele ter aceitado UMA conversa lá
-- no passado.
--
-- O acesso à conversa ESPECÍFICA que está (ou esteve) atribuída ao usuário
-- já é garantido separadamente por "assigned_to = auth.uid()" na policy/RPC
-- de listagem e em whatsapp-chat — essa cláusula aqui é redundante para esse
-- caso e só serve pra vazar acesso à instância inteira. Removida.

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
  END;
$$;

NOTIFY pgrst, 'reload schema';
