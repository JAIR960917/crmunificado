ALTER TABLE public.ssotica_integrations
  ADD COLUMN IF NOT EXISTS backfill_scope text NOT NULL DEFAULT 'all';