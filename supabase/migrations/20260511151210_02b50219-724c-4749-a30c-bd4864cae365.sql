
-- Desliga toda sincronização automática do SSótica.
-- A partir de agora, só roda quando o usuário clicar manualmente.

DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('ssotica-daily-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-sync-cron'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-hourly-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-backfill-runner'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Zera todas as integrações presas em "running"/"scheduled".
UPDATE public.ssotica_integrations
SET sync_status = 'idle',
    backfill_status = CASE
      WHEN backfill_status IN ('running', 'scheduled') THEN 'idle'
      ELSE backfill_status
    END,
    backfill_next_run_at = NULL,
    last_error = COALESCE(last_error, '') || ' | Sincronização automática desativada — disparar manualmente.',
    updated_at = now()
WHERE sync_status = 'running'
   OR backfill_status IN ('running', 'scheduled')
   OR backfill_next_run_at IS NOT NULL;

-- Fecha logs órfãos abertos.
UPDATE public.ssotica_sync_logs
SET status = 'error',
    finished_at = now(),
    error_message = COALESCE(error_message, 'Encerrado: sincronização automática foi desativada.')
WHERE status = 'running';

-- Reescreve manage_ssotica_cron para ser NO-OP. O botão "Salvar e reagendar"
-- da UI ainda chama essa função, mas ela não recria mais os cron jobs.
-- Mantém a assinatura/permissões pra não quebrar chamadas existentes.
CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Sincronização automática do SSótica está desativada por escolha do usuário.
  -- Cada loja só sincroniza quando o admin clicar "Sincronizar" manualmente.
  BEGIN PERFORM cron.unschedule('ssotica-daily-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-sync-cron'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-hourly-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-backfill-runner'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$function$;
