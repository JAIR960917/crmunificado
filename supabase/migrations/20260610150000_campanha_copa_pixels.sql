-- Pixels configuráveis (Meta, Google etc.) nas telas do formulário Campanha Copa

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES
  ('campanha_copa_pixel_form', ''),
  ('campanha_copa_pixel_success', '')
ON CONFLICT (setting_key) DO NOTHING;
