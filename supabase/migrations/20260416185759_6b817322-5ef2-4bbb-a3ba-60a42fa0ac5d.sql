
ALTER TABLE public.whatsapp_campaigns ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.whatsapp_trigger_steps ADD COLUMN IF NOT EXISTS image_url text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'public'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('whatsapp-media', 'whatsapp-media', true)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('whatsapp-media', 'whatsapp-media')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

CREATE POLICY "Public read whatsapp media"
ON storage.objects FOR SELECT
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated upload whatsapp media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated update whatsapp media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated delete whatsapp media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'whatsapp-media');
