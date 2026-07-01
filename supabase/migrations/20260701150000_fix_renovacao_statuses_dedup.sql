-- Remove linhas duplicadas de crm_renovacao_statuses, mantendo a mais antiga (ctid menor)
-- para cada key. Pode acontecer quando a VPS roda o deploy.sh múltiplas vezes.
DELETE FROM public.crm_renovacao_statuses a
USING public.crm_renovacao_statuses b
WHERE a.key = b.key AND a.ctid > b.ctid;

-- Garante que nunca mais haja duplicatas
ALTER TABLE public.crm_renovacao_statuses
  ADD CONSTRAINT crm_renovacao_statuses_key_unique UNIQUE (key);
