-- ============================================================
-- Configurações do site institucional (CMS simples)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_web_config (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_web_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_site_web_config"
  ON public.site_web_config FOR SELECT USING (true);

CREATE POLICY "auth_all_site_web_config"
  ON public.site_web_config FOR ALL USING (auth.role() = 'authenticated');

INSERT INTO public.site_web_config (key, value) VALUES
-- Identidade
('company_name',       'Óticas Joonker'),
('color_primary',      '#c8102e'),
('color_dark',         '#0d0d0d'),
('logo_url',           ''),
('whatsapp',           ''),

-- Hero
('hero_badge',            'NO MERCADO DESDE 2018'),
('hero_title_1',          'Enxergue o Mundo com'),
('hero_title_highlight',  'Clareza'),
('hero_title_2',          'e Estilo'),
('hero_subtitle',         'Uma das maiores redes de óticas do Brasil, com 10 lojas e uma equipe dedicada a cuidar da sua saúde visual com excelência.'),
('hero_btn_primary',      'Nossos serviços'),
('hero_btn_secondary',    'Seja um Franqueado'),
('hero_card_title',       'Por que a Joonker?'),
('hero_card_subtitle',    'Sua melhor escolha em visão'),
('hero_card_items',       '["Exame de vista gratuito","Mais de 2.000 modelos","Parcelamento em até 12x","Garantia em todos os produtos","Lentes prontas em 1 hora"]'),
('hero_badge_label',      'Nº1'),
('hero_badge_sub',        'Em satisfação'),

-- Números
('stat_1_value', '10+'),  ('stat_1_label', 'LOJAS'),
('stat_2_value', '7+'),   ('stat_2_label', 'ANOS DE MERCADO'),
('stat_3_value', '50K+'), ('stat_3_label', 'CLIENTES ATENDIDOS'),
('stat_4_value', '4.9★'), ('stat_4_label', 'AVALIAÇÃO'),

-- Sobre
('about_badge',          'SOBRE NÓS'),
('about_title',          'Uma rede construída com propósito'),
('about_text',           'Nascemos em 2018 com uma missão: tornar o cuidado visual acessível, moderno e humano. Com 10 lojas e uma equipe apaixonada, transformamos a experiência óptica em cada atendimento.'),
('about_image_caption',  'Desde 2018 cuidando da sua visão'),
('about_f1_title',       'Exame de vista gratuito'),
('about_f1_text',        'Realizamos exames com equipamentos modernos e optometristas qualificados sem custo adicional.'),
('about_f2_title',       'Qualidade garantida'),
('about_f2_text',        'Trabalhamos apenas com marcas referência do mercado. Garantia em todos os produtos.'),
('about_f3_title',       'Parcelamento facilitado'),
('about_f3_text',        'Até 12x sem juros nos principais cartões. Convênios e planos de saúde aceitos.'),

-- Serviços
('services_badge',    'O QUE OFERECEMOS'),
('services_title',    'Tudo que você precisa para ver melhor'),
('services_subtitle', 'Do exame ao produto, cuidamos de cada detalhe para garantir a melhor experiência.'),
('services_items',    '[{"icon":"👁️","title":"Exame de Vista","text":"Exame completo com optometristas e equipamentos de última geração, totalmente gratuito."},{"icon":"🕶️","title":"Óculos de Sol","text":"Modelos das melhores marcas com proteção UV400 para todos os estilos e idades."},{"icon":"👓","title":"Óculos de Grau","text":"Armações modernas e lentes de alta tecnologia com montagem expressa em até 1 hora."},{"icon":"💧","title":"Lentes de Contato","text":"Lentes descartáveis, mensais e anuais com adaptação acompanhada por especialistas."},{"icon":"🔧","title":"Manutenção","text":"Conserto, ajuste e limpeza profissional de armações no mesmo dia."}]'),

-- Depoimentos
('testimonials_badge', 'DEPOIMENTOS'),
('testimonials_title', 'O que nossos clientes dizem'),
('testimonials_items', '[{"quote":"Atendimento incrível! Fiz meu exame gratuitamente e saí com meu óculos novo no mesmo dia. Recomendo muito a Óticas Joonker!","author":"Ana Carolina S.","location":"São Paulo, SP"},{"quote":"Melhor custo-benefício que já encontrei em uma ótica. Ótimos modelos, preço justo e equipe super atenciosa. Já indiquei para toda a família.","author":"Roberto M.","location":"Belo Horizonte, MG"},{"quote":"Parcelei em 12x sem juros e o óculos ficou pronto em menos de 1 hora. Serviço de primeiro mundo. Voltarei com certeza!","author":"Fernanda O.","location":"Curitiba, PR"}]'),

-- Franquia
('franchise_badge',     'SEJA UM FRANQUEADO'),
('franchise_title',     'Faça parte da família Joonker'),
('franchise_subtitle',  'Invista em um negócio rentável com suporte completo. Mais de 10 unidades abertas em todo o Brasil.'),
('franchise_features',  '["Suporte completo na implantação","Treinamento da equipe incluído","Marketing e materiais fornecidos","ROI médio em 18 meses","Território exclusivo garantido"]'),
('franchise_btn',       'Quero ser franqueado'),

-- Rodapé
('footer_about',     'Rede de óticas com mais de 10 lojas no Brasil. Qualidade, tecnologia e cuidado em cada atendimento desde 2018.'),
('footer_phone',     ''),
('footer_email',     ''),
('footer_address',   ''),
('footer_instagram', ''),
('footer_facebook',  '')
ON CONFLICT (key) DO NOTHING;
