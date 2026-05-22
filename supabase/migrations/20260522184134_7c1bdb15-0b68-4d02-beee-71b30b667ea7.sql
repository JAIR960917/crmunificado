ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS nao_vendido_motivo text,
  ADD COLUMN IF NOT EXISTS fez_orcamento boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orcamento_valor numeric,
  ADD COLUMN IF NOT EXISTS orcamento_produtos text,
  ADD COLUMN IF NOT EXISTS orcamento_observacao text;

CREATE INDEX IF NOT EXISTS idx_crm_appointments_fez_orcamento
  ON public.crm_appointments (fez_orcamento)
  WHERE fez_orcamento = true;

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT 'admin', 'page_orcamentos', true
WHERE NOT EXISTS (SELECT 1 FROM public.role_page_permissions WHERE role_key='admin' AND page_key='page_orcamentos');

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT 'gerente', 'page_orcamentos', true
WHERE NOT EXISTS (SELECT 1 FROM public.role_page_permissions WHERE role_key='gerente' AND page_key='page_orcamentos');

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT 'vendedor', 'page_orcamentos', true
WHERE NOT EXISTS (SELECT 1 FROM public.role_page_permissions WHERE role_key='vendedor' AND page_key='page_orcamentos');