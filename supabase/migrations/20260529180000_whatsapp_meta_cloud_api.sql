-- Preparação para WhatsApp Cloud API (Meta) — revisão de app e migração gradual da API Full.

-- Provedor global (apifull | meta). Enquanto meta não estiver aprovado, mantenha 'apifull'.
INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('whatsapp_provider', 'apifull')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('whatsapp_meta_app_id', '')
ON CONFLICT (setting_key) DO NOTHING;

-- Instâncias: suporte a número oficial (Cloud API)
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'apifull',
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS display_phone text,
  ADD COLUMN IF NOT EXISTS meta_default_template text,
  ADD COLUMN IF NOT EXISTS meta_template_language text NOT NULL DEFAULT 'pt_BR';

ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;

ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_check
  CHECK (provider IN ('apifull', 'meta'));

COMMENT ON COLUMN public.whatsapp_instances.provider IS 'apifull = sessão QR (API Full); meta = WhatsApp Cloud API';
COMMENT ON COLUMN public.whatsapp_instances.phone_number_id IS 'ID do número na Meta (Graph API)';
COMMENT ON COLUMN public.whatsapp_instances.session IS 'API Full: nome da sessão; Meta: pode repetir phone_number_id para round-robin';

-- Campanhas / gatilhos: template aprovado na Meta (obrigatório fora da janela 24h)
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS meta_template_name text,
  ADD COLUMN IF NOT EXISTS meta_template_language text DEFAULT 'pt_BR';

ALTER TABLE public.whatsapp_trigger_steps
  ADD COLUMN IF NOT EXISTS meta_template_name text,
  ADD COLUMN IF NOT EXISTS meta_template_language text DEFAULT 'pt_BR';

-- Conversas (janela 24h + inbox para revisão Meta)
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  wa_id text NOT NULL,
  contact_name text,
  phone_display text,
  module text,
  card_id uuid,
  window_expires_at timestamptz,
  last_message_at timestamptz,
  last_preview text,
  unread_count int NOT NULL DEFAULT 0,
  assigned_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, wa_id)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text,
  wa_message_id text,
  status text,
  is_template boolean NOT NULL DEFAULT false,
  meta_template_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation
  ON public.whatsapp_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last
  ON public.whatsapp_conversations (last_message_at DESC NULLS LAST);

-- Opt-in explícito (boas práticas / revisão Meta)
CREATE TABLE IF NOT EXISTS public.whatsapp_opt_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'crm',
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (phone, company_id)
);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_opt_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full whatsapp_conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Staff read whatsapp_conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Admins full whatsapp_messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Staff read whatsapp_messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Admins full whatsapp_opt_ins" ON public.whatsapp_opt_ins;
DROP POLICY IF EXISTS "Staff read whatsapp_opt_ins" ON public.whatsapp_opt_ins;

CREATE POLICY "Admins full whatsapp_conversations"
  ON public.whatsapp_conversations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff read whatsapp_conversations"
  ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'vendedor'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
  );

CREATE POLICY "Admins full whatsapp_messages"
  ON public.whatsapp_messages FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff read whatsapp_messages"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'vendedor'::app_role)
    OR has_role(auth.uid(), 'financeiro'::app_role)
  );

CREATE POLICY "Admins full whatsapp_opt_ins"
  ON public.whatsapp_opt_ins FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff read whatsapp_opt_ins"
  ON public.whatsapp_opt_ins FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

DROP TRIGGER IF EXISTS update_whatsapp_conversations_updated_at ON public.whatsapp_conversations;
CREATE TRIGGER update_whatsapp_conversations_updated_at
  BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Permissão da página de demo do inbox (já pode existir; ver também 20260529150000)
INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
VALUES ('admin', 'whatsapp_inbox_demo', true)
ON CONFLICT (role_key, page_key) DO UPDATE SET allowed = EXCLUDED.allowed;

CREATE OR REPLACE FUNCTION public.increment_whatsapp_unread(p_conversation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_conversations
  SET unread_count = unread_count + 1
  WHERE id = p_conversation_id;
$$;
