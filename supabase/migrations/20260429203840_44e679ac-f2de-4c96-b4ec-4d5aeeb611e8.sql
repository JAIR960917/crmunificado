CREATE OR REPLACE FUNCTION public.slugify_status_key(_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _normalized text;
BEGIN
  _normalized := lower(coalesce(_label, ''));
  _normalized := translate(_normalized,
    'áàãâäéèêëíìîïóòõôöúùûüçñýÿÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑÝ',
    'aaaaaeeeeiiiiooooouuuucnyyaaaaaeeeeiiiiooooouuuucny');
  _normalized := regexp_replace(_normalized, '[^a-z0-9]+', '_', 'g');
  _normalized := regexp_replace(_normalized, '_+', '_', 'g');
  _normalized := trim(both '_' from _normalized);

  IF _normalized = '' THEN
    RAISE EXCEPTION 'O nome da coluna não pode gerar uma key vazia';
  END IF;

  RETURN _normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_cobranca_statuses_sync_key_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.label IS DISTINCT FROM OLD.label THEN
    NEW.key := public.slugify_status_key(NEW.label);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_cobranca_statuses_propagate_key_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.key IS NOT DISTINCT FROM OLD.key THEN
    RETURN NEW;
  END IF;

  UPDATE public.crm_cobrancas c
  SET
    status = CASE WHEN c.status = OLD.key THEN NEW.key ELSE c.status END,
    data = CASE
      WHEN coalesce(c.data->>'tratativa_status_key', '') = OLD.key
        OR coalesce(c.data->>'gatilho_status_key', '') = OLD.key
      THEN
        CASE
          WHEN coalesce(c.data->>'tratativa_status_key', '') = OLD.key
               AND coalesce(c.data->>'gatilho_status_key', '') = OLD.key
            THEN jsonb_set(
              jsonb_set(c.data, '{tratativa_status_key}', to_jsonb(NEW.key), true),
              '{gatilho_status_key}', to_jsonb(NEW.key), true
            )
          WHEN coalesce(c.data->>'tratativa_status_key', '') = OLD.key
            THEN jsonb_set(c.data, '{tratativa_status_key}', to_jsonb(NEW.key), true)
          WHEN coalesce(c.data->>'gatilho_status_key', '') = OLD.key
            THEN jsonb_set(c.data, '{gatilho_status_key}', to_jsonb(NEW.key), true)
          ELSE c.data
        END
      ELSE c.data
    END,
    updated_at = CASE
      WHEN c.status = OLD.key
        OR coalesce(c.data->>'tratativa_status_key', '') = OLD.key
        OR coalesce(c.data->>'gatilho_status_key', '') = OLD.key
      THEN now()
      ELSE c.updated_at
    END
  WHERE c.status = OLD.key
     OR coalesce(c.data->>'tratativa_status_key', '') = OLD.key
     OR coalesce(c.data->>'gatilho_status_key', '') = OLD.key;

  UPDATE public.crm_cobranca_flow_events
  SET
    status_key = CASE WHEN status_key = OLD.key THEN NEW.key ELSE status_key END,
    next_status_key = CASE WHEN next_status_key = OLD.key THEN NEW.key ELSE next_status_key END,
    status_label = CASE WHEN status_key = OLD.key THEN NEW.label ELSE status_label END,
    next_status_label = CASE WHEN next_status_key = OLD.key THEN NEW.label ELSE next_status_label END
  WHERE status_key = OLD.key OR next_status_key = OLD.key;

  UPDATE public.crm_module_transition_logs
  SET
    to_status_key = NEW.key,
    to_status_label = NEW.label
  WHERE to_module = 'cobrancas' AND to_status_key = OLD.key;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_cobranca_statuses_sync_key_before_update ON public.crm_cobranca_statuses;
CREATE TRIGGER trg_crm_cobranca_statuses_sync_key_before_update
BEFORE UPDATE ON public.crm_cobranca_statuses
FOR EACH ROW
EXECUTE FUNCTION public.crm_cobranca_statuses_sync_key_before_update();

DROP TRIGGER IF EXISTS trg_crm_cobranca_statuses_propagate_key_change ON public.crm_cobranca_statuses;
CREATE TRIGGER trg_crm_cobranca_statuses_propagate_key_change
AFTER UPDATE ON public.crm_cobranca_statuses
FOR EACH ROW
EXECUTE FUNCTION public.crm_cobranca_statuses_propagate_key_change();