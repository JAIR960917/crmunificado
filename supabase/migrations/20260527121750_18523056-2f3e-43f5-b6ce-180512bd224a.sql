CREATE OR REPLACE FUNCTION public.try_lock_send_whatsapp()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(hashtext('send-whatsapp-cycle')::bigint);
$$;

CREATE OR REPLACE FUNCTION public.unlock_send_whatsapp()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(hashtext('send-whatsapp-cycle')::bigint);
$$;

GRANT EXECUTE ON FUNCTION public.try_lock_send_whatsapp() TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_send_whatsapp() TO service_role;