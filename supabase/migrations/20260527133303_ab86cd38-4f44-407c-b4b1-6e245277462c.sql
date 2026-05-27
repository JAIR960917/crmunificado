CREATE OR REPLACE FUNCTION public.extend_send_whatsapp_lock(p_ttl_seconds int DEFAULT 300)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_send_locks
     SET locked_until = now() + make_interval(secs => p_ttl_seconds)
   WHERE name = 'send-whatsapp-cycle';
$$;

REVOKE EXECUTE ON FUNCTION public.extend_send_whatsapp_lock(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_send_whatsapp_lock(int) TO service_role;