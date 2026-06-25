-- Bucket público para assets do site (logos, imagens)
-- As colunas public/file_size_limit/allowed_mime_types nem sempre existem em
-- storage.buckets (depende da versão do storage-api self-hosted) — monta o
-- INSERT só com as colunas que de fato existem.
DO $do$
DECLARE
  cols text[] := ARRAY['id', 'name'];
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='public') THEN
    cols := cols || 'public';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') THEN
    cols := cols || 'file_size_limit';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') THEN
    cols := cols || 'allowed_mime_types';
  END IF;

  EXECUTE format(
    'INSERT INTO storage.buckets (%s) VALUES (%s) ON CONFLICT (id) DO NOTHING',
    array_to_string(cols, ', '),
    array_to_string(
      ARRAY(
        SELECT CASE c
          WHEN 'id' THEN quote_literal('site-assets')
          WHEN 'name' THEN quote_literal('site-assets')
          WHEN 'public' THEN 'true'
          WHEN 'file_size_limit' THEN '5242880'
          WHEN 'allowed_mime_types' THEN $lit$ARRAY['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml']$lit$
        END
        FROM unnest(cols) AS c
      ),
      ', '
    )
  );
END;
$do$;

-- Usuários autenticados podem fazer upload
CREATE POLICY "auth_upload_site_assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'site-assets');

-- Usuários autenticados podem substituir arquivos
CREATE POLICY "auth_update_site_assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'site-assets');

-- Usuários autenticados podem deletar
CREATE POLICY "auth_delete_site_assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'site-assets');

-- Acesso público de leitura (imagens do site são públicas)
CREATE POLICY "public_read_site_assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'site-assets');
