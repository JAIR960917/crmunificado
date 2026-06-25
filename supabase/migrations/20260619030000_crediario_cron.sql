-- Cron do Crediário: gera o relatório diário de pagamentos e sincroniza
-- boletos pagos no Cora periodicamente. Mesmo padrão de manage_ssotica_cron()
-- e manage_whatsapp_cron() já existentes — usa pg_cron + pg_net para chamar
-- as edge functions com o CRON_SECRET configurado em system_settings.
CREATE OR REPLACE FUNCTION public.manage_crediario_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _base_url text;
  _service_key text;
  _cron_secret text;
  _job_command text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar o cron do Crediário';
  END IF;

  _base_url := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    (SELECT setting_value FROM public.system_settings WHERE setting_key = 'backend_public_url' LIMIT 1)
  );
  _service_key := COALESCE(
    NULLIF(current_setting('app.settings.supabase_service_role_key', true), ''),
    (SELECT setting_value FROM public.system_settings WHERE setting_key = 'backend_service_role_key' LIMIT 1)
  );
  _cron_secret := (
    SELECT setting_value FROM public.system_settings WHERE setting_key = 'backend_cron_secret' LIMIT 1
  );

  BEGIN PERFORM cron.unschedule('crediario-relatorio-diario'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('crediario-cora-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;

  IF _base_url IS NULL OR _service_key IS NULL OR _cron_secret IS NULL THEN
    RAISE NOTICE 'backend_public_url, backend_service_role_key ou backend_cron_secret ausentes; cron do crediário não agendado';
    RETURN;
  END IF;

  -- Gera o relatório diário de pagamentos uma vez por dia, às 23:50.
  _job_command := format(
    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
    _base_url || '/functions/v1/gerar-relatorio-diario',
    json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key,
      'x-cron-secret', _cron_secret
    )::text,
    json_build_object('modo', 'pendentes')::text
  );
  PERFORM cron.schedule('crediario-relatorio-diario', '50 23 * * *', _job_command);

  -- Sincroniza status de boletos pagos no Cora a cada hora.
  _job_command := format(
    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
    _base_url || '/functions/v1/cora-sincronizar-agendado',
    json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key,
      'x-cron-secret', _cron_secret
    )::text,
    '{}'::text
  );
  PERFORM cron.schedule('crediario-cora-sync', '0 * * * *', _job_command);
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_crediario_cron() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_crediario_cron() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_crediario_cron() TO service_role;

-- Tenta ativar agora; se os secrets de backend ainda não estiverem
-- configurados, apenas RAISE NOTICE e não agenda nada (deploy.sh reexecuta
-- depois que system_settings tiver os valores).
SELECT public.manage_crediario_cron();
