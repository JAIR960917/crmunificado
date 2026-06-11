-- Gerente: alterar valor da consulta em agendamentos da equipe (inline na listagem).

CREATE OR REPLACE FUNCTION public.update_crm_appointment_field(
  p_appointment_id uuid,
  p_field text,
  p_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_valor numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF p_field NOT IN ('confirmacao', 'comparecimento', 'venda', 'resumo', 'valor') THEN
    RAISE EXCEPTION 'Campo não permitido';
  END IF;

  IF NOT public.can_manage_crm_appointment(p_appointment_id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar este agendamento';
  END IF;

  IF p_field = 'valor' THEN
    v_valor := p_value::numeric;
    IF v_valor < 0 THEN
      RAISE EXCEPTION 'Valor inválido';
    END IF;
  END IF;

  UPDATE public.crm_appointments
  SET
    confirmacao = CASE WHEN p_field = 'confirmacao' THEN p_value ELSE confirmacao END,
    comparecimento = CASE WHEN p_field = 'comparecimento' THEN p_value ELSE comparecimento END,
    venda = CASE WHEN p_field = 'venda' THEN p_value ELSE venda END,
    resumo = CASE WHEN p_field = 'resumo' THEN p_value ELSE resumo END,
    valor = CASE WHEN p_field = 'valor' THEN v_valor ELSE valor END,
    updated_at = now()
  WHERE id = p_appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_crm_appointment_field(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_crm_appointment_field(uuid, text, text) TO authenticated;
