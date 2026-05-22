DROP POLICY IF EXISTS "Users can view renovacoes scoped" ON public.crm_renovacoes;
DROP POLICY IF EXISTS "Users can update renovacoes" ON public.crm_renovacoes;
DROP POLICY IF EXISTS "Admins can delete renovacoes" ON public.crm_renovacoes;

CREATE POLICY "Users can view renovacoes scoped"
ON public.crm_renovacoes FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND (
      (assigned_to IN (SELECT get_company_user_ids()))
      OR (created_by IN (SELECT get_company_user_ids()))
      OR (ssotica_company_id IS NOT NULL AND is_my_company(ssotica_company_id))
    )
  )
);

CREATE POLICY "Users can update renovacoes"
ON public.crm_renovacoes FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND (
      (assigned_to IN (SELECT get_company_user_ids()))
      OR (created_by IN (SELECT get_company_user_ids()))
      OR (ssotica_company_id IS NOT NULL AND is_my_company(ssotica_company_id))
    )
  )
);

CREATE POLICY "Admins can delete renovacoes"
ON public.crm_renovacoes FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND (
      (assigned_to IN (SELECT get_company_user_ids()))
      OR (created_by IN (SELECT get_company_user_ids()))
      OR (ssotica_company_id IS NOT NULL AND is_my_company(ssotica_company_id))
    )
  )
);