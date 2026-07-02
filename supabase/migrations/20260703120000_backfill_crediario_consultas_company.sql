-- crediario_consultas nunca gravava company_id (bug no consulta-cpf), então
-- todo o histórico aparecia como "Sem empresa" no Relatório de Uso. Preenche
-- retroativamente usando o company_id atual do perfil de quem fez a consulta
-- (melhor aproximação disponível — não sabemos qual era a empresa do usuário
-- no momento exato da consulta, só a atual).

UPDATE public.crediario_consultas c
SET company_id = p.company_id
FROM public.profiles p
WHERE c.user_id = p.user_id
  AND c.company_id IS NULL
  AND p.company_id IS NOT NULL;

-- Mesma lacuna pode ocorrer nas consultas de Pagamento na Entrega/Renegociação
-- (ex.: quando quem consultou não tinha company_id no perfil no momento).
UPDATE public.crediario_consultas_pg_entrega c
SET company_id = p.company_id
FROM public.profiles p
WHERE c.user_id = p.user_id
  AND c.company_id IS NULL
  AND p.company_id IS NOT NULL;

UPDATE public.crediario_consultas_renegociacao c
SET company_id = p.company_id
FROM public.profiles p
WHERE c.user_id = p.user_id
  AND c.company_id IS NULL
  AND p.company_id IS NOT NULL;
