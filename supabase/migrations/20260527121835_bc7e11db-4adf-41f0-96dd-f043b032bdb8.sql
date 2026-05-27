DROP FUNCTION IF EXISTS public.try_lock_send_whatsapp();
DROP FUNCTION IF EXISTS public.unlock_send_whatsapp();

CREATE TABLE IF NOT EXISTS public.whatsapp_send_locks (
  name text PRIMARY KEY,
  locked_until timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_send_locks TO service_role;
ALTER TABLE public.whatsapp_send_locks ENABLE ROW LEVEL SECURITY;

INSERT INTO public.whatsapp_send_locks (name, locked_until)
VALUES ('send-whatsapp-cycle', now())
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.try_lock_send_whatsapp(p_ttl_seconds int DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.whatsapp_send_locks
     SET locked_until = now() + make_interval(secs => p_ttl_seconds)
   WHERE name = 'send-whatsapp-cycle'
     AND locked_until <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_send_whatsapp()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_send_locks
     SET locked_until = now()
   WHERE name = 'send-whatsapp-cycle';
$$;

REVOKE EXECUTE ON FUNCTION public.try_lock_send_whatsapp(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_send_whatsapp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_lock_send_whatsapp(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_send_whatsapp() TO service_role;