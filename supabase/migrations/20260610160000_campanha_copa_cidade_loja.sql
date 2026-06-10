-- Mapeamento cidade → loja (company) e cursor round-robin por loja

CREATE TABLE IF NOT EXISTS public.campanha_copa_cidade_lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cidade_label text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campanha_copa_cidade_lojas_label_uidx
  ON public.campanha_copa_cidade_lojas (lower(trim(cidade_label)));

CREATE INDEX IF NOT EXISTS campanha_copa_cidade_lojas_company_idx
  ON public.campanha_copa_cidade_lojas (company_id);

CREATE TABLE IF NOT EXISTS public.campanha_copa_round_robin (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campanha_copa_cidade_lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_copa_round_robin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full campanha_copa_cidade_lojas" ON public.campanha_copa_cidade_lojas;
CREATE POLICY "Admins full campanha_copa_cidade_lojas" ON public.campanha_copa_cidade_lojas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Gerentes view campanha_copa_cidade_lojas" ON public.campanha_copa_cidade_lojas;
CREATE POLICY "Gerentes view campanha_copa_cidade_lojas" ON public.campanha_copa_cidade_lojas
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'gerente')
    AND public.is_my_company(company_id)
  );

DROP POLICY IF EXISTS "Admins full campanha_copa_round_robin" ON public.campanha_copa_round_robin;
CREATE POLICY "Admins full campanha_copa_round_robin" ON public.campanha_copa_round_robin
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Gerentes manage own campanha_copa_round_robin" ON public.campanha_copa_round_robin;
CREATE POLICY "Gerentes manage own campanha_copa_round_robin" ON public.campanha_copa_round_robin
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'gerente') AND public.is_my_company(company_id))
  WITH CHECK (public.has_role(auth.uid(), 'gerente') AND public.is_my_company(company_id));
