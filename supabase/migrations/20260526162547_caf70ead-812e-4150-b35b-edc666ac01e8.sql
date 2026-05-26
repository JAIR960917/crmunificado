CREATE OR REPLACE FUNCTION public.manage_whatsapp_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _interval_minutes int;
  _cron_expression text;
  _job_command text;
  _base_url text := NULLIF(current_setting('app.settings.supabase_url', true), '');
  _anon_key text := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
BEGIN
  IF _base_url IS NULL OR _anon_key IS NULL THEN
    RAISE NOTICE 'app.settings.supabase_url/supabase_anon_key ausentes; cron whatsapp não agendado';
    RETURN;
  END IF;

  SELECT COALESCE(setting_value, '5')::int INTO _interval_minutes
  FROM system_settings
  WHERE setting_key = 'whatsapp_cron_interval';

  IF _interval_minutes IS NULL OR _interval_minutes < 1 THEN
    _interval_minutes := 5;
  END IF;

  _cron_expression := '*/' || _interval_minutes || ' * * * *';

  BEGIN
    PERFORM cron.unschedule('whatsapp-send-cron');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _base_url || '/functions/v1/send-whatsapp'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _anon_key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule('whatsapp-send-cron', _cron_expression, _job_command);
END;
$$;

-- Reagenda imediatamente com a URL correta
SELECT public.manage_whatsapp_cron();