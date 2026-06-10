-- Permite exibir subperguntas condicionais no final do formulário (mantendo a condicional).
ALTER TABLE public.crm_form_fields
  ADD COLUMN IF NOT EXISTS show_at_end boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_renovacao_form_fields
  ADD COLUMN IF NOT EXISTS show_at_end boolean NOT NULL DEFAULT false;

-- Campos de telefone costumam ir ao final mesmo sendo condicionais.
UPDATE public.crm_form_fields
SET show_at_end = true
WHERE is_phone_field = true;

UPDATE public.crm_renovacao_form_fields
SET show_at_end = true
WHERE is_phone_field = true;
