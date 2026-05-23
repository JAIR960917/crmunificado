-- Permite que qualquer usuário com acesso ao lead consiga executar o soft-delete
-- (mover o status para 'excluidos'). A WITH CHECK garante que essa policy só
-- autoriza transições para a coluna Excluídos.
DROP POLICY IF EXISTS "Users can soft-delete visible leads" ON public.crm_leads;
CREATE POLICY "Users can soft-delete visible leads"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (
  status <> 'excluidos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND (is_same_company(assigned_to) OR is_same_company(created_by))
    )
  )
)
WITH CHECK (status = 'excluidos');

DROP POLICY IF EXISTS "Users can soft-delete visible renovacoes" ON public.crm_renovacoes;
CREATE POLICY "Users can soft-delete visible renovacoes"
ON public.crm_renovacoes
FOR UPDATE
TO authenticated
USING (
  status <> 'excluidos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR assigned_to = auth.uid()
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
WITH CHECK (status = 'excluidos');