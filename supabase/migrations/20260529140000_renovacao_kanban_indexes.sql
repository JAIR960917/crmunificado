-- Acelera listagem do kanban de Renovação por coluna (status + ordenação).
CREATE INDEX IF NOT EXISTS idx_crm_renovacoes_status_updated_at
  ON public.crm_renovacoes (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_renovacao_activities_renovacao_id
  ON public.renovacao_activities (renovacao_id);

CREATE INDEX IF NOT EXISTS idx_crm_renovacao_notes_renovacao_id
  ON public.crm_renovacao_notes (renovacao_id);
