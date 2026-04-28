INSERT INTO public.crm_module_transition_logs
  (cliente_nome, from_module, to_module, to_status_key, to_status_label, trigger_source)
VALUES (
  'Limpeza administrativa: cards removidos da coluna "1 Dia antes do vencimento" cujas parcelas ainda estavam a mais de 1 dia do vencimento (correção de bug). Os cards serão recriados pela próxima sincronização quando estiverem a 1 dia do vencimento.',
  'cobranca',
  'none',
  'pendente',
  '1 Dia antes do vencimento',
  'manual'
);