-- Transferência em massa de leads / renovações entre usuários (admin e gerente).

CREATE OR REPLACE FUNCTION public._assert_bulk_transfer_caller()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para transferência em massa';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_bulk_transfer_users(
  p_from_user_id uuid,
  p_to_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_bulk_transfer_caller();

  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuários de origem e destino são obrigatórios';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'Origem e destino devem ser diferentes';
  END IF;

  IF has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN;
  END IF;

  IF p_from_user_id <> auth.uid()
     AND p_from_user_id NOT IN (SELECT public.get_company_user_ids()) THEN
    RAISE EXCEPTION 'Origem fora da sua loja';
  END IF;

  IF p_to_user_id NOT IN (SELECT public.get_company_user_ids()) THEN
    RAISE EXCEPTION 'Destino fora da sua loja';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_transferable_crm_records(
  p_module text,
  p_from_user_id uuid,
  p_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM public._assert_bulk_transfer_caller();

  IF p_from_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário de origem é obrigatório';
  END IF;

  IF NOT has_role(auth.uid(), 'admin'::app_role)
     AND p_from_user_id <> auth.uid()
     AND p_from_user_id NOT IN (SELECT public.get_company_user_ids()) THEN
    RAISE EXCEPTION 'Origem fora da sua loja';
  END IF;

  IF p_module NOT IN ('leads', 'renovacoes') THEN
    RAISE EXCEPTION 'Módulo inválido';
  END IF;

  IF p_module = 'leads' THEN
    SELECT count(*)::integer INTO v_count
    FROM public.crm_leads l
    WHERE l.status <> 'excluidos'
      AND (
        l.assigned_to = p_from_user_id
        OR (l.assigned_to IS NULL AND l.created_by = p_from_user_id)
      );
    RETURN COALESCE(v_count, 0);
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.crm_renovacoes r
  WHERE r.status <> 'excluidos'
    AND (
      r.assigned_to = p_from_user_id
      OR (r.assigned_to IS NULL AND r.created_by = p_from_user_id)
    )
    AND (p_company_id IS NULL OR r.ssotica_company_id = p_company_id);

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_transfer_crm_records(
  p_module text,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_quantity integer,
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transferred integer := 0;
  v_requested integer;
BEGIN
  PERFORM public._assert_bulk_transfer_users(p_from_user_id, p_to_user_id);

  IF p_module NOT IN ('leads', 'renovacoes') THEN
    RAISE EXCEPTION 'Módulo inválido';
  END IF;

  v_requested := COALESCE(p_quantity, 0);
  IF v_requested < 1 THEN
    RAISE EXCEPTION 'Quantidade deve ser pelo menos 1';
  END IF;
  IF v_requested > 5000 THEN
    RAISE EXCEPTION 'Quantidade máxima por operação: 5000';
  END IF;

  IF p_module = 'leads' THEN
    WITH picked AS (
      SELECT l.id
      FROM public.crm_leads l
      WHERE l.status <> 'excluidos'
        AND (
          l.assigned_to = p_from_user_id
          OR (l.assigned_to IS NULL AND l.created_by = p_from_user_id)
        )
      ORDER BY l.created_at ASC
      LIMIT v_requested
    ),
    updated AS (
      UPDATE public.crm_leads l
      SET assigned_to = p_to_user_id, updated_at = now()
      FROM picked
      WHERE l.id = picked.id
      RETURNING l.id
    )
    SELECT count(*)::integer INTO v_transferred FROM updated;
  ELSE
    WITH picked AS (
      SELECT r.id
      FROM public.crm_renovacoes r
      WHERE r.status <> 'excluidos'
        AND (
          r.assigned_to = p_from_user_id
          OR (r.assigned_to IS NULL AND r.created_by = p_from_user_id)
        )
        AND (p_company_id IS NULL OR r.ssotica_company_id = p_company_id)
      ORDER BY r.created_at ASC
      LIMIT v_requested
    ),
    updated AS (
      UPDATE public.crm_renovacoes r
      SET assigned_to = p_to_user_id, updated_at = now()
      FROM picked
      WHERE r.id = picked.id
      RETURNING r.id
    )
    SELECT count(*)::integer INTO v_transferred FROM updated;
  END IF;

  RETURN jsonb_build_object(
    'transferred', COALESCE(v_transferred, 0),
    'requested', v_requested
  );
END;
$$;

REVOKE ALL ON FUNCTION public._assert_bulk_transfer_caller() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._assert_bulk_transfer_users(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_transferable_crm_records(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_transfer_crm_records(text, uuid, uuid, integer, uuid) TO authenticated;
