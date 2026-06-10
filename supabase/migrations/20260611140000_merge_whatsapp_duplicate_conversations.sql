-- Mescla conversas WhatsApp duplicadas (gatilho + resposta em threads separadas).

CREATE OR REPLACE FUNCTION public.whatsapp_canonical_wa_id(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(public.normalize_br_mobile_digits(p_raw)) >= 10
      THEN '55' || public.normalize_br_mobile_digits(p_raw)
    ELSE regexp_replace(coalesce(p_raw, ''), '\D', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_conversation_keep_score(p_conv public.whatsapp_conversations)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT
    (CASE WHEN p_conv.card_id IS NOT NULL THEN 1000 ELSE 0 END)
    + (CASE
        WHEN p_conv.contact_name IS NOT NULL
          AND btrim(p_conv.contact_name) <> ''
          AND p_conv.contact_name !~ '^\+'
        THEN 100
        ELSE 0
      END)
    + (CASE WHEN p_conv.module = 'cobrancas' THEN 50 ELSE 0 END)
    + COALESCE((
      SELECT count(*)::integer
      FROM public.whatsapp_messages m
      WHERE m.conversation_id = p_conv.id
        AND m.direction = 'out'
    ), 0) * 10;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_conversations_should_merge(
  p_a public.whatsapp_conversations,
  p_b public.whatsapp_conversations
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  cob_a jsonb;
  cob_b jsonb;
BEGIN
  IF p_a.id = p_b.id THEN
    RETURN false;
  END IF;

  IF p_a.instance_id IS DISTINCT FROM p_b.instance_id THEN
    RETURN false;
  END IF;

  IF public.br_phones_match(p_a.wa_id, p_b.wa_id) THEN
    RETURN true;
  END IF;

  IF p_a.card_id IS NOT NULL AND p_b.card_id IS NOT NULL AND p_a.card_id = p_b.card_id THEN
    RETURN true;
  END IF;

  IF p_a.card_id IS NOT NULL THEN
    SELECT c.data INTO cob_a FROM public.crm_cobrancas c WHERE c.id = p_a.card_id;
    IF cob_a IS NOT NULL AND public.cobranca_matches_inbox_phone(cob_a, p_b.wa_id) THEN
      RETURN true;
    END IF;
    IF cob_a IS NOT NULL
      AND p_b.contact_name IS NOT NULL
      AND btrim(p_b.contact_name) <> ''
      AND p_b.contact_name !~ '^\+'
      AND public.cobranca_name_matches_hint(cob_a, p_b.contact_name)
    THEN
      RETURN true;
    END IF;
  END IF;

  IF p_b.card_id IS NOT NULL THEN
    SELECT c.data INTO cob_b FROM public.crm_cobrancas c WHERE c.id = p_b.card_id;
    IF cob_b IS NOT NULL AND public.cobranca_matches_inbox_phone(cob_b, p_a.wa_id) THEN
      RETURN true;
    END IF;
    IF cob_b IS NOT NULL
      AND p_a.contact_name IS NOT NULL
      AND btrim(p_a.contact_name) <> ''
      AND p_a.contact_name !~ '^\+'
      AND public.cobranca_name_matches_hint(cob_b, p_a.contact_name)
    THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_whatsapp_conversation_pair(
  p_keeper_id uuid,
  p_duplicate_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keeper public.whatsapp_conversations%ROWTYPE;
  v_dup public.whatsapp_conversations%ROWTYPE;
  v_msg_count integer;
  v_canonical text;
  v_contact text;
BEGIN
  IF p_keeper_id IS NULL OR p_duplicate_id IS NULL OR p_keeper_id = p_duplicate_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ids inválidos');
  END IF;

  SELECT * INTO v_keeper FROM public.whatsapp_conversations WHERE id = p_keeper_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conversa keeper não encontrada');
  END IF;

  SELECT * INTO v_dup FROM public.whatsapp_conversations WHERE id = p_duplicate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conversa duplicada não encontrada');
  END IF;

  IF NOT public.whatsapp_conversations_should_merge(v_keeper, v_dup) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conversas não elegíveis para mesclagem');
  END IF;

  SELECT count(*) INTO v_msg_count
  FROM public.whatsapp_messages
  WHERE conversation_id = p_duplicate_id;

  v_canonical := public.whatsapp_canonical_wa_id(
    COALESCE(v_dup.wa_id, v_keeper.wa_id)
  );

  v_contact := v_keeper.contact_name;
  IF v_contact IS NULL OR btrim(v_contact) = '' OR v_contact ~ '^\+' THEN
    v_contact := v_dup.contact_name;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'keeper_id', p_keeper_id,
      'duplicate_id', p_duplicate_id,
      'keeper_wa_id', v_keeper.wa_id,
      'duplicate_wa_id', v_dup.wa_id,
      'canonical_wa_id', v_canonical,
      'messages_to_move', v_msg_count,
      'keeper_contact', v_keeper.contact_name,
      'duplicate_contact', v_dup.contact_name
    );
  END IF;

  UPDATE public.whatsapp_messages
  SET conversation_id = p_keeper_id
  WHERE conversation_id = p_duplicate_id;

  DELETE FROM public.whatsapp_conversations
  WHERE id = p_duplicate_id;

  UPDATE public.whatsapp_conversations k
  SET
    wa_id = v_canonical,
    phone_display = v_canonical,
    contact_name = v_contact,
    card_id = COALESCE(k.card_id, v_dup.card_id),
    module = COALESCE(k.module, v_dup.module),
    assigned_to = COALESCE(k.assigned_to, v_dup.assigned_to),
    unread_count = COALESCE(k.unread_count, 0) + COALESCE(v_dup.unread_count, 0),
    last_message_at = GREATEST(k.last_message_at, v_dup.last_message_at),
    last_preview = CASE
      WHEN v_dup.last_message_at IS NOT NULL
        AND (k.last_message_at IS NULL OR v_dup.last_message_at >= k.last_message_at)
      THEN v_dup.last_preview
      ELSE k.last_preview
    END,
    window_expires_at = CASE
      WHEN k.window_expires_at IS NULL THEN v_dup.window_expires_at
      WHEN v_dup.window_expires_at IS NULL THEN k.window_expires_at
      ELSE GREATEST(k.window_expires_at, v_dup.window_expires_at)
    END,
    updated_at = now()
  WHERE k.id = p_keeper_id;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'keeper_id', p_keeper_id,
    'duplicate_id', p_duplicate_id,
    'messages_moved', v_msg_count,
    'canonical_wa_id', v_canonical
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_duplicate_whatsapp_conversations(
  p_dry_run boolean DEFAULT true,
  p_max_iterations integer DEFAULT 20
)
RETURNS TABLE (
  iteration integer,
  keeper_id uuid,
  duplicate_id uuid,
  keeper_contact text,
  duplicate_contact text,
  keeper_wa_id text,
  duplicate_wa_id text,
  messages_moved integer,
  applied boolean,
  detail jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iter integer := 0;
  v_pair record;
  v_result jsonb;
BEGIN
  IF p_dry_run THEN
    RETURN QUERY
    SELECT
      row_number() OVER (
        ORDER BY GREATEST(sa, sb) DESC, LEAST(sa, sb) DESC
      )::integer AS iteration,
      CASE WHEN sa >= sb THEN a.id ELSE b.id END,
      CASE WHEN sa >= sb THEN b.id ELSE a.id END,
      CASE WHEN sa >= sb THEN a.contact_name ELSE b.contact_name END,
      CASE WHEN sa >= sb THEN b.contact_name ELSE a.contact_name END,
      CASE WHEN sa >= sb THEN a.wa_id ELSE b.wa_id END,
      CASE WHEN sa >= sb THEN b.wa_id ELSE a.wa_id END,
      (
        SELECT count(*)::integer
        FROM public.whatsapp_messages m
        WHERE m.conversation_id = CASE WHEN sa >= sb THEN b.id ELSE a.id END
      ),
      false,
      public.merge_whatsapp_conversation_pair(
        CASE WHEN sa >= sb THEN a.id ELSE b.id END,
        CASE WHEN sa >= sb THEN b.id ELSE a.id END,
        true
      )
    FROM public.whatsapp_conversations a
    JOIN public.whatsapp_conversations b
      ON a.id < b.id
     AND a.instance_id IS NOT DISTINCT FROM b.instance_id
    CROSS JOIN LATERAL (
      SELECT public.whatsapp_conversation_keep_score(a) AS sa
    ) sca
    CROSS JOIN LATERAL (
      SELECT public.whatsapp_conversation_keep_score(b) AS sb
    ) scb
    WHERE public.whatsapp_conversations_should_merge(a, b);
    RETURN;
  END IF;

  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > GREATEST(p_max_iterations, 1);

    SELECT
      CASE WHEN sa >= sb THEN a.id ELSE b.id END AS keeper,
      CASE WHEN sa >= sb THEN b.id ELSE a.id END AS dup,
      CASE WHEN sa >= sb THEN a.contact_name ELSE b.contact_name END AS k_contact,
      CASE WHEN sa >= sb THEN b.contact_name ELSE a.contact_name END AS d_contact,
      CASE WHEN sa >= sb THEN a.wa_id ELSE b.wa_id END AS k_wa,
      CASE WHEN sa >= sb THEN b.wa_id ELSE a.wa_id END AS d_wa
    INTO v_pair
    FROM public.whatsapp_conversations a
    JOIN public.whatsapp_conversations b
      ON a.id < b.id
     AND a.instance_id IS NOT DISTINCT FROM b.instance_id
    CROSS JOIN LATERAL (
      SELECT public.whatsapp_conversation_keep_score(a) AS sa
    ) sca
    CROSS JOIN LATERAL (
      SELECT public.whatsapp_conversation_keep_score(b) AS sb
    ) scb
    WHERE public.whatsapp_conversations_should_merge(a, b)
    ORDER BY GREATEST(sa, sb) DESC, LEAST(sa, sb) DESC
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    v_result := public.merge_whatsapp_conversation_pair(
      v_pair.keeper,
      v_pair.dup,
      false
    );

    IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
      RETURN QUERY
      SELECT
        v_iter,
        v_pair.keeper,
        v_pair.dup,
        v_pair.k_contact,
        v_pair.d_contact,
        v_pair.k_wa,
        v_pair.d_wa,
        0,
        false,
        v_result;
      EXIT;
    END IF;

    RETURN QUERY
    SELECT
      v_iter,
      v_pair.keeper,
      v_pair.dup,
      v_pair.k_contact,
      v_pair.d_contact,
      v_pair.k_wa,
      v_pair.d_wa,
      coalesce((v_result->>'messages_moved')::integer, 0),
      true,
      v_result;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.merge_duplicate_whatsapp_conversations(boolean, integer) IS
  'Mescla conversas duplicadas do inbox WhatsApp. Use p_dry_run=true para simular.';

REVOKE ALL ON FUNCTION public.merge_duplicate_whatsapp_conversations(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_whatsapp_conversations(boolean, integer) TO service_role;

REVOKE ALL ON FUNCTION public.merge_whatsapp_conversation_pair(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_whatsapp_conversation_pair(uuid, uuid, boolean) TO service_role;
