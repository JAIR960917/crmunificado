ALTER TABLE public.whatsapp_trigger_sends
  DROP CONSTRAINT IF EXISTS whatsapp_trigger_sends_lead_id_fkey;

ALTER TABLE public.whatsapp_campaign_sends
  DROP CONSTRAINT IF EXISTS whatsapp_campaign_sends_lead_id_fkey;