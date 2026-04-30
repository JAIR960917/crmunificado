
-- Create cobranca statuses table (kanban columns for billing)
CREATE TABLE public.crm_cobranca_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cobranca statuses"
  ON public.crm_cobranca_statuses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage cobranca statuses"
  ON public.crm_cobranca_statuses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Create cobrancas table (billing records)
CREATE TABLE public.crm_cobrancas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'novo',
  assigned_to UUID,
  created_by UUID,
  scheduled_date TIMESTAMP WITH TIME ZONE,
  valor NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobrancas ENABLE ROW LEVEL SECURITY;

-- RLS: same company users can see cobrancas
CREATE POLICY "Users can view cobrancas from same company"
  ON public.crm_cobrancas FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_same_company(assigned_to)
    OR public.is_same_company(created_by)
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Authenticated users can insert cobrancas"
  ON public.crm_cobrancas FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update cobrancas"
  ON public.crm_cobrancas FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Admins can delete cobrancas"
  ON public.crm_cobrancas FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );

-- Insert default statuses for cobrancas
INSERT INTO public.crm_cobranca_statuses (key, label, color, position) VALUES
  ('pendente', 'Pendente', 'amber', 0),
  ('em_cobranca', 'Em Cobrança', 'blue', 1),
  ('pago', 'Pago', 'emerald', 2),
  ('atrasado', 'Atrasado', 'red', 3)
  ON CONFLICT (key) DO NOTHING;
