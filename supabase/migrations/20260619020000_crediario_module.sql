-- ============================================================================
-- Módulo Crediário (absorvido do app "consultasjoonker") — schema unificado.
-- Tabelas prefixadas com crediario_ para não colidir com o restante do CRM.
-- Reaproveita auth/empresa já existentes: public.companies, public.profiles,
-- public.user_roles, public.role_definitions, public.role_page_permissions.
-- Não recria empresas/profiles/roles próprios do app antigo.
-- ============================================================================

-- ---------- Helpers de RLS específicos do Crediário ----------

-- Acesso de leitura/escrita a registros com "dono" (user_id) e empresa (company_id):
-- admin sempre; o próprio dono; gerente da mesma empresa do registro.
CREATE OR REPLACE FUNCTION public.crediario_can_write(_owner_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(auth.uid(), 'admin'::app_role)
    OR _owner_user_id = auth.uid()
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND _company_id IS NOT NULL
      AND _company_id = get_my_company_id()
    );
$$;

-- Mesmo critério acima + financeiro em modo leitura (relatórios/parcelas).
CREATE OR REPLACE FUNCTION public.crediario_can_read(_owner_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.crediario_can_write(_owner_user_id, _company_id)
    OR has_role(auth.uid(), 'financeiro'::app_role);
$$;

-- Acesso por empresa apenas (sem "dono" individual): admin ou gerente da empresa.
CREATE OR REPLACE FUNCTION public.crediario_company_scoped(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND _company_id IS NOT NULL
      AND _company_id = get_my_company_id()
    );
$$;

-- ---------- Configuração operacional (taxas, score, manutenção) ----------

CREATE TABLE IF NOT EXISTS public.crediario_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_score integer NOT NULL DEFAULT 0,
  good_score integer NOT NULL DEFAULT 700,
  max_installments integer NOT NULL DEFAULT 12,
  min_entry_percent numeric NOT NULL DEFAULT 0,
  installment_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_tiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  renegociacao_max_parcelas integer NOT NULL DEFAULT 12,
  renegociacao_juros_percent numeric NOT NULL DEFAULT 0,
  cora_discount_percent numeric NOT NULL DEFAULT 0,
  cora_fine_percent numeric NOT NULL DEFAULT 0,
  cora_interest_monthly_percent numeric NOT NULL DEFAULT 0,
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_title text NOT NULL DEFAULT '',
  maintenance_message text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER crediario_settings_updated_at
  BEFORE UPDATE ON public.crediario_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crediario_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_settings_select_authenticated"
  ON public.crediario_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "crediario_settings_write_admin"
  ON public.crediario_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- Credenciais globais (Zapsign) ----------

CREATE TABLE IF NOT EXISTS public.crediario_global_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zapsign_api_token text,
  zapsign_env text,
  zapsign_template_id text,
  zapsign_webhook_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER crediario_global_credentials_updated_at
  BEFORE UPDATE ON public.crediario_global_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crediario_global_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_global_credentials_admin_only"
  ON public.crediario_global_credentials FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- Credenciais Cora por empresa (cada loja emite no seu próprio gateway) ----------

CREATE TABLE IF NOT EXISTS public.crediario_company_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cora_client_id text,
  cora_certificate text,
  cora_private_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE TRIGGER crediario_company_credentials_updated_at
  BEFORE UPDATE ON public.crediario_company_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crediario_company_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_company_credentials_admin_only"
  ON public.crediario_company_credentials FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- Template de contrato (Nota Promissória) ----------

CREATE TABLE IF NOT EXISTS public.crediario_contract_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  company_cnpj text NOT NULL DEFAULT '',
  company_address text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER crediario_contract_template_updated_at
  BEFORE UPDATE ON public.crediario_contract_template
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crediario_contract_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_contract_template_select_authenticated"
  ON public.crediario_contract_template FOR SELECT TO authenticated USING (true);

CREATE POLICY "crediario_contract_template_write_admin"
  ON public.crediario_contract_template FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- Consultas Serasa/APIFull ----------

CREATE TABLE IF NOT EXISTS public.crediario_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  nome text,
  score integer,
  status text NOT NULL DEFAULT 'pendente',
  cidade text NOT NULL DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_consultas_cpf ON public.crediario_consultas (cpf);
CREATE INDEX IF NOT EXISTS idx_crediario_consultas_user ON public.crediario_consultas (user_id);

CREATE TABLE IF NOT EXISTS public.crediario_consultas_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf text NOT NULL,
  nome text,
  score integer,
  data_nascimento text,
  soma_pendencias numeric,
  total_pendencias integer,
  pendencias jsonb,
  raw jsonb,
  consultado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_consultas_cache_cpf ON public.crediario_consultas_cache (cpf);

CREATE TRIGGER crediario_consultas_cache_updated_at
  BEFORE UPDATE ON public.crediario_consultas_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.crediario_consultas_pg_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  nome text,
  cidade text NOT NULL DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crediario_consultas_renegociacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  nome text,
  cidade text NOT NULL DEFAULT '',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crediario_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_consultas_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_consultas_pg_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_consultas_renegociacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_consultas_rw" ON public.crediario_consultas FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

CREATE POLICY "crediario_consultas_cache_select" ON public.crediario_consultas_cache
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "crediario_consultas_cache_write" ON public.crediario_consultas_cache
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "crediario_consultas_pg_entrega_rw" ON public.crediario_consultas_pg_entrega FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

CREATE POLICY "crediario_consultas_renegociacao_rw" ON public.crediario_consultas_renegociacao FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

-- ---------- Vendas, parcelas e contratos ----------

CREATE TABLE IF NOT EXISTS public.crediario_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  consulta_id uuid REFERENCES public.crediario_consultas(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  nome text,
  score integer,
  cidade text NOT NULL DEFAULT '',
  tipo text NOT NULL DEFAULT 'boleto',
  status text NOT NULL DEFAULT 'pendente',
  parcelas integer NOT NULL,
  taxa_juros numeric NOT NULL,
  valor_total numeric NOT NULL,
  valor_entrada numeric NOT NULL DEFAULT 0,
  valor_entrada_entrega numeric,
  valor_financiado numeric NOT NULL DEFAULT 0,
  valor_parcela numeric NOT NULL DEFAULT 0,
  valor_promissoria numeric,
  valor_venda numeric,
  primeiro_vencimento date,
  aprovacao_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovacao_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovacao_em timestamptz,
  aprovacao_motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_vendas_cpf ON public.crediario_vendas (cpf);
CREATE INDEX IF NOT EXISTS idx_crediario_vendas_user ON public.crediario_vendas (user_id);
CREATE INDEX IF NOT EXISTS idx_crediario_vendas_company ON public.crediario_vendas (company_id);

CREATE TABLE IF NOT EXISTS public.crediario_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  consulta_id uuid REFERENCES public.crediario_consultas(id) ON DELETE SET NULL,
  venda_id uuid REFERENCES public.crediario_vendas(id) ON DELETE SET NULL,
  cpf text NOT NULL,
  nome text NOT NULL,
  endereco text NOT NULL,
  telefone text NOT NULL,
  cidade text NOT NULL DEFAULT '',
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  signature_provider text,
  signature_external_id text,
  signature_url text,
  signature_data jsonb,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_contracts_venda ON public.crediario_contracts (venda_id);

CREATE TRIGGER crediario_contracts_updated_at
  BEFORE UPDATE ON public.crediario_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.crediario_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id uuid NOT NULL REFERENCES public.crediario_vendas(id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES public.crediario_contracts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  numero_parcela integer NOT NULL,
  total_parcelas integer NOT NULL,
  valor numeric NOT NULL,
  vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  cora_invoice_id text,
  codigo_barras text,
  linha_digitavel text,
  pix_qrcode text,
  pix_emv text,
  pdf_url text,
  emitido_em timestamptz,
  pago_em timestamptz,
  valor_pago numeric,
  erro_mensagem text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_parcelas_venda ON public.crediario_parcelas (venda_id);
CREATE INDEX IF NOT EXISTS idx_crediario_parcelas_company ON public.crediario_parcelas (company_id);

CREATE TRIGGER crediario_parcelas_updated_at
  BEFORE UPDATE ON public.crediario_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.crediario_cora_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  cora_invoice_id text,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crediario_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crediario_cora_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_vendas_rw" ON public.crediario_vendas FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

CREATE POLICY "crediario_contracts_rw" ON public.crediario_contracts FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

CREATE POLICY "crediario_parcelas_rw" ON public.crediario_parcelas FOR ALL TO authenticated
  USING (public.crediario_can_read(user_id, company_id))
  WITH CHECK (public.crediario_can_write(user_id, company_id));

CREATE POLICY "crediario_cora_webhook_logs_admin_only" ON public.crediario_cora_webhook_logs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- Contratos importados (Assertiva / Google Drive) ----------

CREATE TABLE IF NOT EXISTS public.crediario_contratos_assertiva (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id text NOT NULL,
  cpf text,
  nome text,
  data_assinatura date,
  pdf_path text,
  status text,
  raw jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_contratos_assertiva_cpf ON public.crediario_contratos_assertiva (cpf);

ALTER TABLE public.crediario_contratos_assertiva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_contratos_assertiva_select" ON public.crediario_contratos_assertiva
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "crediario_contratos_assertiva_write" ON public.crediario_contratos_assertiva
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

-- ---------- Códigos de autorização ----------

CREATE TABLE IF NOT EXISTS public.crediario_codigos_autorizacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  criado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  usado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  usado_em timestamptz,
  venda_id uuid REFERENCES public.crediario_vendas(id) ON DELETE SET NULL,
  venda_nome text,
  venda_cpf text,
  empresa_nome text
);

ALTER TABLE public.crediario_codigos_autorizacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_codigos_autorizacao_select" ON public.crediario_codigos_autorizacao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "crediario_codigos_autorizacao_update" ON public.crediario_codigos_autorizacao
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "crediario_codigos_autorizacao_insert_delete" ON public.crediario_codigos_autorizacao
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role));

-- ---------- Relatórios diários de pagamentos por empresa ----------

CREATE TABLE IF NOT EXISTS public.crediario_relatorios_diarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  data_referencia date NOT NULL,
  total_pagamentos integer NOT NULL DEFAULT 0,
  valor_total numeric NOT NULL DEFAULT 0,
  pagamentos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pendente',
  concluido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crediario_relatorios_diarios_company ON public.crediario_relatorios_diarios (company_id, data_referencia);

CREATE TRIGGER crediario_relatorios_diarios_updated_at
  BEFORE UPDATE ON public.crediario_relatorios_diarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crediario_relatorios_diarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crediario_relatorios_diarios_select" ON public.crediario_relatorios_diarios
  FOR SELECT TO authenticated
  USING (public.crediario_company_scoped(company_id) OR has_role(auth.uid(), 'financeiro'::app_role));
CREATE POLICY "crediario_relatorios_diarios_write" ON public.crediario_relatorios_diarios
  FOR ALL TO authenticated
  USING (public.crediario_company_scoped(company_id))
  WITH CHECK (public.crediario_company_scoped(company_id));
