INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT DISTINCT role_key, 'meu_dashboard', true
FROM public.role_page_permissions
WHERE role_key IS NOT NULL
ON CONFLICT (role_key, page_key) DO NOTHING;