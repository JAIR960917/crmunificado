
-- Renovação statuses table
CREATE TABLE public.crm_renovacao_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_renovacao_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage renovacao statuses"
  ON public.crm_renovacao_statuses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view renovacao statuses"
  ON public.crm_renovacao_statuses FOR SELECT TO authenticated
  USING (true);

-- Seed initial statuses
INSERT INTO public.crm_renovacao_statuses (key, label, color, position) VALUES
  ('novo', 'Novo', 'blue', 0),
  ('em_contato', 'Em Contato', 'amber', 1),
  ('agendado', 'Agendado', 'violet', 2),
  ('renovado', 'Renovado', 'emerald', 3)
  ON CONFLICT (key) DO NOTHING;

-- Renovações table
CREATE TABLE public.crm_renovacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'novo',
  valor numeric NOT NULL DEFAULT 0,
  assigned_to uuid,
  created_by uuid,
  scheduled_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_renovacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view renovacoes from same company"
  ON public.crm_renovacoes FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR is_same_company(assigned_to)
    OR is_same_company(created_by)
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Authenticated users can insert renovacoes"
  ON public.crm_renovacoes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update renovacoes"
  ON public.crm_renovacoes FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'gerente')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Admins can delete renovacoes"
  ON public.crm_renovacoes FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE TRIGGER update_renovacoes_updated_at
  BEFORE UPDATE ON public.crm_renovacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
