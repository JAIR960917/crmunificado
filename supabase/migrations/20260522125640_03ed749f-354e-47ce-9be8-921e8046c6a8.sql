
-- Limpa o lock de gatilho quando o card muda de coluna, permitindo que
-- ao voltar para a mesma coluna o gatilho seja enviado novamente.
CREATE OR REPLACE FUNCTION public._reset_gatilho_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.data := (COALESCE(NEW.data, '{}'::jsonb))
      - 'gatilho_enviado_em'
      - 'gatilho_status_key'
      - 'gatilho_campaign_id'
      - 'gatilho_campaign_name'
      - 'status_entered_at'
      - 'status_entered_status_key';
    NEW.data := jsonb_set(NEW.data, '{status_entered_at}', to_jsonb(now()), true);
    NEW.data := jsonb_set(NEW.data, '{status_entered_status_key}', to_jsonb(NEW.status), true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_gatilho_cobrancas ON public.crm_cobrancas;
CREATE TRIGGER trg_reset_gatilho_cobrancas
BEFORE UPDATE ON public.crm_cobrancas
FOR EACH ROW EXECUTE FUNCTION public._reset_gatilho_on_status_change();

DROP TRIGGER IF EXISTS trg_reset_gatilho_leads ON public.crm_leads;
CREATE TRIGGER trg_reset_gatilho_leads
BEFORE UPDATE ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public._reset_gatilho_on_status_change();

DROP TRIGGER IF EXISTS trg_reset_gatilho_renovacoes ON public.crm_renovacoes;
CREATE TRIGGER trg_reset_gatilho_renovacoes
BEFORE UPDATE ON public.crm_renovacoes
FOR EACH ROW EXECUTE FUNCTION public._reset_gatilho_on_status_change();
