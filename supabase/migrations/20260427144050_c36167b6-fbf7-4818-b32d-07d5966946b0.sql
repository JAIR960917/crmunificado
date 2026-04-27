-- Add cobranca_id column to lead_card_opens to support tracking when finance users open cobranca cards
ALTER TABLE public.lead_card_opens
  ADD COLUMN IF NOT EXISTS cobranca_id UUID;

CREATE INDEX IF NOT EXISTS idx_lead_card_opens_cobranca_id ON public.lead_card_opens(cobranca_id);
CREATE INDEX IF NOT EXISTS idx_lead_card_opens_user_opened_at ON public.lead_card_opens(user_id, opened_at DESC);

-- Allow financeiro/admin/gerente to view cobranca card opens of accessible users (similar pattern to existing policies)
DROP POLICY IF EXISTS "Financeiro can view cobranca card opens" ON public.lead_card_opens;
CREATE POLICY "Financeiro can view cobranca card opens"
  ON public.lead_card_opens
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'financeiro'::app_role)
    AND card_type = 'cobranca'
  );