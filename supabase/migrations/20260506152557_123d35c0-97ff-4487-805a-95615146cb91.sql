CREATE OR REPLACE FUNCTION public.delete_duplicate_leads(_lead_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta ação';
  END IF;

  IF _lead_ids IS NULL OR coalesce(array_length(_lead_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('deleted_leads', 0);
  END IF;

  WITH deleted_rows AS (
    DELETE FROM public.crm_leads
    WHERE id = ANY(_lead_ids)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted_rows;

  RETURN jsonb_build_object('deleted_leads', deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_duplicate_leads(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_duplicate_leads(uuid[]) TO authenticated;