-- Remove a opção de ícone customizado do PWA (causava manifest quebrado
-- quando o upload falhava/ficava inacessível — ver 20260703120000/2f9d244a).
-- O ícone agora é só os arquivos estáticos do build (public/pwa-192x192.png,
-- public/pwa-512x512.png), sem opção de troca pela tela de Configurações.
DELETE FROM public.system_settings WHERE setting_key IN ('pwa_icon_192_url', 'pwa_icon_512_url');
