UPDATE public.ssotica_integrations
SET sync_status = 'idle',
    updated_at = now()
WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d'
  AND sync_status = 'running';