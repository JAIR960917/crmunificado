-- Snapshots de reagendamento na data original são visíveis só para admin.
-- A policy FOR ALL de gerente permitia SELECT e contornava o filtro de snapshot.

DROP POLICY IF EXISTS "Gerentes can manage company appointments" ON public.crm_appointments;

CREATE POLICY "Gerentes can insert company appointments"
ON public.crm_appointments FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND (
    auth.uid() = scheduled_by
    OR (
      COALESCE(is_reschedule_snapshot, false) = true
      AND is_same_company(scheduled_by)
    )
  )
);

CREATE POLICY "Gerentes can update company appointments"
ON public.crm_appointments FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by))
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND (
    auth.uid() = scheduled_by
    OR (
      COALESCE(is_reschedule_snapshot, false) = true
      AND is_same_company(scheduled_by)
    )
  )
);

CREATE POLICY "Gerentes can delete company appointments"
ON public.crm_appointments FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by));
