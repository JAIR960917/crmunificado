CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hour int;
  _h1 int;
  _h2 int;
  _h3 int;
  _h4 int;
  _cron_expression text;
  _job_command text;
  _base_url text := NULLIF(current_setting('app.settings.supabase_url', true), '');
  _anon_key text := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
BEGIN
  IF _base_url IS NULL OR _anon_key IS NULL THEN
    RAISE EXCEPTION 'Configuração ausente: app.settings.supabase_url/app.settings.supabase_anon_key não definidos';
  END IF;

  SELECT COALESCE(setting_value, '6')::int INTO _hour
  FROM system_settings
  WHERE setting_key = 'ssotica_sync_hour';

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    _hour := 6;
  END IF;

  _h1 := (_hour + 3) % 24;
  _h2 := (_hour + 9) % 24;
  _h3 := (_hour + 15) % 24;
  _h4 := (_hour + 21) % 24;
  _cron_expression := '0 ' || _h1 || ',' || _h2 || ',' || _h3 || ',' || _h4 || ' * * *';

  BEGIN
    PERFORM cron.unschedule('ssotica-daily-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM cron.unschedule('ssotica-sync-cron');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM cron.unschedule('ssotica-hourly-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _base_url || '/functions/v1/ssotica-sync'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _anon_key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule('ssotica-daily-sync', _cron_expression, _job_command);
END;
$$;

DO $$
DECLARE
  _job_command text;
  _base_url text := NULLIF(current_setting('app.settings.supabase_url', true), '');
  _anon_key text := NULLIF(current_setting('app.settings.supabase_anon_key', true), '');
BEGIN
  IF _base_url IS NULL OR _anon_key IS NULL THEN
    RAISE EXCEPTION 'Configuração ausente: app.settings.supabase_url/app.settings.supabase_anon_key não definidos';
  END IF;

  BEGIN
    PERFORM cron.unschedule('ssotica-backfill-runner');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _base_url || '/functions/v1/ssotica-sync'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _anon_key || '"}''::jsonb, body := ''{"mode":"backfill_tick"}''::jsonb);';

  PERFORM cron.schedule('ssotica-backfill-runner', '* * * * *', _job_command);
END;
$$;

SELECT public.manage_ssotica_cron();
