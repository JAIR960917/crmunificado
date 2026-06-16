-- ==========================================================
-- Correções de segurança: políticas RLS permissivas
-- ==========================================================

-- -------------------------------------------------------
-- 1. site_web_config: apenas admin pode escrever
-- -------------------------------------------------------
DROP POLICY IF EXISTS "auth_all_site_web_config" ON public.site_web_config;

-- Usuários autenticados leem (painel CRM precisa ler para exibir config)
CREATE POLICY "auth_read_site_web_config"
  ON public.site_web_config FOR SELECT
  TO authenticated
  USING (true);

-- Apenas admin pode inserir, atualizar ou deletar
CREATE POLICY "admin_insert_site_web_config"
  ON public.site_web_config FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_update_site_web_config"
  ON public.site_web_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_delete_site_web_config"
  ON public.site_web_config FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- -------------------------------------------------------
-- 2. site_form_fields: apenas admin pode escrever
-- -------------------------------------------------------
DROP POLICY IF EXISTS "auth_all_site_form_fields" ON public.site_form_fields;

-- Usuários autenticados leem todos os campos (incluindo inativos, para o painel)
CREATE POLICY "auth_read_site_form_fields"
  ON public.site_form_fields FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_insert_site_form_fields"
  ON public.site_form_fields FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_update_site_form_fields"
  ON public.site_form_fields FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_delete_site_form_fields"
  ON public.site_form_fields FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- -------------------------------------------------------
-- 3. site_form_submissions: admin gerencia, staff lê (sem deletar)
-- -------------------------------------------------------
DROP POLICY IF EXISTS "auth_all_site_form_submissions" ON public.site_form_submissions;

-- Qualquer staff pode ler leads do site (necessário para atribuição)
CREATE POLICY "auth_read_site_form_submissions"
  ON public.site_form_submissions FOR SELECT
  TO authenticated
  USING (true);

-- Apenas admin pode atualizar (mudar status, atribuir) ou deletar
CREATE POLICY "admin_update_site_form_submissions"
  ON public.site_form_submissions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin_delete_site_form_submissions"
  ON public.site_form_submissions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- -------------------------------------------------------
-- 4. site-assets (storage): apenas admin pode escrever
-- -------------------------------------------------------
DROP POLICY IF EXISTS "auth_upload_site_assets" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_site_assets" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_site_assets" ON storage.objects;

CREATE POLICY "admin_upload_site_assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'site-assets'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "admin_update_site_assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'site-assets'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "admin_delete_site_assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'site-assets'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- -------------------------------------------------------
-- 5. whatsapp_messages: filtrar por empresa no SELECT e DELETE
-- -------------------------------------------------------
DROP POLICY IF EXISTS "Staff read whatsapp_messages" ON public.whatsapp_messages;

CREATE POLICY "Staff read whatsapp_messages"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_conversations c
      JOIN public.whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id = whatsapp_messages.conversation_id
        AND public.is_my_company(i.company_id)
    )
  );

DROP POLICY IF EXISTS "Staff delete own whatsapp_messages" ON public.whatsapp_messages;

CREATE POLICY "Staff delete own whatsapp_messages"
  ON public.whatsapp_messages FOR DELETE
  TO authenticated
  USING (
    sent_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      public.has_role(auth.uid(), 'gerente'::app_role)
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_conversations c
        JOIN public.whatsapp_instances i ON i.id = c.instance_id
        WHERE c.id = whatsapp_messages.conversation_id
          AND public.is_my_company(i.company_id)
      )
    )
  );
