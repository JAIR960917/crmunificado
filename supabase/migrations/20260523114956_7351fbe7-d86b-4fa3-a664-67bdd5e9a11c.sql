
-- 1) Forma de pagamento do óculos
ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS forma_pagamento_oculos text;

-- 2) Campos de exclusão lógica em leads
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by uuid,
  ADD COLUMN IF NOT EXISTS previous_status_before_exclude text,
  ADD COLUMN IF NOT EXISTS previous_assigned_before_exclude uuid;

-- 3) Campos de exclusão lógica em renovacoes
ALTER TABLE public.crm_renovacoes
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by uuid,
  ADD COLUMN IF NOT EXISTS previous_status_before_exclude text,
  ADD COLUMN IF NOT EXISTS previous_assigned_before_exclude uuid;

-- 4) Flag is_system_excluded nas tabelas de status
ALTER TABLE public.crm_statuses
  ADD COLUMN IF NOT EXISTS is_system_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_renovacao_statuses
  ADD COLUMN IF NOT EXISTS is_system_excluded boolean NOT NULL DEFAULT false;

-- 5) Seed da coluna "Excluídos"
INSERT INTO public.crm_statuses (key, label, color, position, is_system_excluded)
SELECT 'excluidos', 'Excluídos', 'red',
       COALESCE((SELECT MAX(position) FROM public.crm_statuses), 0) + 100, true
WHERE NOT EXISTS (SELECT 1 FROM public.crm_statuses WHERE key = 'excluidos');

INSERT INTO public.crm_renovacao_statuses (key, label, color, position, is_system_excluded)
SELECT 'excluidos', 'Excluídos', 'red',
       COALESCE((SELECT MAX(position) FROM public.crm_renovacao_statuses), 0) + 100, true
WHERE NOT EXISTS (SELECT 1 FROM public.crm_renovacao_statuses WHERE key = 'excluidos');

-- 6) Tabela de permissão por coluna (status)
CREATE TABLE IF NOT EXISTS public.role_status_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL,
  module text NOT NULL CHECK (module IN ('leads', 'renovacao')),
  status_key text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_key, module, status_key)
);

ALTER TABLE public.role_status_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage role status permissions" ON public.role_status_permissions;
CREATE POLICY "Admins manage role status permissions"
  ON public.role_status_permissions FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated view role status permissions" ON public.role_status_permissions;
CREATE POLICY "Authenticated view role status permissions"
  ON public.role_status_permissions FOR SELECT
  TO authenticated
  USING (true);

-- 7) RLS: restringir visibilidade dos cards "excluidos" apenas a admins
DROP POLICY IF EXISTS "Role-scoped lead visibility" ON public.crm_leads;
CREATE POLICY "Role-scoped lead visibility"
  ON public.crm_leads FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      status <> 'excluidos'
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (
          has_role(auth.uid(), 'gerente'::app_role)
          AND (
            assigned_to IN (SELECT get_company_user_ids())
            OR created_by IN (SELECT get_company_user_ids())
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users can view renovacoes scoped" ON public.crm_renovacoes;
CREATE POLICY "Users can view renovacoes scoped"
  ON public.crm_renovacoes FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      status <> 'excluidos'
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (
          has_role(auth.uid(), 'gerente'::app_role)
          AND (
            assigned_to IN (SELECT get_company_user_ids())
            OR created_by IN (SELECT get_company_user_ids())
            OR (ssotica_company_id IS NOT NULL AND is_my_company(ssotica_company_id))
          )
        )
      )
    )
  );
