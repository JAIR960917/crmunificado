-- Período de envio de palpites e banner do formulário Campanha Copa

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES
  ('campanha_copa_periodo_inicio', ''),
  ('campanha_copa_periodo_fim', ''),
  ('campanha_copa_banner_url', '')
ON CONFLICT (setting_key) DO NOTHING;
