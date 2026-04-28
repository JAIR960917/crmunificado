DELETE FROM public.crm_cobrancas c
WHERE c.status = 'pendente'
  AND c.dias_atraso <= -2
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(c.data->'parcelas_atrasadas', '[]'::jsonb)) p
    WHERE (p->>'dias_atraso')::int >= -1
  );