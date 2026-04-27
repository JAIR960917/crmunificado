-- Adicionar campo financeiro_visible em statuses de cobrança (default true)
ALTER TABLE public.crm_cobranca_statuses 
ADD COLUMN IF NOT EXISTS financeiro_visible boolean NOT NULL DEFAULT true;

-- Tabela de checklist por coluna (admin configura, financeiro precisa preencher para mover lead)
CREATE TABLE IF NOT EXISTS public.crm_cobranca_status_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobranca_checklist_status ON public.crm_cobranca_status_checklist(status_id);

ALTER TABLE public.crm_cobranca_status_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cobranca checklist"
ON public.crm_cobranca_status_checklist
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view cobranca checklist"
ON public.crm_cobranca_status_checklist
FOR SELECT TO authenticated
USING (true);

-- Tabela registrando preenchimento do checklist por cobrança
CREATE TABLE IF NOT EXISTS public.crm_cobranca_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id uuid NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  status_id uuid NOT NULL REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES public.crm_cobranca_status_checklist(id) ON DELETE CASCADE,
  completed_by uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cobranca_id, status_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cobranca_completions_cobranca ON public.crm_cobranca_checklist_completions(cobranca_id, status_id);

ALTER TABLE public.crm_cobranca_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View completions for accessible cobrancas"
ON public.crm_cobranca_checklist_completions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM crm_cobrancas c
    WHERE c.id = crm_cobranca_checklist_completions.cobranca_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'financeiro'::app_role)
      OR c.assigned_to = auth.uid()
      OR c.created_by = auth.uid()
      OR is_same_company(c.assigned_to)
      OR is_same_company(c.created_by)
    )
  )
);

CREATE POLICY "Insert completions on accessible cobrancas"
ON public.crm_cobranca_checklist_completions
FOR INSERT TO authenticated
WITH CHECK (
  completed_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM crm_cobrancas c
    WHERE c.id = crm_cobranca_checklist_completions.cobranca_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'financeiro'::app_role)
    )
  )
);

CREATE POLICY "Delete own completions or admin"
ON public.crm_cobranca_checklist_completions
FOR DELETE TO authenticated
USING (completed_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));