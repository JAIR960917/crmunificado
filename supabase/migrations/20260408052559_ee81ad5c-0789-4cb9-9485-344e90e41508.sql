
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.system_settings;
CREATE POLICY "Authenticated users can view settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert settings" ON public.system_settings;
CREATE POLICY "Admins can insert settings"
  ON public.system_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update settings" ON public.system_settings;
CREATE POLICY "Admins can update settings"
  ON public.system_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Insert default values (idempotente — não sobrescreve se já existir)
INSERT INTO public.system_settings (setting_key, setting_value) VALUES
  ('system_name', 'CRM Ótica Joonker'),
  ('primary_color', '220 72% 50%'),
  ('background_color', '222 47% 6%'),
  ('text_color', '210 20% 92%'),
  ('button_color', '220 72% 55%'),
  ('logo_url', '')
ON CONFLICT (setting_key) DO NOTHING;
