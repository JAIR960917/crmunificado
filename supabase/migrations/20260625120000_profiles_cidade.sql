-- Coluna existia na produção atual (provavelmente adicionada manualmente em
-- algum momento) mas nunca tinha sido registrada numa migration deste repo.
-- Não é usada em nenhuma tela hoje; mantida só para compatibilidade com os
-- dados já existentes na migração de dados da produção atual.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cidade text NOT NULL DEFAULT '';
