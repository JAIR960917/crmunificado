-- Logos são exibidos em <img> (sidebar, favicon, login) sem header Authorization.
-- A policy "Authenticated can read logos" quebrou URLs públicas após deploy de migrations.

DROP POLICY IF EXISTS "Anyone can view logos" ON storage.objects;

CREATE POLICY "Anyone can view logos"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'logos');
