-- Libera a tela de Tarefas para vendedor, gerente e funções customizadas com base nesses papéis.

UPDATE public.role_page_permissions rpp
SET allowed = true
FROM public.role_definitions rd
WHERE rpp.role_key = rd.key
  AND rpp.page_key = 'tarefas_crediario'
  AND (
    rd.key IN ('vendedor', 'gerente')
    OR rd.base_role IN ('vendedor'::app_role, 'gerente'::app_role)
  );
