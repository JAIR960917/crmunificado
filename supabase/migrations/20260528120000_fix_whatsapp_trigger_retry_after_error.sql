-- Permite reenvio de gatilhos após falha (ex.: restrição/desconexão da API Full).
-- Antes: INSERT ON CONFLICT DO NOTHING bloqueava novas tentativas quando já existia linha com status=error.

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
DECLARE
  _reclaimed int;
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

  IF FOUND THEN
    RETURN true;
  END IF;

  -- Reenvio: libera tentativa se a anterior falhou ou ficou pendente travada
  UPDATE public.whatsapp_trigger_sends
     SET status = 'pending',
         error_message = NULL,
         sent_at = NULL,
         phone = p_phone
   WHERE campaign_id = p_campaign_id
     AND step_id = p_step_id
     AND lead_id = p_lead_id
     AND status_entered_at = p_status_entered_at
     AND status IN ('error', 'pending');

  GET DIAGNOSTICS _reclaimed = ROW_COUNT;
  IF _reclaimed > 0 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Botão "Reenviar gatilhos com erro" também limpa histórico de falha no whatsapp_trigger_sends
CREATE OR REPLACE FUNCTION public.retry_whatsapp_errors()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _leads int := 0;
  _cob int := 0;
  _ren int := 0;
  _trigger_sends int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta ação';
  END IF;

  WITH u AS (
    UPDATE public.crm_leads
    SET data = data
      - 'envio_erro' - 'envio_erro_em' - 'envio_erro_campaign_id' - 'envio_erro_campaign_name'
      - 'gatilho_enviado_em' - 'gatilho_status_key' - 'gatilho_campaign_id' - 'gatilho_campaign_name',
        updated_at = now()
    WHERE data->>'envio_erro' IS NOT NULL
    RETURNING 1
  ) SELECT count(*) INTO _leads FROM u;

  WITH u AS (
    UPDATE public.crm_cobrancas
    SET data = data
      - 'envio_erro' - 'envio_erro_em' - 'envio_erro_campaign_id' - 'envio_erro_campaign_name'
      - 'gatilho_enviado_em' - 'gatilho_status_key' - 'gatilho_campaign_id' - 'gatilho_campaign_name',
        updated_at = now()
    WHERE data->>'envio_erro' IS NOT NULL
    RETURNING 1
  ) SELECT count(*) INTO _cob FROM u;

  WITH u AS (
    UPDATE public.crm_renovacoes
    SET data = data
      - 'envio_erro' - 'envio_erro_em' - 'envio_erro_campaign_id' - 'envio_erro_campaign_name'
      - 'gatilho_enviado_em' - 'gatilho_status_key' - 'gatilho_campaign_id' - 'gatilho_campaign_name',
        updated_at = now()
    WHERE data->>'envio_erro' IS NOT NULL
    RETURNING 1
  ) SELECT count(*) INTO _ren FROM u;

  WITH d AS (
    DELETE FROM public.whatsapp_trigger_sends
    WHERE status = 'error'
    RETURNING 1
  ) SELECT count(*) INTO _trigger_sends FROM d;

  RETURN jsonb_build_object(
    'leads', _leads,
    'cobrancas', _cob,
    'renovacoes', _ren,
    'trigger_sends_cleared', _trigger_sends
  );
END;
$$;
