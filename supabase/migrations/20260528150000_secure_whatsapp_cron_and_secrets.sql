-- Cron WhatsApp: só admin reagenda; job usa service_role + CRON_SECRET (não anon).

CREATE OR REPLACE FUNCTION public.manage_whatsapp_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _interval_minutes int;
  _cron_expression text;
  _job_command text;
  _base_url text;
  _service_key text;
  _cron_secret text;
BEGIN
  -- Bloqueia usuários autentados não-admin; permite deploy/migrations (auth.uid() nulo).
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem gerenciar o cron de WhatsApp';
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

  IF _base_url IS NULL OR _service_key IS NULL OR _cron_secret IS NULL THEN
    RAISE NOTICE 'backend_public_url, backend_service_role_key ou backend_cron_secret ausentes; cron whatsapp não agendado';
    RETURN;
  END IF;

  SELECT COALESCE(setting_value, '5')::int INTO _interval_minutes
  FROM public.system_settings
  WHERE setting_key = 'whatsapp_cron_interval';

  IF _interval_minutes IS NULL OR _interval_minutes < 1 THEN
    _interval_minutes := 5;
  END IF;

  _cron_expression := '*/' || _interval_minutes || ' * * * *';

  BEGIN PERFORM cron.unschedule('whatsapp-send-cron'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('send-whatsapp-campaigns'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('send-whatsapp-messages'); EXCEPTION WHEN OTHERS THEN NULL; END;

  _job_command := format(
    'SELECT net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb)',
    _base_url || '/functions/v1/send-whatsapp',
    json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key,
      'x-cron-secret', _cron_secret
    )::text
  );

  PERFORM cron.schedule('whatsapp-send-cron', _cron_expression, _job_command);
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_whatsapp_cron() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_whatsapp_cron() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_whatsapp_cron() TO service_role;
