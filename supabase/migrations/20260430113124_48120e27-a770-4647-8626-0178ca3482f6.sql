-- Remove duplicates keeping the oldest row per key
DELETE FROM public.crm_renovacao_statuses a
USING public.crm_renovacao_statuses b
WHERE a.key = b.key
  AND a.created_at > b.created_at;

-- Add unique constraint on key (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_renovacao_statuses_key_unique'
  ) THEN
    ALTER TABLE public.crm_renovacao_statuses
      ADD CONSTRAINT crm_renovacao_statuses_key_unique UNIQUE (key);
  END IF;
END $$;