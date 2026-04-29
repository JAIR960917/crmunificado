-- Reorganiza cobranças existentes conforme crm_cobranca_situacao_mapping.
-- Olha a situação real vinda do SSÓtica em data->ssotica_raw->situacao
-- e move o card para a coluna mapeada (Ajuizado > Negativado Serasa > Em atraso).

WITH mapping AS (
  SELECT m.situacao, s.key
  FROM public.crm_cobranca_situacao_mapping m
  JOIN public.crm_cobranca_statuses s ON s.id = m.status_id
),
classified AS (
  SELECT
    c.id,
    c.status AS current_status,
    LOWER(TRIM(REGEXP_REPLACE(
      TRANSLATE(c.data #>> '{ssotica_raw,situacao}',
                'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
      '\s+', ' ', 'g'
    ))) AS situ_norm
  FROM public.crm_cobrancas c
),
target AS (
  SELECT
    cl.id,
    cl.current_status,
    CASE
      WHEN cl.situ_norm LIKE 'ajuizado%saniely%' THEN (SELECT key FROM mapping WHERE situacao = 'ajuizado_saniely')
      WHEN cl.situ_norm LIKE 'ajuizado%navde%'   THEN (SELECT key FROM mapping WHERE situacao = 'ajuizado_navde')
      WHEN cl.situ_norm LIKE 'negativado%serasa%' THEN (SELECT key FROM mapping WHERE situacao = 'negativado_serasa')
      WHEN cl.situ_norm = 'em atraso'             THEN (SELECT key FROM mapping WHERE situacao = 'em_atraso')
      ELSE NULL
    END AS target_status
  FROM classified cl
)
UPDATE public.crm_cobrancas c
SET status = t.target_status,
    updated_at = now()
FROM target t
WHERE c.id = t.id
  AND t.target_status IS NOT NULL
  AND c.status IS DISTINCT FROM t.target_status;