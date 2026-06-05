-- Garante permissão "Tarefas Crediário" para todas as funções (nativas e customizadas).

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT rd.key, 'tarefas_crediario', false
FROM public.role_definitions rd
WHERE NOT EXISTS (
  SELECT 1
  FROM public.role_page_permissions x
  WHERE x.role_key = rd.key
    AND x.page_key = 'tarefas_crediario'
);

-- Admin, financeiro nativo e funções customizadas com base financeiro: liberado por padrão.
UPDATE public.role_page_permissions rpp
SET allowed = true
FROM public.role_definitions rd
WHERE rpp.role_key = rd.key
  AND rpp.page_key = 'tarefas_crediario'
  AND (
    rd.key IN ('admin', 'financeiro')
    OR rd.base_role = 'financeiro'::app_role
  );
