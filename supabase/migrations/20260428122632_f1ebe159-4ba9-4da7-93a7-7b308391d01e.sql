-- Tabela de logs de conclusão de campanhas/gatilhos do WhatsApp
CREATE TABLE public.whatsapp_completion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('campaign','trigger')),
  source_id uuid NOT NULL,
  source_name text NOT NULL,
  module text NOT NULL,
  status_id uuid,
  status_label text,
  status_key text,
  company_id uuid,
  total_cards integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_completion_logs_source ON public.whatsapp_completion_logs(source_type, source_id, completed_at DESC);
CREATE INDEX idx_whatsapp_completion_logs_completed_at ON public.whatsapp_completion_logs(completed_at DESC);

ALTER TABLE public.whatsapp_completion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view completion logs"
ON public.whatsapp_completion_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete completion logs"
ON public.whatsapp_completion_logs
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role and authenticated can insert completion logs"
ON public.whatsapp_completion_logs
FOR INSERT
TO authenticated
WITH CHECK (true);