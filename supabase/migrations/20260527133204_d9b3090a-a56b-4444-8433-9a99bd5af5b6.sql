ALTER TABLE public.whatsapp_trigger_sends
  ADD COLUMN IF NOT EXISTS status_entered_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_trigger_sends_claim_once_idx
  ON public.whatsapp_trigger_sends (campaign_id, step_id, lead_id, status_entered_at);

CREATE OR REPLACE FUNCTION public.claim_whatsapp_trigger_send(
  p_campaign_id uuid,
  p_step_id uuid,
  p_lead_id uuid,
  p_phone text,
  p_status_entered_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.whatsapp_trigger_sends (
    campaign_id,
    step_id,
    lead_id,
    phone,
    status,
    status_entered_at
  ) VALUES (
    p_campaign_id,
    p_step_id,
    p_lead_id,
    p_phone,
    'pending',
    p_status_entered_at
  )
  ON CONFLICT (campaign_id, step_id, lead_id, status_entered_at) DO NOTHING;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_trigger_send_sent(
  p_campaign_id uuid,
  p_step_id uuid,
  p_lead_id uuid,
  p_status_entered_at timestamptz,
  p_sent_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_trigger_sends
     SET status = 'sent',
         sent_at = p_sent_at,
         error_message = NULL
   WHERE campaign_id = p_campaign_id
     AND step_id = p_step_id
     AND lead_id = p_lead_id
     AND status_entered_at = p_status_entered_at;
$$;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_trigger_send_error(
  p_campaign_id uuid,
  p_step_id uuid,
  p_lead_id uuid,
  p_status_entered_at timestamptz,
  p_error_message text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_trigger_sends
     SET status = 'error',
         error_message = p_error_message,
         sent_at = NULL
   WHERE campaign_id = p_campaign_id
     AND step_id = p_step_id
     AND lead_id = p_lead_id
     AND status_entered_at = p_status_entered_at;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_whatsapp_trigger_send(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_whatsapp_trigger_send_sent(uuid, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_whatsapp_trigger_send_error(uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_trigger_send(uuid, uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_trigger_send_sent(uuid, uuid, uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_trigger_send_error(uuid, uuid, uuid, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public._reset_gatilho_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.data := (COALESCE(NEW.data, '{}'::jsonb))
      - 'gatilho_enviado_em'
      - 'gatilho_status_key'
      - 'gatilho_campaign_id'
      - 'gatilho_campaign_name'
      - 'status_entered_at'
      - 'status_entered_status_key'
      - 'gatilho_processando_em'
      - 'gatilho_processando_status_key';
    NEW.data := jsonb_set(NEW.data, '{status_entered_at}', to_jsonb(now()), true);
    NEW.data := jsonb_set(NEW.data, '{status_entered_status_key}', to_jsonb(NEW.status), true);
  END IF;
  RETURN NEW;
END;
$$;