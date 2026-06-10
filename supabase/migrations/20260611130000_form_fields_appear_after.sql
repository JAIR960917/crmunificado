-- Permite posicionar subperguntas condicionais após uma pergunta específica no fluxo.
ALTER TABLE public.crm_form_fields
  ADD COLUMN IF NOT EXISTS appear_after_field_id uuid REFERENCES public.crm_form_fields(id) ON DELETE SET NULL;

ALTER TABLE public.crm_renovacao_form_fields
  ADD COLUMN IF NOT EXISTS appear_after_field_id uuid REFERENCES public.crm_renovacao_form_fields(id) ON DELETE SET NULL;

-- Telefone condicional: deixa de ir ao final quando houver âncora explícita (configurada no builder).
UPDATE public.crm_form_fields
SET show_at_end = false
WHERE is_phone_field = true AND show_at_end = true;

UPDATE public.crm_renovacao_form_fields
SET show_at_end = false
WHERE is_phone_field = true AND show_at_end = true;
