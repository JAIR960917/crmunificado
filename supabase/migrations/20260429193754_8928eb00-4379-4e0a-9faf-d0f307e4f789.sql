-- Remove duplicatas dos campos de Nome, Telefone e Data da última consulta,
-- mantendo apenas o registro mais antigo de cada um. Antes de deletar, qualquer
-- campo filho (parent_field_id) é re-apontado para o registro que será mantido.

DO $$
DECLARE
  keep_name_id   UUID;
  keep_phone_id  UUID;
  keep_visit_id  UUID;
BEGIN
  -- 1) Identifica o registro a manter (mais antigo) para cada flag
  SELECT id INTO keep_name_id
  FROM public.crm_renovacao_form_fields
  WHERE is_name_field = true
  ORDER BY created_at ASC, position ASC
  LIMIT 1;

  SELECT id INTO keep_phone_id
  FROM public.crm_renovacao_form_fields
  WHERE is_phone_field = true
  ORDER BY created_at ASC, position ASC
  LIMIT 1;

  SELECT id INTO keep_visit_id
  FROM public.crm_renovacao_form_fields
  WHERE is_last_visit_field = true
  ORDER BY created_at ASC, position ASC
  LIMIT 1;

  -- 2) Reaponta filhos que apontavam para duplicatas para os registros mantidos
  IF keep_name_id IS NOT NULL THEN
    UPDATE public.crm_renovacao_form_fields
    SET parent_field_id = keep_name_id
    WHERE parent_field_id IN (
      SELECT id FROM public.crm_renovacao_form_fields
      WHERE is_name_field = true AND id <> keep_name_id
    );
  END IF;

  IF keep_phone_id IS NOT NULL THEN
    UPDATE public.crm_renovacao_form_fields
    SET parent_field_id = keep_phone_id
    WHERE parent_field_id IN (
      SELECT id FROM public.crm_renovacao_form_fields
      WHERE is_phone_field = true AND id <> keep_phone_id
    );
  END IF;

  IF keep_visit_id IS NOT NULL THEN
    UPDATE public.crm_renovacao_form_fields
    SET parent_field_id = keep_visit_id
    WHERE parent_field_id IN (
      SELECT id FROM public.crm_renovacao_form_fields
      WHERE is_last_visit_field = true AND id <> keep_visit_id
    );
  END IF;

  -- 3) Apaga as duplicatas
  IF keep_name_id IS NOT NULL THEN
    DELETE FROM public.crm_renovacao_form_fields
    WHERE is_name_field = true AND id <> keep_name_id;
  END IF;

  IF keep_phone_id IS NOT NULL THEN
    DELETE FROM public.crm_renovacao_form_fields
    WHERE is_phone_field = true AND id <> keep_phone_id;
  END IF;

  IF keep_visit_id IS NOT NULL THEN
    DELETE FROM public.crm_renovacao_form_fields
    WHERE is_last_visit_field = true AND id <> keep_visit_id;
  END IF;
END $$;