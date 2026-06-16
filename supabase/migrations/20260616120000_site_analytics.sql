-- ============================================================
-- Migração: tabelas de analytics do site
-- Execute no SQL Editor do Supabase (ou via psql na VPS)
-- ============================================================

-- Visitas às páginas do site
CREATE TABLE IF NOT EXISTS public.site_page_views (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  page        TEXT         NOT NULL,
  referrer    TEXT,
  user_agent  TEXT,
  session_id  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Cliques em botões e links do site
CREATE TABLE IF NOT EXISTS public.site_button_clicks (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  button_id    TEXT,
  button_label TEXT,
  page         TEXT         NOT NULL,
  session_id   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Habilitar Row Level Security
ALTER TABLE public.site_page_views    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_button_clicks ENABLE ROW LEVEL SECURITY;

-- INSERT liberado para anônimos (o script JS do site usa a anon key)
CREATE POLICY "anon_insert_page_views"
  ON public.site_page_views
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "anon_insert_button_clicks"
  ON public.site_button_clicks
  FOR INSERT
  WITH CHECK (true);

-- SELECT apenas para usuários autenticados (o CRM usa sessão autenticada)
CREATE POLICY "auth_select_page_views"
  ON public.site_page_views
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "auth_select_button_clicks"
  ON public.site_button_clicks
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Índices para acelerar consultas por data
CREATE INDEX IF NOT EXISTS idx_site_page_views_created_at
  ON public.site_page_views (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_button_clicks_created_at
  ON public.site_button_clicks (created_at DESC);

-- ============================================================
-- Após rodar este SQL, libere a página "Analytics do Site"
-- na tela Configuração > Funções e Permissões do CRM
-- para os papéis que devem ter acesso (admin / gerente).
-- ============================================================
