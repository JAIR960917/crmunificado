-- Retorno do agendamento para Leads/Renovações (visível só para admin, cinza no calendário)
ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid;

CREATE INDEX IF NOT EXISTS idx_crm_appointments_returned_at
  ON public.crm_appointments (returned_at)
  WHERE returned_at IS NOT NULL;
