-- ============================================================
-- Fix: sincronizar data_ultima_compra e recalcular status
-- para leads de renovação com datas desatualizadas
-- ============================================================
--
-- Problema raiz: registros antigos (criados manualmente antes da integração
-- SSótica) têm ssotica_cliente_id = NULL. O sync não consegue encontrá-los
-- pela chave e cria um registro NOVO com a data correta. O registro antigo
-- fica com a data desatualizada e aparece na coluna errada do Kanban.
--
-- Este script faz dois ajustes:
--
-- PASSO 1: Para registros que JÁ foram sincronizados com o SSótica
-- (ssotica_cliente_id IS NOT NULL), verifica se o JSONB data possui
-- data_ultima_receita / data_ultima_venda / data_ultima_compra mais
-- recente do que a coluna dedicada e, se sim, atualiza a coluna.
-- (Proteção extra contra divergência coluna × JSONB.)
--
-- PASSO 2: Recalcula o status (coluna do Kanban) para TODOS os registros
-- nos status de fluxo automático com base na data_ultima_compra atual.
-- Isso corrige casos onde a data da coluna já está correta mas o status
-- ficou desatualizado (ex: card travado em "mais_de_3_anos" mesmo após
-- o sync ter atualizado a data).
--
-- NÃO afeta:
--   - status 'excluidos', 'em_atendimento', 'nunca_fez_exame' (manuais)
--   - registros com renovou_outra_otica = true E data_exame_outra_otica
--     preenchida (a data efetiva deles é outra)
--   - 'fazer_direcionamento_para_o_vendedor' (sem vendedor atribuído)
-- ============================================================

-- ------------------------------------------------------------------
-- PASSO 1: coluna ← JSONB quando o JSONB tem data SSótica mais recente
-- ------------------------------------------------------------------
UPDATE public.crm_renovacoes AS r
SET data_ultima_compra = sub.nova_data
FROM (
  SELECT
    id,
    GREATEST(
      CASE
        WHEN (data->>'data_ultima_receita') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (data->>'data_ultima_receita')::date
        ELSE NULL
      END,
      CASE
        WHEN (data->>'data_ultima_venda') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (data->>'data_ultima_venda')::date
        ELSE NULL
      END,
      CASE
        WHEN (data->>'data_ultima_compra') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (data->>'data_ultima_compra')::date
        ELSE NULL
      END
    ) AS nova_data
  FROM public.crm_renovacoes
  WHERE ssotica_cliente_id IS NOT NULL
) sub
WHERE r.id = sub.id
  AND sub.nova_data IS NOT NULL
  AND sub.nova_data > COALESCE(r.data_ultima_compra, '1900-01-01'::date)
  AND r.status NOT IN ('excluidos', 'em_atendimento', 'nunca_fez_exame');

-- ------------------------------------------------------------------
-- PASSO 2: recalcular status com base na data_ultima_compra corrigida
-- ------------------------------------------------------------------
UPDATE public.crm_renovacoes
SET status = CASE
  WHEN data_ultima_compra IS NULL
    THEN 'novo'
  WHEN (CURRENT_DATE - data_ultima_compra) < 365
    THEN 'em_contato'
  WHEN (CURRENT_DATE - data_ultima_compra) < 730
    THEN 'agendado'
  WHEN (CURRENT_DATE - data_ultima_compra) < 1095
    THEN 'renovado'
  ELSE
    'mais_de_3_anos'
END
WHERE status IN ('novo', 'em_contato', 'agendado', 'renovado', 'mais_de_3_anos')
  AND (
    renovou_outra_otica IS NOT TRUE
    OR data_exame_outra_otica IS NULL
  );
