-- Permite gerenciar acesso à tela Inbox WhatsApp (demo) em Funções e Permissões.

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT DISTINCT rp.role_key, 'whatsapp_inbox_demo', (rp.role_key = 'admin')
FROM public.role_page_permissions rp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.role_page_permissions x
  WHERE x.role_key = rp.role_key
    AND x.page_key = 'whatsapp_inbox_demo'
);
