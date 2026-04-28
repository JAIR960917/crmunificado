UPDATE public.ssotica_integrations
SET sync_status = 'idle', last_error = NULL, updated_at = now()
WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d' AND sync_status = 'running';

UPDATE public.ssotica_sync_logs
SET status = 'error',
    finished_at = now(),
    error_message = 'Destravada manualmente — sync sem atualização há ~37 min'
WHERE integration_id = '92093af4-69a1-4033-a272-4c23062e3d6d'
  AND status = 'running'
  AND finished_at IS NULL;