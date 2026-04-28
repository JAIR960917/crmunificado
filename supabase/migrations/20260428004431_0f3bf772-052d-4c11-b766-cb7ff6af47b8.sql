
-- 1) Configuração do fluxo por coluna
CREATE TABLE public.crm_cobranca_column_flow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL UNIQUE REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  flow_enabled boolean NOT NULL DEFAULT false,
  column_type text NOT NULL DEFAULT 'manual' CHECK (column_type IN ('manual','auto')),
  days_to_advance integer NOT NULL DEFAULT 0 CHECK (days_to_advance >= 0),
  next_status_id uuid REFERENCES public.crm_cobranca_statuses(id) ON DELETE SET NULL,
  whatsapp_trigger_campaign_id uuid REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_column_flow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage cobranca column flow"
  ON public.crm_cobranca_column_flow FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated view cobranca column flow"
  ON public.crm_cobranca_column_flow FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_cobranca_column_flow_updated_at
  BEFORE UPDATE ON public.crm_cobranca_column_flow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Eventos do fluxo (timeline no card)
CREATE TABLE public.crm_cobranca_flow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id uuid NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  status_id uuid REFERENCES public.crm_cobranca_statuses(id) ON DELETE SET NULL,
  status_key text,
  status_label text,
  event_type text NOT NULL CHECK (event_type IN ('tratativa','gatilho_enviado','avancou_coluna','gatilho_falhou')),
  whatsapp_trigger_campaign_id uuid REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE SET NULL,
  whatsapp_trigger_campaign_name text,
  next_status_key text,
  next_status_label text,
  created_by uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cobranca_flow_events_cobranca ON public.crm_cobranca_flow_events(cobranca_id, created_at DESC);

ALTER TABLE public.crm_cobranca_flow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View cobranca flow events scoped"
  ON public.crm_cobranca_flow_events FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_flow_events.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR has_role(auth.uid(), 'gerente'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
      )
  ));

CREATE POLICY "Insert flow events on accessible cobrancas"
  ON public.crm_cobranca_flow_events FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_flow_events.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
      )
  ));

CREATE POLICY "Admins delete flow events"
  ON public.crm_cobranca_flow_events FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Pré-popula uma linha de fluxo para cada status existente (vazio, admin configura)
INSERT INTO public.crm_cobranca_column_flow (status_id, flow_enabled, column_type, days_to_advance)
SELECT id, false, 'manual', 0
FROM public.crm_cobranca_statuses
ON CONFLICT (status_id) DO NOTHING;
