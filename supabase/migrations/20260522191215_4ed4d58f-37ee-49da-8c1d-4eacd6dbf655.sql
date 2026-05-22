ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS forma_pagamento_consulta text,
  ADD COLUMN IF NOT EXISTS consulta_a_receber text,
  ADD COLUMN IF NOT EXISTS consulta_a_receber_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS orcamento_produtos_itens jsonb NOT NULL DEFAULT '[]'::jsonb;