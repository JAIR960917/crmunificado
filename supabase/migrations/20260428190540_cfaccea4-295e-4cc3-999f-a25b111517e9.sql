UPDATE public.crm_cobrancas
SET status = '31_dias_de_atraso_ligao',
    updated_at = now()
WHERE status = '45_dias_de_atrasomensagem_automtica';