-- ============================================================
-- Busca por telefone na tela de Renovacao falhava porque o telefone fica
-- salvo no JSONB com formatacao variada (parenteses, ponto, traco, espaco -
-- ex.: "(84) 9.2000-7039"). O filtro ilike do PostgREST nao consegue
-- remover essa formatacao em tempo de consulta a partir de uma expressao
-- JSON no proprio filtro .or(), entao a busca so funcionava se o usuario
-- digitasse com EXATAMENTE a mesma formatacao salva.
--
-- Esta migration adiciona uma coluna gerada (somente digitos) para que o
-- frontend possa filtrar diretamente nela via ilike, indepedente de como o
-- telefone foi formatado na origem (SSotica/manual).
-- ============================================================

ALTER TABLE public.crm_renovacoes
  ADD COLUMN IF NOT EXISTS telefone_digits text
  GENERATED ALWAYS AS (regexp_replace(coalesce(data->>'telefone', ''), '\D', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_crm_renovacoes_telefone_digits
  ON public.crm_renovacoes (telefone_digits);
