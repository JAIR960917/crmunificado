
CREATE TABLE public.crm_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT 'blue',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view statuses" ON public.crm_statuses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage statuses" ON public.crm_statuses
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.crm_statuses (key, label, position, color) VALUES
  ('novo', 'Novo', 0, 'blue'),
  ('em_contato', 'Em Contato', 1, 'amber'),
  ('qualificado', 'Qualificado', 2, 'violet'),
  ('proposta', 'Proposta', 3, 'cyan'),
  ('fechado', 'Fechado', 4, 'emerald'),
  ('perdido', 'Perdido', 5, 'red')
  ON CONFLICT (key) DO NOTHING;
