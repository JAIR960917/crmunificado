-- Gerente: reagendar e excluir agendamentos da equipe (RLS + RPC confiável).

DROP POLICY IF EXISTS "Gerentes can manage company appointments" ON public.crm_appointments;

DROP POLICY IF EXISTS "Gerentes can insert company appointments" ON public.crm_appointments;
CREATE POLICY "Gerentes can insert company appointments"
ON public.crm_appointments FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND is_same_company(scheduled_by)
);

DROP POLICY IF EXISTS "Gerentes can update company appointments" ON public.crm_appointments;
CREATE POLICY "Gerentes can update company appointments"
ON public.crm_appointments FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by))
WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by));

DROP POLICY IF EXISTS "Gerentes can delete company appointments" ON public.crm_appointments;
CREATE POLICY "Gerentes can delete company appointments"
ON public.crm_appointments FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by));

CREATE OR REPLACE FUNCTION public.can_manage_crm_appointment(_appointment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_appointments a
    WHERE a.id = _appointment_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR a.scheduled_by = auth.uid()
        OR (
          has_role(auth.uid(), 'gerente'::app_role)
          AND is_same_company(a.scheduled_by)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_crm_appointment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_crm_appointment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reschedule_crm_appointment(
  p_appointment_id uuid,
  p_new_datetime timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  appt public.crm_appointments%ROWTYPE;
  original_first timestamptz;
  shadow_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO appt
  FROM public.crm_appointments
  WHERE id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  IF COALESCE(appt.is_reschedule_snapshot, false) THEN
    RAISE EXCEPTION 'Não é possível reagendar um snapshot';
  END IF;

  IF NOT public.can_manage_crm_appointment(p_appointment_id) THEN
    RAISE EXCEPTION 'Sem permissão para reagendar este agendamento';
  END IF;

  IF p_new_datetime = appt.scheduled_datetime THEN
    RAISE EXCEPTION 'Escolha uma data/horário diferente do agendamento atual';
  END IF;

  original_first := COALESCE(appt.original_scheduled_datetime, appt.scheduled_datetime);

  UPDATE public.crm_appointments
  SET
    scheduled_datetime = p_new_datetime,
    original_scheduled_datetime = original_first,
    rescheduled_from_datetime = original_first,
    updated_at = now()
  WHERE id = p_appointment_id;

  SELECT id INTO shadow_id
  FROM public.crm_appointments
  WHERE snapshot_of_appointment_id = p_appointment_id
    AND COALESCE(is_reschedule_snapshot, false) = true
  LIMIT 1;

  IF shadow_id IS NOT NULL THEN
    UPDATE public.crm_appointments
    SET
      lead_id = appt.lead_id,
      renovacao_id = appt.renovacao_id,
      scheduled_by = appt.scheduled_by,
      scheduled_datetime = original_first,
      original_scheduled_datetime = original_first,
      rescheduled_to_datetime = p_new_datetime,
      is_reschedule_snapshot = true,
      snapshot_of_appointment_id = appt.id,
      valor = appt.valor,
      forma_pagamento = COALESCE(appt.forma_pagamento_oculos, appt.forma_pagamento, ''),
      forma_pagamento_oculos = COALESCE(appt.forma_pagamento_oculos, appt.forma_pagamento, ''),
      canal_agendamento = appt.canal_agendamento,
      nome = appt.nome,
      telefone = appt.telefone,
      idade = appt.idade,
      confirmacao = appt.confirmacao,
      comparecimento = appt.comparecimento,
      venda = appt.venda,
      resumo = appt.resumo,
      previous_status = appt.previous_status,
      status = 'agendado',
      consulta_paga = appt.consulta_paga,
      consulta_paga_em = appt.consulta_paga_em,
      consulta_paga_por = appt.consulta_paga_por,
      updated_at = now()
    WHERE id = shadow_id;
  ELSE
    INSERT INTO public.crm_appointments (
      lead_id,
      renovacao_id,
      scheduled_by,
      scheduled_datetime,
      original_scheduled_datetime,
      rescheduled_to_datetime,
      is_reschedule_snapshot,
      snapshot_of_appointment_id,
      valor,
      forma_pagamento,
      forma_pagamento_oculos,
      canal_agendamento,
      nome,
      telefone,
      idade,
      confirmacao,
      comparecimento,
      venda,
      resumo,
      previous_status,
      status,
      consulta_paga,
      consulta_paga_em,
      consulta_paga_por
    ) VALUES (
      appt.lead_id,
      appt.renovacao_id,
      appt.scheduled_by,
      original_first,
      original_first,
      p_new_datetime,
      true,
      appt.id,
      appt.valor,
      COALESCE(appt.forma_pagamento_oculos, appt.forma_pagamento, ''),
      COALESCE(appt.forma_pagamento_oculos, appt.forma_pagamento, ''),
      appt.canal_agendamento,
      appt.nome,
      appt.telefone,
      appt.idade,
      appt.confirmacao,
      appt.comparecimento,
      appt.venda,
      appt.resumo,
      appt.previous_status,
      'agendado',
      appt.consulta_paga,
      appt.consulta_paga_em,
      appt.consulta_paga_por
    );
  END IF;

  IF appt.lead_id IS NOT NULL THEN
    UPDATE public.crm_leads
    SET scheduled_date = p_new_datetime
    WHERE id = appt.lead_id;
  END IF;

  IF appt.renovacao_id IS NOT NULL THEN
    UPDATE public.crm_renovacoes
    SET scheduled_date = p_new_datetime
    WHERE id = appt.renovacao_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_crm_appointment(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_crm_appointment(uuid, timestamptz) TO authenticated;
