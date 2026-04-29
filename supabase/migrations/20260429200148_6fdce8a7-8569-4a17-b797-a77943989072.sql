-- 1) Min parcelas em atraso por coluna
ALTER TABLE public.crm_cobranca_column_flow
  ADD COLUMN IF NOT EXISTS min_parcelas_atraso integer NOT NULL DEFAULT 1;

-- 2) Mapping situação SSÓtica -> coluna
CREATE TABLE IF NOT EXISTS public.crm_cobranca_situacao_mapping (
  situacao text PRIMARY KEY,
  status_id uuid REFERENCES public.crm_cobranca_statuses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_situacao_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage situacao mapping" ON public.crm_cobranca_situacao_mapping;
CREATE POLICY "Admins manage situacao mapping"
  ON public.crm_cobranca_situacao_mapping
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated view situacao mapping" ON public.crm_cobranca_situacao_mapping;
CREATE POLICY "Authenticated view situacao mapping"
  ON public.crm_cobranca_situacao_mapping
  FOR SELECT TO authenticated
  USING (true);

-- Seed dos 4 mapeamentos com defaults equivalentes ao comportamento atual
INSERT INTO public.crm_cobranca_situacao_mapping (situacao, status_id)
SELECT 'em_atraso', id FROM public.crm_cobranca_statuses WHERE key = '60_dias_de_atraso_ligao_negativao'
ON CONFLICT (situacao) DO NOTHING;

INSERT INTO public.crm_cobranca_situacao_mapping (situacao, status_id)
SELECT 'negativado_serasa', id FROM public.crm_cobranca_statuses WHERE key = '65_dias_de_atraso_receber_informe_de_negativao'
ON CONFLICT (situacao) DO NOTHING;

INSERT INTO public.crm_cobranca_situacao_mapping (situacao, status_id)
SELECT 'ajuizado_saniely', id FROM public.crm_cobranca_statuses WHERE key = '180_dias_ajuizar_manualmente'
ON CONFLICT (situacao) DO NOTHING;

INSERT INTO public.crm_cobranca_situacao_mapping (situacao, status_id)
SELECT 'ajuizado_navde', id FROM public.crm_cobranca_statuses WHERE key = '180_dias_ajuizar_manualmente'
ON CONFLICT (situacao) DO NOTHING;