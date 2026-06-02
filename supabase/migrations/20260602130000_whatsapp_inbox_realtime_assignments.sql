-- Inbox: Realtime + marcar como lida + roteamento por número (instância)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_instance_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_assignments_user
  ON public.whatsapp_instance_assignments (user_id);

ALTER TABLE public.whatsapp_instance_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full whatsapp_instance_assignments" ON public.whatsapp_instance_assignments;
DROP POLICY IF EXISTS "Staff read own whatsapp_instance_assignments" ON public.whatsapp_instance_assignments;

CREATE POLICY "Admins full whatsapp_instance_assignments"
  ON public.whatsapp_instance_assignments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff read own whatsapp_instance_assignments"
  ON public.whatsapp_instance_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_has_whatsapp_inbox_access(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN has_role(auth.uid(), 'admin'::app_role) THEN true
    WHEN has_role(auth.uid(), 'gerente'::app_role) THEN true
    WHEN p_instance_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.whatsapp_instance_assignments a
      WHERE a.user_id = auth.uid() AND a.instance_id = p_instance_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instance_id uuid;
BEGIN
  SELECT instance_id INTO v_instance_id
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT public.user_has_whatsapp_inbox_access(v_instance_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta conversa';
  END IF;

  UPDATE public.whatsapp_conversations
  SET unread_count = 0, updated_at = now()
  WHERE id = p_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_whatsapp_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_whatsapp_inbox_access(uuid) TO authenticated;

DROP POLICY IF EXISTS "Staff read whatsapp_conversations" ON public.whatsapp_conversations;

CREATE POLICY "Staff read whatsapp_conversations"
  ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR (
      instance_id IS NOT NULL
      AND public.user_has_whatsapp_inbox_access(instance_id)
    )
  );

COMMENT ON TABLE public.whatsapp_instance_assignments IS
  'Vincula usuários aos números WhatsApp (instâncias Meta). Admin/gerente veem tudo; demais só instâncias atribuídas.';
