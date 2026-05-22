ALTER TABLE public.whatsapp_trigger_campaigns
ADD COLUMN IF NOT EXISTS instance_ids jsonb NOT NULL DEFAULT '[]'::jsonb;