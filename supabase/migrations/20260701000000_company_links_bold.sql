-- Adiciona campo bold aos itens de texto da página /links (title, paragraph, header)
ALTER TABLE public.company_links
  ADD COLUMN IF NOT EXISTS bold boolean NOT NULL DEFAULT false;
