ALTER TABLE public.ssotica_integrations
ADD COLUMN IF NOT EXISTS backfill_phase text NOT NULL DEFAULT 'cr';