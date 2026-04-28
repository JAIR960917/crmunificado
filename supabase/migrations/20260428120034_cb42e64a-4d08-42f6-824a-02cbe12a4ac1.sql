-- Agenda backfill para lojas que ainda estão idle (chunk 0/16) sem next_run_at definido.
-- Escalonado a cada 30min para evitar rate limit da API SSótica.
WITH lojas_pendentes AS (
  SELECT i.id,
         row_number() OVER (ORDER BY c.name) - 1 AS pos
  FROM public.ssotica_integrations i
  JOIN public.companies c ON c.id = i.company_id
  WHERE i.is_active
    AND i.backfill_status = 'idle'
    AND i.backfill_chunk_index = 0
    AND i.backfill_next_run_at IS NULL
)
UPDATE public.ssotica_integrations i
SET backfill_status = 'scheduled',
    backfill_next_run_at = now() + (lp.pos * interval '30 minutes'),
    backfill_started_at = COALESCE(i.backfill_started_at, now()),
    updated_at = now()
FROM lojas_pendentes lp
WHERE i.id = lp.id;