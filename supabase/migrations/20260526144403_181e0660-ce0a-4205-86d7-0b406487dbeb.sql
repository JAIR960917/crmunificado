
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

  RETURN jsonb_build_object('leads', _leads, 'cobrancas', _cob, 'renovacoes', _ren);
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_whatsapp_errors() TO authenticated;
