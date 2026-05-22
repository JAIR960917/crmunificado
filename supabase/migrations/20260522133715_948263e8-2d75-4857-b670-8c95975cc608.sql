
-- Função: log de mudança de coluna em LEADS
CREATE OR REPLACE FUNCTION public._log_lead_status_change_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _from_label text;
  _to_label text;
  _user uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT label INTO _from_label FROM public.crm_statuses WHERE key = OLD.status LIMIT 1;
  SELECT label INTO _to_label   FROM public.crm_statuses WHERE key = NEW.status LIMIT 1;

  _user := COALESCE(auth.uid(), NEW.assigned_to, NEW.created_by, OLD.created_by);
  IF _user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.lead_activities (lead_id, title, description, scheduled_date, completed_at, created_by)
  VALUES (
    NEW.id,
    'Mudou de coluna: ' || COALESCE(_from_label, OLD.status) || ' → ' || COALESCE(_to_label, NEW.status),
    'Movido em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    now(),
    now(),
    _user
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lead_status_change ON public.crm_leads;
CREATE TRIGGER trg_log_lead_status_change
AFTER UPDATE OF status ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public._log_lead_status_change_activity();

-- Função: log de mudança de coluna em RENOVACOES
CREATE OR REPLACE FUNCTION public._log_renovacao_status_change_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _from_label text;
  _to_label text;
  _user uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT label INTO _from_label FROM public.crm_renovacao_statuses WHERE key = OLD.status LIMIT 1;
  SELECT label INTO _to_label   FROM public.crm_renovacao_statuses WHERE key = NEW.status LIMIT 1;

  _user := COALESCE(auth.uid(), NEW.assigned_to, NEW.created_by, OLD.created_by);
  IF _user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.renovacao_activities (renovacao_id, title, description, scheduled_date, completed_at, created_by)
  VALUES (
    NEW.id,
    'Mudou de coluna: ' || COALESCE(_from_label, OLD.status) || ' → ' || COALESCE(_to_label, NEW.status),
    'Movido em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    now(),
    now(),
    _user
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_renovacao_status_change ON public.crm_renovacoes;
CREATE TRIGGER trg_log_renovacao_status_change
AFTER UPDATE OF status ON public.crm_renovacoes
FOR EACH ROW EXECUTE FUNCTION public._log_renovacao_status_change_activity();

-- Função: log de mudança de coluna em COBRANCAS
CREATE OR REPLACE FUNCTION public._log_cobranca_status_change_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _from_label text;
  _to_label text;
  _user uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT label INTO _from_label FROM public.crm_cobranca_statuses WHERE key = OLD.status LIMIT 1;
  SELECT label INTO _to_label   FROM public.crm_cobranca_statuses WHERE key = NEW.status LIMIT 1;

  _user := COALESCE(auth.uid(), NEW.assigned_to, NEW.created_by, OLD.created_by);
  IF _user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.cobranca_activities (cobranca_id, title, description, scheduled_date, completed_at, created_by)
  VALUES (
    NEW.id,
    'Mudou de coluna: ' || COALESCE(_from_label, OLD.status) || ' → ' || COALESCE(_to_label, NEW.status),
    'Movido em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    now(),
    now(),
    _user
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_cobranca_status_change ON public.crm_cobrancas;
CREATE TRIGGER trg_log_cobranca_status_change
AFTER UPDATE OF status ON public.crm_cobrancas
FOR EACH ROW EXECUTE FUNCTION public._log_cobranca_status_change_activity();
