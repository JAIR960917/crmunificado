-- Leads da Campanha Copa já vinham com a data do último exame de vista
-- preenchida, mas o campo "Já fez exame de vista?" (Sim/Não) ficava vazio —
-- como o campo de data só aparece na tela quando esse campo está "Sim", a
-- data ficava escondida mesmo já estando salva. Marca "Sim" para os leads
-- da Copa que já têm a data preenchida.
DO $$
DECLARE
  field_id uuid;
  field_options jsonb;
  sim_value text;
BEGIN
  SELECT id, options INTO field_id, field_options
  FROM public.crm_form_fields
  WHERE label ~* 'j[áa]\s+fez\s+exame\s+de\s+vista'
  LIMIT 1;

  IF field_id IS NOT NULL THEN
    SELECT value INTO sim_value
    FROM jsonb_array_elements_text(COALESCE(field_options, '[]'::jsonb)) AS value
    WHERE lower(btrim(value)) = 'sim'
    LIMIT 1;
    sim_value := COALESCE(sim_value, 'Sim');

    UPDATE public.crm_leads
    SET data = data || jsonb_build_object('field_' || field_id::text, to_jsonb(sim_value))
    WHERE data->>'origem_campanha' = 'copa'
      AND COALESCE(data->>'ultimo_exame_vista_data', '') <> '';
  END IF;
END $$;
