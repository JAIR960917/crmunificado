-- Campanha Copa: formulário público + listagem no CRM

INSERT INTO public.crm_statuses (key, label, color, position, is_system_excluded)
SELECT 'campanha_copa', 'Campanha Copa', '#16a34a', 0, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_statuses WHERE key = 'campanha_copa'
);

CREATE TABLE IF NOT EXISTS public.campanha_copa_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  nome text NOT NULL,
  idade text,
  cidade text,
  telefone text NOT NULL,
  usa_oculos text,
  ultimo_exame_vista text,
  palpite_brasil integer,
  palpite_marrocos integer,
  palpite_texto text,
  consentimento_marketing boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campanha_copa_submissions_created_at_idx
  ON public.campanha_copa_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS campanha_copa_submissions_telefone_idx
  ON public.campanha_copa_submissions (telefone);

CREATE INDEX IF NOT EXISTS campanha_copa_submissions_lead_id_idx
  ON public.campanha_copa_submissions (lead_id);

ALTER TABLE public.campanha_copa_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access campanha_copa" ON public.campanha_copa_submissions;
CREATE POLICY "Admins full access campanha_copa" ON public.campanha_copa_submissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Gerentes view company campanha_copa" ON public.campanha_copa_submissions;
CREATE POLICY "Gerentes view company campanha_copa" ON public.campanha_copa_submissions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'gerente')
    AND (
      assigned_to IS NULL
      OR public.is_same_company(assigned_to)
    )
  );

DROP POLICY IF EXISTS "Gerentes update company campanha_copa" ON public.campanha_copa_submissions;
CREATE POLICY "Gerentes update company campanha_copa" ON public.campanha_copa_submissions
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'gerente')
    AND (
      assigned_to IS NULL
      OR public.is_same_company(assigned_to)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'gerente')
    AND (
      assigned_to IS NULL
      OR public.is_same_company(assigned_to)
    )
  );

DROP POLICY IF EXISTS "Vendedores view assigned campanha_copa" ON public.campanha_copa_submissions;
CREATE POLICY "Vendedores view assigned campanha_copa" ON public.campanha_copa_submissions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'vendedor')
    AND assigned_to = auth.uid()
  );

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('campanha_copa_default_user_id', '')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO public.role_page_permissions (role_key, page_key, allowed)
SELECT DISTINCT rp.role_key, 'campanhas_copa', (rp.role_key IN ('admin', 'gerente'))
FROM public.role_page_permissions rp
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_page_permissions x
  WHERE x.role_key = rp.role_key AND x.page_key = 'campanhas_copa'
);

INSERT INTO public.role_status_permissions (role_key, status_key, allowed)
SELECT DISTINCT rp.role_key, 'campanha_copa', true
FROM public.role_page_permissions rp
WHERE rp.page_key = 'leads'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_status_permissions x
    WHERE x.role_key = rp.role_key AND x.status_key = 'campanha_copa'
  );
