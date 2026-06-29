-- A data do "último exame de vista" dos leads da Campanha Copa era calculada
-- com datas fixas (ex.: "Menos de 6 meses" -> sempre 2026-02-01), que saem da
-- faixa correta conforme o tempo passa. Recalcula para uma data aleatória
-- dentro da faixa certa, relativa a hoje, para os leads já existentes.
DO $$
DECLARE
  field_id uuid;
BEGIN
  SELECT id INTO field_id FROM public.crm_form_fields WHERE is_last_visit_field = true LIMIT 1;
  IF field_id IS NULL THEN
    SELECT id INTO field_id FROM public.crm_form_fields
    WHERE field_type = 'date'
      AND label ~* 'exame de vista|último exame|ultimo exame|última consulta|ultima consulta'
    LIMIT 1;
  END IF;

  UPDATE public.crm_leads AS l
  SET data = l.data
    || jsonb_build_object('ultimo_exame_vista_data', to_jsonb(u.new_date::text))
    || CASE WHEN field_id IS NOT NULL
         THEN jsonb_build_object('field_' || field_id::text, to_jsonb(u.new_date::text))
         ELSE '{}'::jsonb
       END
  FROM (
    SELECT
      cl.id,
      (current_date - (r.min_days + floor(random() * (r.max_days - r.min_days + 1)))::int) AS new_date
    FROM public.crm_leads cl
    JOIN (VALUES
      ('Menos de 6 meses', 1, 180),
      ('6 meses a 1 ano', 181, 365),
      ('1 a 2 anos', 366, 730),
      ('Mais de 2 anos', 731, 1825)
    ) AS r(opcao, min_days, max_days) ON r.opcao = cl.data->>'ultimo_exame_vista'
    WHERE cl.data->>'origem_campanha' = 'copa'
  ) AS u
  WHERE l.id = u.id;
END $$;
