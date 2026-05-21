// Edge function: ssotica-sync
// Sincroniza Vendas (→ Renovações) e Contas a Receber (→ Cobranças) das lojas SSótica
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SSOTICA_BASE = "https://app.ssotica.com.br/api/v1/integracoes";
const MAX_WINDOW_DAYS = 30; // limite da API SSótica por janela
const SSOTICA_FETCH_TIMEOUT_MS = 45000;
// Histórico total: 96 meses (8 anos), processado em chunks de 6 meses
// para evitar timeout da edge function em lojas grandes (~7000 cobranças/ano).
// Antes: 6 meses × 16 chunks. Agora: 3 meses × 32 chunks (cada chunk ~50% mais rápido).
const MAX_HISTORY_DAYS = 2880; // 96 meses
const CHUNK_DAYS = 92;         // ~3 meses por chunk (usado pelo backfill histórico)
const COBRANCAS_LOOKBACK_DAYS = 730; // faixa histórica total coberta pelo ciclo incremental
const COBRANCAS_FUTURE_DAYS = 60; // pegar parcelas que vencem em breve
// 350s — bem abaixo do hard-limit do edge runtime (~400s) mas alto o
// suficiente para que lojas grandes (Parelhas/Caicó) consigam concluir
// contas_receber + vendas + reconcile mesmo quando a SSótica responde devagar.
const PER_INTEGRATION_TIMEOUT_MS = 350_000;
// 24 meses ÷ 8 fatias = ~3 meses por execução. Reduzido de 4 para 8 porque
// lojas grandes (Caicó, Jucurutu) estouravam o limite do runtime mesmo isoladas.
// Como o cron atual roda 4x por dia, percorremos as 8 fatias ao longo de 2 dias
// (em vez de deixar metade das fatias sem nunca rodar).
const INCREMENTAL_COBRANCAS_SLICES = 8;
const SSOTICA_INCREMENTAL_RUNS_PER_DAY = 4;
// 15 min: o heartbeat atualiza updated_at a cada 20s, então execuções vivas
// nunca se aproximam desse limite. Só execuções genuinamente mortas (runtime
// derrubado, sem heartbeat por >15 min) são marcadas como órfãs.
const RUNNING_SYNC_STALE_MINUTES = 15;
const BACKFILL_CLAIM_WINDOW_MS = RUNNING_SYNC_STALE_MINUTES * 60 * 1000;
const BACKFILL_HEARTBEAT_MS = 20 * 1000;
const BACKFILL_MAX_PARALLEL = 2;
const DIRECIONAMENTO_STATUS = "fazer_direcionamento_para_o_vendedor";

type AppRole = "admin" | "vendedor" | "gerente" | "financeiro";
type DispatchConfig = {
  url: string | null;
  auth: string | null;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + n);
  return nd;
}
function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

// Calcula o índice "lógico" da coluna a partir dos dias de atraso.
// 0 = "1 dia antes do vencimento" (dias === -1)
// 1 = "1 dia de atraso" (0 a 29 dias)
// 2 = 30 dias
// 3 = 31-44 dias (coluna 7)
// 4 = 45-59 (coluna 7 mensagem)
// 5 = 60 (coluna 8 ligação)
// 6 = 61-64 (coluna 9 negativação)
// 7 = 65-74 (coluna 10 receber informe)
// 8 = 75-89 (coluna 11 proposta)
// 9 = 90-104 (coluna 12 ligação tentativa)
// 10 = 105-119 (coluna 13 notificação extra-judicial)
// 11 = 120-134 (coluna 14 ligação informe judicial)
// 12 = 135-149 (coluna 15 enviar advogado / oferta negativação)
// 13 = 150-179 (coluna 15/16 enviar advogado)
// 14 = 180+ (coluna 16 ajuizar / ajuizados manual)
function diasParaIndiceLogico(dias: number): number {
  if (dias === -1) return 0;
  if (dias >= 0 && dias <= 29) return 1;
  if (dias === 30) return 2;
  if (dias >= 31 && dias <= 44) return 3;
  if (dias >= 45 && dias <= 59) return 4;
  if (dias === 60) return 5;
  if (dias >= 61 && dias <= 64) return 6;
  if (dias >= 65 && dias <= 74) return 7;
  if (dias >= 75 && dias <= 89) return 8;
  if (dias >= 90 && dias <= 104) return 9;
  if (dias >= 105 && dias <= 119) return 10;
  if (dias >= 120 && dias <= 134) return 11;
  if (dias >= 135 && dias <= 149) return 12;
  if (dias >= 150 && dias <= 179) return 13;
  return 14; // 180+
}

// A partir do índice "31 dias" (3) os cards ficam travados — só o fluxo manual
// (cobranca-flow-advance) avança a partir daí.
const LOCKED_LOGICAL_INDEX_FROM = 3;
// Índice da COLUNA "60 dias / ligação negativação" — para onde retornam os
// cards que estavam em colunas mais avançadas mas perderam a situação Negativado.
const LOGICAL_INDEX_COLUNA_8 = 5;
// Índice da COLUNA "31 dias" — limite de entrada automática.
const LOGICAL_INDEX_31_DIAS = 3;


// Mapeia dias desde a última compra para a key da coluna em crm_renovacao_statuses.
// Re-classifica sempre (a cada sync) para acompanhar a passagem do tempo.
function statusKeyForRenovacao(diasDesdeUltimaCompra: number | null): string {
  if (diasDesdeUltimaCompra === null) return "novo";        // sem data = informações insuficientes
  if (diasDesdeUltimaCompra < 365) return "em_contato";     // menos de 1 ano
  if (diasDesdeUltimaCompra < 730) return "agendado";       // 1 a 2 anos
  if (diasDesdeUltimaCompra < 1095) return "renovado";      // 2 a 3 anos
  return "mais_de_3_anos";                                  // 3+ anos
}

function getBrasiliaCycleSlot(date = new Date()): number {
  const br = new Date(date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  // O cron da SSótica roda 4x por dia (~6h). Antes usávamos o relógio dividido
  // em 8 slots de 3h, o que fazia apenas os slots ímpares rodarem (ex.: 04h,
  // 10h, 16h, 22h => 1,3,5,7) e metade da janela histórica nunca era visitada.
  // Agora calculamos o slot pela sequência real das execuções: 4 rodadas por dia,
  // avançando 1 slot por rodada. Assim as 8 fatias são cobertas em 2 dias sem
  // aumentar o volume por execução.
  const hoursPerRun = Math.max(1, Math.floor(24 / SSOTICA_INCREMENTAL_RUNS_PER_DAY));
  const runIndex = Math.min(
    SSOTICA_INCREMENTAL_RUNS_PER_DAY - 1,
    Math.floor(br.getHours() / hoursPerRun),
  );
  const brasiliaDaySerial = Math.floor(
    Date.UTC(br.getFullYear(), br.getMonth(), br.getDate()) / 86400000,
  );
  return ((brasiliaDaySerial * SSOTICA_INCREMENTAL_RUNS_PER_DAY) + runIndex) % INCREMENTAL_COBRANCAS_SLICES;
}

function getIncrementalCobrancaWindow(now = new Date()): { start: Date; end: Date; slot: number } {
  const slot = getBrasiliaCycleSlot(now);
  const sliceDays = Math.ceil(COBRANCAS_LOOKBACK_DAYS / INCREMENTAL_COBRANCAS_SLICES);
  const endOffset = slot * sliceDays;
  const startOffset = endOffset + sliceDays - 1;
  const end = slot === 0 ? addDays(now, COBRANCAS_FUTURE_DAYS) : addDays(now, -endOffset);
  const start = addDays(now, -startOffset);
  return { start, end, slot };
}

function getManualRecentCobrancaWindow(now = new Date()): { start: Date; end: Date } {
  return {
    start: addDays(now, -365),
    end: addDays(now, COBRANCAS_FUTURE_DAYS),
  };
}

function getDispatchConfig(req: Request): DispatchConfig {
  // Prefer internal URL for pg_net dispatch (avoids external proxies that may strip auth headers).
  // Set SUPABASE_INTERNAL_URL=http://supabase-kong:8000 in self-hosted deployments.
  const envInternalUrl = Deno.env.get("SUPABASE_INTERNAL_URL");
  const envPublicUrl = Deno.env.get("SUPABASE_PUBLIC_URL");
  const envUrl = Deno.env.get("SUPABASE_URL");
  const envAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const requestAuth = req.headers.get("authorization") ?? req.headers.get("Authorization");

  let requestUrl: string | null = null;
  try {
    const currentUrl = new URL(req.url);
    requestUrl = `${currentUrl.origin}/functions/v1/ssotica-sync`;
  } catch {
    requestUrl = null;
  }

  const baseUrl = envInternalUrl ?? envPublicUrl ?? envUrl;
  return {
    url: baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/functions/v1/ssotica-sync`
      : requestUrl,
    auth: envAnonKey ? `Bearer ${envAnonKey}` : requestAuth,
  };
}

// Quebra um intervalo em janelas de até 30 dias (limite SSótica)
function buildWindows(start: Date, end: Date): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cur = new Date(start);
  while (cur <= end) {
    const winEnd = addDays(cur, MAX_WINDOW_DAYS - 1);
    const finalEnd = winEnd > end ? end : winEnd;
    windows.push({ start: ymd(cur), end: ymd(finalEnd) });
    cur = addDays(finalEnd, 1);
  }
  return windows;
}

async function fetchSSotica(
  url: string,
  token: string,
): Promise<unknown> {
  // Retry com backoff exponencial para erros transientes (502/503/504/timeouts).
  // SSótica costuma devolver 502 Bad Gateway sob carga — esperar e tentar de novo resolve.
  const MAX_ATTEMPTS = 4;
  const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SSOTICA_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`SSótica ${res.status}: ${text.slice(0, 300)}`);
        if (TRANSIENT_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
          const waitMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
          console.warn(`[ssotica-sync] ${res.status} tentativa ${attempt}/${MAX_ATTEMPTS}, aguardando ${waitMs}ms...`);
          await new Promise((r) => setTimeout(r, waitMs));
          lastError = err;
          continue;
        }
        throw err;
      }
      return await res.json();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const normalizedError = timedOut
        ? new Error(`SSótica timeout após ${Math.round(SSOTICA_FETCH_TIMEOUT_MS / 1000)}s: ${url}`)
        : err;
      // Erros de rede (timeout, conexão) também merecem retry
      const isNetwork =
        timedOut ||
        normalizedError.name === "AbortError" ||
        normalizedError.message.includes("network") ||
        normalizedError.message.includes("timeout") ||
        normalizedError.message.includes("ECONN");
      if (isNetwork && attempt < MAX_ATTEMPTS) {
        const waitMs = 2000 * Math.pow(2, attempt - 1);
        console.warn(`[ssotica-sync] erro de rede tentativa ${attempt}/${MAX_ATTEMPTS}, aguardando ${waitMs}ms... (${normalizedError.message})`);
        await new Promise((r) => setTimeout(r, waitMs));
        lastError = normalizedError;
        continue;
      }
      throw normalizedError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("SSótica: falha após todas as tentativas");
}

interface Integration {
  id: string;
  company_id: string;
  cnpj: string;
  license_code: string | null;
  bearer_token: string;
  sync_status: string;
  updated_at?: string | null;
  initial_sync_done: boolean;
  last_sync_vendas_at: string | null;
  last_sync_receber_at: string | null;
  backfill_chunk_index: number;
  backfill_total_chunks: number;
  backfill_status: string; // 'idle' | 'running' | 'done' | 'error'
  backfill_started_at: string | null;
  backfill_next_run_at: string | null;
  backfill_phase?: string | null; // 'cr' | 'vendas' — etapa atual dentro do chunk
  backfill_scope?: string | null; // 'all' | 'cobrancas' | 'renovacoes' — escopo do backfill atual
}

// Descriptografa bearer_token e license_code (que ficam criptografados em repouso no banco).
// Tokens não criptografados (sem prefixo "enc:") passam sem alteração.
async function decryptIntegrations<T extends { bearer_token?: string | null; license_code?: string | null }>(
  supabase: any,
  list: T[],
): Promise<T[]> {
  for (const it of list) {
    if (it.bearer_token && it.bearer_token.startsWith("enc:")) {
      const { data } = await supabase.rpc("decrypt_secret", { _ciphertext: it.bearer_token });
      if (typeof data === "string") it.bearer_token = data;
    }
    if (it.license_code && it.license_code.startsWith("enc:")) {
      const { data } = await supabase.rpc("decrypt_secret", { _ciphertext: it.license_code });
      if (typeof data === "string") it.license_code = data;
    }
  }
  return list;
}

async function decryptIntegration<T extends { bearer_token?: string | null; license_code?: string | null }>(
  supabase: any,
  item: T | null,
): Promise<T | null> {
  if (!item) return item;
  await decryptIntegrations(supabase, [item]);
  return item;
}

function startBackfillHeartbeat(params: {
  supabase: any;
  integrationId: string;
  chunkIndex: number;
  phase: "cr" | "vendas";
}) {
  let stopped = false;

  const beat = async () => {
    if (stopped) return;
    try {
      const nowIso = new Date().toISOString();
      const leaseUntil = new Date(Date.now() + BACKFILL_CLAIM_WINDOW_MS).toISOString();
      const { error } = await params.supabase
        .from("ssotica_integrations")
        .update({
          sync_status: "running",
          backfill_status: "running",
          backfill_phase: params.phase,
          backfill_next_run_at: leaseUntil,
          updated_at: nowIso,
        })
        .eq("id", params.integrationId)
        .eq("backfill_chunk_index", params.chunkIndex)
        .eq("backfill_phase", params.phase)
        .eq("sync_status", "running")
        .neq("backfill_status", "done");

      if (error) {
        console.warn(`[ssotica-sync][backfill-heartbeat] empresa=${params.integrationId} chunk=${params.chunkIndex} fase=${params.phase} erro ao renovar lease: ${error.message}`);
      }
    } catch (error) {
      console.warn(`[ssotica-sync][backfill-heartbeat] empresa=${params.integrationId} chunk=${params.chunkIndex} fase=${params.phase} falha inesperada:`, error);
    }
  };

  const timer = setInterval(() => {
    void beat();
  }, BACKFILL_HEARTBEAT_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// Calcula a janela de datas de um chunk específico (chunk 0 = mais recente).
// chunk 0 → últimos 12 meses; chunk 1 → 12-24 meses atrás; ... ; chunk 7 → 84-96 meses atrás.
function chunkDateRange(chunkIndex: number, futureDays = 0): { start: Date; end: Date } {
  const today = new Date();
  const end = addDays(today, futureDays - chunkIndex * CHUNK_DAYS);
  const start = addDays(end, -(CHUNK_DAYS - 1));
  return { start, end };
}

type CompanyProfile = {
  user_id: string;
  full_name: string;
};

type CompanyRole = {
  user_id: string;
  role: AppRole;
};

type ExistingCobranca = {
  id: string;
  assigned_to: string | null;
  created_by?: string | null;
  scheduled_date?: string | null;
  status: string;
  valor: number | null;
  vencimento: string | null;
  dias_atraso?: number | null;
  data?: Record<string, unknown> | null;
  ssotica_company_id?: string | null;
  ssotica_parcela_id: number | null;
  ssotica_titulo_id?: number | null;
};

type ExistingRenovacao = {
  id: string;
  data?: Record<string, unknown> | null;
  data_ultima_compra: string | null;
  status: string;
  assigned_to: string | null;
  ssotica_venda_id?: number | null;
  valor?: number | null;
  scheduled_date?: string | null;
};

type StoredCobranca = {
  id: string;
  ssotica_parcela_id: number | null;
  ssotica_cliente_id: number | null;
  vencimento?: string | null;
};

// Normaliza um valor para usar nas APIs do SSótica.
// Para CNPJ: remove pontuação. Para código de licença: mantém como está.
function normalizeIdentifier(value: string): string {
  const raw = (value ?? "").trim();
  const onlyDigits = raw.replace(/\D/g, "");
  const isCnpj = !/[a-zA-Z]/.test(raw) && onlyDigits.length === 14;
  return isCnpj ? onlyDigits : raw;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSituacaoLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function getAjuizadoVariantFromSituacao(situacao: string): "ajuizado_saniely" | "ajuizado_navde" | null {
  const isJuridico =
    situacao.startsWith("ajuizado") ||
    situacao.startsWith("cobranca dr") ||
    situacao.startsWith("cobranca dra") ||
    situacao.startsWith("escritorio de cobranca") ||
    situacao.startsWith("escritorio cobranca");

  if (!isJuridico) return null;
  if (situacao.includes("saniely")) return "ajuizado_saniely";
  if (situacao.includes("navde")) return "ajuizado_navde";
  // Escritório de cobrança terceiro sem variante explícita → trata como Návde
  // (fallback comum de cobrança jurídica externa). Mantém o card em Cobrança.
  return "ajuizado_navde";
}

// Situação "Remover do Cobrança Dr. Návde" significa que o cliente SAIU da
// cobrança jurídica — a parcela voltou para o fluxo normal (não é dívida ativa
// por essa via). Tratamos como evento de saída para liberar o card se for o caso.
function isRemocaoCobrancaJuridica(situacao: string): boolean {
  return situacao.startsWith("remover do cobranca") || situacao.startsWith("remover cobranca");
}

function isSamePerson(nameA: unknown, nameB: unknown): boolean {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

async function syncContasReceber(
  supabase: any,
  integ: Integration,
  windowOverride?: { start: Date; end: Date },
  options?: { manualRecent?: boolean; fullSweep?: boolean },
): Promise<{ processed: number; created: number; updated: number; removed: number; chunks: number; clientesQuitados: number[] }> {
  // Normaliza "hoje" para meia-noite UTC do dia atual no fuso de Brasília (UTC-3).
  // Sem isso, após 21h de Brasília o `new Date()` em UTC já estaria no dia seguinte,
  // fazendo parcelas que vencem hoje aparecerem como "1 dia de atraso" ao invés de
  // "1 dia antes do vencimento".
  const nowBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(nowBR.getUTCFullYear(), nowBR.getUTCMonth(), nowBR.getUTCDate()));
  // Janela: no incremental processamos 1 fatia por rodada do ciclo de 24 meses,
  // para garantir que toda empresa conclua dentro do tempo do cron.
  // Quando há windowOverride (modo backfill), processa apenas o chunk indicado.
  // fullSweep: varre toda a janela histórica (96 meses) com a lógica de
  // deleção habilitada — usado no fim do backfill para limpar cards de
  // cobrança cujo cliente já não tem dívidas em aberto.
  const fullSweepWindow = !windowOverride && options?.fullSweep
    ? { start: addDays(today, -MAX_HISTORY_DAYS), end: addDays(today, COBRANCAS_FUTURE_DAYS) }
    : null;
  const isFullSweep = !!fullSweepWindow;
  const manualRecentWindow = !windowOverride && !fullSweepWindow && options?.manualRecent
    ? getManualRecentCobrancaWindow(today)
    : null;
  const incrementalWindow = windowOverride || manualRecentWindow || fullSweepWindow ? null : getIncrementalCobrancaWindow(today);
  const overallStart = windowOverride?.start ?? manualRecentWindow?.start ?? fullSweepWindow?.start ?? incrementalWindow!.start;
  const overallEnd = windowOverride?.end ?? manualRecentWindow?.end ?? fullSweepWindow?.end ?? incrementalWindow!.end;
  const isBackfillChunk = !!windowOverride;

  let processed = 0, created = 0, updated = 0, removed = 0;
  // Contadores de diagnóstico (logados ao final para depurar filtros)
  const skipped = {
    naoAtiva: 0,
    renegociada: 0,
    baixada: 0,
    cancelada: 0,
    estornada: 0,
    paga: 0,
    semVencimento: 0,
    naoEmAtraso: 0,
    semCliente: 0,
  };
  const situacoesVistas = new Map<string, number>();
  // Contas a Receber: usamos `cnpj=` (e não `empresa=<license_code>`), pois o
  // license_code é compartilhado entre lojas do mesmo grupo e o endpoint de
  // contas-a-receber só retorna as parcelas filtradas corretamente quando o
  // CNPJ específico da loja é informado. Sem isso, lojas "filhas" (ex.: Catolé
  // do Rocha) acabam retornando 0 parcelas e os boletos do cliente em mais de
  // uma loja não chegam ao CRM (impedindo a posterior consolidação cross-store).
  const cnpjParam = normalizeIdentifier(integ.cnpj);

  // Atribui novas cobranças à Brenda automaticamente (responsável padrão por cobranças)
  const { data: brendaProfile } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("full_name", "brenda%")
    .maybeSingle();
  const defaultAssignee: string | null = (brendaProfile as any)?.user_id ?? null;

  // Cache de colunas de cobrança ordenadas por position. Usadas para mapear
  // dias de atraso → coluna do funil sem keys hardcoded (o admin pode renomear).
  const { data: cobStatusRows } = await supabase
    .from("crm_cobranca_statuses")
    .select("key,label,position")
    .order("position", { ascending: true });
  const cobStatusList = (cobStatusRows ?? []) as Array<{ key: string; label: string; position: number }>;
  const cobStatusLabelByKey = new Map<string, string>(
    cobStatusList.map((s) => [s.key, s.label]),
  );

  // Helper: registra movimentação automática entre Renovação e Cobrança
  async function logTransition(params: {
    cliente_nome: string;
    from_module: "renovacao" | "cobranca";
    to_module: "renovacao" | "cobranca";
    to_status_key?: string | null;
    to_status_label?: string | null;
    source_record_id?: string | null;
    target_record_id?: string | null;
    ssotica_cliente_id?: number | null;
  }) {
    try {
      await supabase.from("crm_module_transition_logs").insert({
        cliente_nome: params.cliente_nome || "Cliente SSótica",
        from_module: params.from_module,
        to_module: params.to_module,
        to_status_key: params.to_status_key ?? null,
        to_status_label: params.to_status_label ?? null,
        source_record_id: params.source_record_id ?? null,
        target_record_id: params.target_record_id ?? null,
        ssotica_cliente_id: params.ssotica_cliente_id ?? null,
        company_id: integ.company_id,
        triggered_by: null,
        trigger_source: "auto",
      });
    } catch (e) {
      console.error("[transition-log] erro ao registrar:", e);
    }
  }

  // Carrega mapeamento de "situação SSÓtica" → coluna do funil, configurado pelo admin
  // na tela de Fluxo de Cobrança (1 dia antes do vencimento, 1 dia de atraso,
  // negativado Serasa, ajuizados, etc.).
  const situacaoMapping: Record<string, string> = {};
  try {
    const { data: mapRows } = await supabase
      .from("crm_cobranca_situacao_mapping")
      .select("situacao, crm_cobranca_statuses!inner(key)");
    for (const row of (mapRows || []) as any[]) {
      const key = row?.crm_cobranca_statuses?.key;
      if (row?.situacao && key) situacaoMapping[row.situacao] = key;
    }
  } catch (_e) {
    // tabela vazia/ausente — usa apenas position
  }

  // Resolve a key da coluna do funil pela posição lógica (0..14), respeitando
  // mapeamentos configuráveis na tela de Fluxo de Cobrança.
  // Prioridade:
  //   idx 0           → 1_dia_antes_vencimento
  //   idx 1, 2        → ate_30_dias_atraso (fallback: 1_dia_atraso para idx 1)
  //   idx 3..14       → mais_30_dias_sem_negativacao (se mapeado, sobrepõe a coluna por dias)
  function resolveColunaKeyByLogicalIndex(idx: number): string | null {
    if (idx === 0 && situacaoMapping["1_dia_antes_vencimento"]) return situacaoMapping["1_dia_antes_vencimento"];
    if ((idx === 1 || idx === 2) && situacaoMapping["ate_30_dias_atraso"]) return situacaoMapping["ate_30_dias_atraso"];
    if (idx === 1 && situacaoMapping["1_dia_atraso"]) return situacaoMapping["1_dia_atraso"];
    if (idx >= 3 && situacaoMapping["mais_30_dias_sem_negativacao"]) return situacaoMapping["mais_30_dias_sem_negativacao"];
    const col = cobStatusList[idx];
    return col?.key ?? cobStatusList[cobStatusList.length - 1]?.key ?? null;
  }
  function lockedEntryKey(): string {
    return resolveColunaKeyByLogicalIndex(LOGICAL_INDEX_31_DIAS) ?? cobStatusList[0]?.key ?? "";
  }
  const lockedKeys = new Set<string>();
  for (let i = LOCKED_LOGICAL_INDEX_FROM; i < cobStatusList.length; i++) {
    if (cobStatusList[i]?.key) lockedKeys.add(cobStatusList[i].key);
  }
  const colunasApos8 = new Set<string>();
  for (let i = LOGICAL_INDEX_COLUNA_8 + 1; i < cobStatusList.length; i++) {
    if (cobStatusList[i]?.key) colunasApos8.add(cobStatusList[i].key);
  }
  const coluna8Key = resolveColunaKeyByLogicalIndex(LOGICAL_INDEX_COLUNA_8) ?? lockedEntryKey();
  function clampToLockedEntryDyn(key: string): string {
    return lockedKeys.has(key) ? lockedEntryKey() : key;
  }
  function colunaKeyForDiasAtraso(dias: number): string {
    const idx = diasParaIndiceLogico(dias);
    return resolveColunaKeyByLogicalIndex(idx) ?? "";
  }

  // Coletamos IDs de parcelas que ainda estão em aberto/vencidas neste sync.
  // Usamos para detectar cobranças do banco que sumiram da API (foram pagas).
  const parcelasAtivasIds = new Set<number>();
  const parcelasInativasIds = new Set<number>(); // parcelas vistas pagas/canceladas/renegociadas/baixadas
  const clientesAfetados = new Set<number>();
  // Agrupa todas as parcelas em atraso por cliente para upsert único depois
  const parcelasPorCliente = new Map<number, { cliente: any; parcelas: any[]; hasNegativadoSerasa: boolean; hasAjuizado: boolean; ajuizadoVariant: string | null; hasEmAtraso: boolean }>();

  // Janela única (definida por overallStart/overallEnd) dividida em sub-janelas de 30 dias
  // por causa do limite da API SSótica.
  const windows = buildWindows(overallStart, overallEnd);
  for (const w of windows) {
    let page = 1;
    while (true) {
      const url =
        `${SSOTICA_BASE}/financeiro/contas-a-receber/periodo?cnpj=${encodeURIComponent(cnpjParam)}&inicio_periodo=${w.start}&fim_periodo=${w.end}&page=${page}&perPage=100`;
      const json = await fetchSSotica(url, integ.bearer_token) as {
        currentPage?: number;
        totalPages?: number;
        data?: any[];
      };
      const items: any[] = json.data ?? [];
      if (items.length === 0) break;

      for (const parcela of items) {
        processed++;
        // Normaliza situação: remove acentos, lowercase, troca espaço/underscore
        const situacaoRaw = String(parcela.situacao ?? parcela["situação"] ?? "");
        const situacao = normalizeSituacaoLabel(situacaoRaw);
        situacoesVistas.set(situacao, (situacoesVistas.get(situacao) ?? 0) + 1);

        // ⚠️ REGRA: puxamos para o CRM parcelas com situação "Em atraso",
        // "Em aberto", "Vencido", "A vencer" (e variantes), além dos casos
        // especiais "Negativado Serasa" e "Ajuizado(A) Saniely / Návde" que
        // têm coluna fixa. Parcelas com diasAtraso < 31 ficam nas colunas
        // anteriores (pendente / em_cobranca / 5 dias / atrasado / 30 dias)
        // conforme o boleto mais antigo. Ao chegar em 31 dias travam e seguem
        // o fluxo manual configurado.
        const ajuizadoVariant = getAjuizadoVariantFromSituacao(situacao);
        const isAjuizado = !!ajuizadoVariant;
        const isNegativadoSerasa =
          situacao.startsWith("negativado") && situacao.includes("serasa");
        const isEmAtraso =
          situacao === "em atraso" ||
          situacao === "atrasado" ||
          situacao === "atrasada";
        const isEmAberto =
          situacao === "em aberto" ||
          situacao === "aberto" ||
          situacao === "aberta";
        const isVencido =
          situacao === "vencido" ||
          situacao === "vencida";
        const isAVencer =
          situacao === "a vencer" ||
          situacao === "avencer" ||
          situacao === "pendente";

        // ⚠️ Conforme a documentação oficial da SSótica (Contas a Receber),
        // o campo "situação" retorna "em aberto" como o status PADRÃO de uma
        // parcela ainda devida (não paga, não cancelada). "Em atraso" é apenas
        // um label derivado do vencimento — a API normalmente devolve "em aberto"
        // tanto para parcelas a vencer quanto vencidas. Portanto "em aberto"
        // DEVE ser tratada como ATIVA. A diferenciação entre "a vencer" e
        // "atrasada" é feita depois pelo cálculo de diasAtraso.
        const isAtiva =
          isEmAberto || isEmAtraso || isVencido || isAVencer ||
          isNegativadoSerasa || isAjuizado;

        const renegociacaoObj = parcela.renegociacao ?? parcela.renegociacao_info ?? null;
        const temObjetoRenegociacao =
          !!renegociacaoObj &&
          typeof renegociacaoObj === "object" &&
          !Array.isArray(renegociacaoObj) &&
          (renegociacaoObj.id != null || renegociacaoObj.valor_renegociacao != null);
        const foiRenegociada = situacao.startsWith("renegoc") || temObjetoRenegociacao;

        // Negativado SERASA / Ajuizado(a) Saniely / Návde = dívida AINDA ATIVA.
        // A SSótica pode marcar cancelado_em/baixado_em/estornado_em quando
        // negativa ou ajuíza a parcela, mas a dívida continua válida e o
        // cliente deve permanecer na cobrança na coluna correspondente.
        const isNegativada = isNegativadoSerasa || isAjuizado;

        const foiBaixada = !isNegativada && !!parcela.baixado_em;
        const foiCancelada = !isNegativada && !!parcela.cancelado_em;
        const foiEstornada = !isNegativada && !!parcela.estornado_em;
        const dataPagamento = parcela.data_pagamento ?? parcela.dataPagamento ?? null;
        const valorRecebido = Number(parcela.valor_recebido ?? parcela.valorRecebido ?? 0);
        const valorParcela = Number(parcela.valor ?? 0);
        const foiPaga =
          !isNegativada && (
            !!dataPagamento ||
            situacao === "pago" ||
            situacao === "paga" ||
            situacao === "quitado" ||
            situacao === "quitada" ||
            situacao === "liquidado" ||
            situacao === "liquidada" ||
            (valorParcela > 0 && valorRecebido >= valorParcela)
          );

        if (!isAtiva) skipped.naoAtiva++;
        else if (foiRenegociada) skipped.renegociada++;
        else if (foiBaixada) skipped.baixada++;
        else if (foiCancelada) skipped.cancelada++;
        else if (foiEstornada) skipped.estornada++;
        else if (foiPaga) skipped.paga++;

        const isInativa =
          !isAtiva || foiRenegociada || foiBaixada || foiCancelada || foiEstornada || foiPaga;

        if (isInativa) {
          const cliInativa = parcela.titulo?.cliente ?? parcela.cliente ?? {};
          if (cliInativa?.id) clientesAfetados.add(Number(cliInativa.id));
          if (parcela.id) parcelasInativasIds.add(Number(parcela.id));
          continue;
        }

        const vencimento = parcela.vencimento as string | null;
        if (!vencimento) { skipped.semVencimento++; continue; }
        const vencDate = new Date(vencimento + "T00:00:00Z");
        const diasAtraso = daysBetween(vencDate, today);

        // Aceitamos diasAtraso negativo (parcela "a vencer" / pendente) — vai
        // para a coluna "pendente". Casos especiais (Negativado Serasa /
        // Ajuizado) entram independente de diasAtraso (coluna fixa).
        // ⚠️ REGRA: parcelas que ainda faltam mais de 1 dia para vencer
        // (diasAtraso <= -2) NÃO entram na cobrança como parcela "ativa", a
        // menos que o cliente tenha outras parcelas em atraso ou seja caso
        // especial. Isso evita que vendas recém-feitas apareçam na coluna
        // "1 Dia antes do vencimento" semanas/meses antes do vencimento.
        if (diasAtraso <= -2 && !isNegativadoSerasa && !isAjuizado) {
          // Marca como "vista" para não ser apagada como pago, mas não vira card.
          if (parcela.id) parcelasInativasIds.add(Number(parcela.id));
          const cliFut = parcela.titulo?.cliente ?? parcela.cliente ?? {};
          if (cliFut?.id) clientesAfetados.add(Number(cliFut.id));
          continue;
        }

        if (parcela.id) parcelasAtivasIds.add(Number(parcela.id));

        const cliente = parcela.titulo?.cliente ?? parcela.cliente ?? {};
        if (!cliente?.id) { skipped.semCliente++; continue; }
        clientesAfetados.add(Number(cliente.id));

        const clienteIdNum = Number(cliente.id);
        let bucket = parcelasPorCliente.get(clienteIdNum);
        if (!bucket) {
          bucket = { cliente, parcelas: [], hasNegativadoSerasa: false, hasAjuizado: false, ajuizadoVariant: null, hasEmAtraso: false };
          parcelasPorCliente.set(clienteIdNum, bucket);
        }
        if (isNegativadoSerasa) bucket.hasNegativadoSerasa = true;
        if (isEmAtraso) bucket.hasEmAtraso = true;
        if (isAjuizado) {
          bucket.hasAjuizado = true;
          if (!bucket.ajuizadoVariant) {
            bucket.ajuizadoVariant = ajuizadoVariant;
          }
        }
        // Dedup: a API SSótica pode retornar a mesma parcela em múltiplas janelas/páginas.
        // Evita acumular duplicatas que inflariam o valor total e confundiriam a UI.
        const parcelaIdNum = parcela.id ? Number(parcela.id) : null;
        if (parcelaIdNum && bucket.parcelas.some((p: any) => p.parcela_id === parcelaIdNum)) {
          continue;
        }
        bucket.parcelas.push({
          parcela_id: parcela.id ? Number(parcela.id) : null,
          titulo_id: parcela.titulo?.id ? Number(parcela.titulo.id) : null,
          numero_parcela: parcela.numero_parcela ?? null,
          vencimento,
          dias_atraso: diasAtraso,
          valor: Number(parcela.valor_reajustado ?? parcela.valor_original ?? 0),
          situacao: situacaoRaw,
          forma_pagamento: parcela.forma_pagamento ?? "",
          numero_documento: parcela.titulo?.numero_documento ?? "",
          descricao: parcela.titulo?.descricao ?? "",
          boleto_nosso_numero: parcela.boleto?.nosso_numero ?? null,
          ssotica_raw: parcela,
        });
      }

      const totalPages = json.totalPages ?? 1;
      if (page >= totalPages) break;
      page++;
    }
  }
  const chunksProcessed = 1;
  const allowMissingAsPaid = !!manualRecentWindow;
  let removedByDirectEvidence = 0;
  let removedByAbsence = 0;
  console.log(`[ssotica-sync][cobrancas] empresa=${integ.company_id} janela=${ymd(overallStart)}→${ymd(overallEnd)} processed=${processed} clientes_em_atraso=${parcelasPorCliente.size} backfill_chunk=${isBackfillChunk}${manualRecentWindow ? " manual_recent=true" : incrementalWindow ? ` slot=${incrementalWindow.slot + 1}/${INCREMENTAL_COBRANCAS_SLICES}` : ""}`);

  // Janela atual em formato YYYY-MM-DD para decidir quais parcelas existentes
  // foram efetivamente revisadas neste slot (e portanto podem ser substituídas).
  // Parcelas FORA dessa janela não foram consultadas agora — devem ser preservadas
  // do que já estava no banco para evitar perder dados entre slots incrementais.
  const windowStartStr = ymd(overallStart);
  const windowEndStr = ymd(overallEnd);
  const isParcelaInWindow = (venc: string | null | undefined): boolean => {
    if (!venc) return false;
    const v = String(venc).slice(0, 10);
    return v >= windowStartStr && v <= windowEndStr;
  };
  const parcelaKey = (p: any): string =>
    p?.parcela_id != null
      ? `pid:${p.parcela_id}`
      : `tit:${p?.titulo_id ?? ""}-num:${p?.numero_parcela ?? ""}-venc:${p?.vencimento ?? ""}`;

  // ===== Upsert por cliente: 1 card com a lista de TODAS as parcelas em atraso =====
  for (const [clienteIdNum, bucket] of parcelasPorCliente.entries()) {
    const { cliente, parcelas, hasNegativadoSerasa, hasAjuizado, ajuizadoVariant, hasEmAtraso } = bucket;

    // Procura primeiro card da PRÓPRIA loja. Se não existir, busca card consolidado
    // em OUTRA loja para o mesmo cliente — assim evitamos o flap onde a consolidação
    // cross-store deletava o card da loja perdedora a cada ciclo, e a sync por loja
    // criava um novo no ciclo seguinte (loop "criado → excluído → criado…").
    const { data: existingSameStore } = await supabase
      .from("crm_cobrancas")
      .select("id, assigned_to, created_by, scheduled_date, status, valor, vencimento, dias_atraso, data, ssotica_company_id")
      .eq("ssotica_cliente_id", clienteIdNum)
      .eq("ssotica_company_id", integ.company_id)
      .maybeSingle();

    let existingCobranca = existingSameStore as ExistingCobranca | null;
    if (!existingCobranca) {
      const { data: existingOtherStore } = await supabase
        .from("crm_cobrancas")
        .select("id, assigned_to, created_by, scheduled_date, status, valor, vencimento, dias_atraso, data, ssotica_company_id")
        .eq("ssotica_cliente_id", clienteIdNum)
        .neq("ssotica_company_id", integ.company_id)
        .order("vencimento", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingOtherStore) {
        existingCobranca = existingOtherStore as ExistingCobranca;
      }
    }

    // ===== MERGE com parcelas já existentes no banco =====
    // Como o sync incremental cobre apenas ~92 dias por slot, parcelas de outros
    // períodos do histórico (24 meses) precisam ser preservadas. Removemos do
    // banco SOMENTE as parcelas cujo vencimento caiu DENTRO da janela atual e
    // que não voltaram nesta execução (provavelmente foram pagas/baixadas).
    // Parcelas FORA da janela atual ficam intactas até o slot que as cobre rodar.
    const novasKeys = new Set(parcelas.map(parcelaKey));
    const existingParcelas = ((existingCobranca?.data as any)?.parcelas_atrasadas ?? []) as any[];
    const currentCompany = String(integ.company_id);
    const preservadas = existingParcelas.filter((p) => {
      const k = parcelaKey(p);
      // Se já vem nas novas, ignora (será substituída pela versão fresca).
      if (novasKeys.has(k)) return false;
      // Parcela pertence a OUTRA loja (consolidação cross-store) → SEMPRE preserva.
      // O sync desta loja não tem visibilidade das parcelas de outras lojas e
      // não pode decidir removê-las. A consolidação cross-store cuidará disso.
      const parcelaCompany = p?.ssotica_company_id ? String(p.ssotica_company_id) : null;
      if (parcelaCompany && parcelaCompany !== currentCompany) return true;
      // Fora da janela atual → preserva (não temos evidência atualizada).
      if (!isParcelaInWindow(p?.vencimento)) return true;
      // Dentro da janela: se a API retornou status pago/cancelado/etc para essa
      // parcela, removemos. Se não foi vista de jeito nenhum, também removemos
      // (estava na janela revisada e sumiu).
      return false;
    });
    // Marca as parcelas novas com a loja atual para que futuras sincronizações
    // de OUTRAS lojas não as removam por engano.
    const parcelasComLoja = parcelas.map((p) => ({ ...p, ssotica_company_id: currentCompany }));
    const parcelasMerged = [...preservadas, ...parcelasComLoja];
    // Ordena parcelas pelo vencimento mais antigo primeiro
    parcelasMerged.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
    const maisAntiga = parcelasMerged[0];
    const totalAtraso = parcelasMerged.reduce((s, p) => s + Number(p.valor ?? 0), 0);

    // Recalcula flags especiais considerando TODAS as parcelas (preservadas + novas)
    const hasNegativadoSerasaMerged = hasNegativadoSerasa || parcelasMerged.some((p) => {
      const s = String(p?.situacao ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return s.startsWith("negativado") && s.includes("serasa");
    });
    const hasAjuizadoMerged = hasAjuizado || parcelasMerged.some((p) => !!getAjuizadoVariantFromSituacao(normalizeSituacaoLabel(p?.situacao ?? "")));
    let ajuizadoVariantMerged: string | null = ajuizadoVariant;
    if (hasAjuizadoMerged && !ajuizadoVariantMerged) {
      for (const p of parcelasMerged) {
        const variant = getAjuizadoVariantFromSituacao(normalizeSituacaoLabel(p?.situacao ?? ""));
        if (variant) { ajuizadoVariantMerged = variant; break; }
      }
    }
    const hasEmAtrasoMerged = hasEmAtraso || parcelasMerged.some((p) => {
      const s = String(p?.situacao ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return s === "em atraso" || s === "atrasado" || s === "atrasada";
    });

    // Regra de coluna (configurável via tabela crm_cobranca_situacao_mapping):
    //  • Ajuizado(A) Saniely / Návde → coluna mapeada (fallback: última coluna)
    //  • Negativado Serasa            → coluna mapeada (fallback: COLUNA 10 por position)
    //  • Demais (a vencer / vencido)  → escala por dias com cap em "31 dias"
    //
    // Observação: a situação "Em atraso" não é mais um caso especial — a coluna
    // de destino vem do cálculo por dias_atraso (ver mapping configurável de
    // "1 dia antes do vencimento" e "1 dia de atraso" na tela de Fluxo).
    let colunaKeyAlvo: string;
    if (hasAjuizadoMerged) {
      const variantKey = ajuizadoVariantMerged ?? "ajuizado_saniely";
      colunaKeyAlvo = situacaoMapping[variantKey]
        ?? situacaoMapping["ajuizado_saniely"]
        ?? cobStatusList[cobStatusList.length - 1]?.key
        ?? "";
    } else if (hasNegativadoSerasaMerged) {
      colunaKeyAlvo = situacaoMapping["negativado_serasa"]
        ?? cobStatusList[7]?.key
        ?? coluna8Key;
    } else {
      colunaKeyAlvo = clampToLockedEntryDyn(colunaKeyForDiasAtraso(maisAntiga.dias_atraso));
    }

    const telefone = cliente.telefone_principal ?? cliente.telefone ?? "";
    const documento = cliente.documento ?? cliente.cpf_cnpj ?? cliente.cpf ?? "";
    const data = {
      nome: cliente.nome ?? "Cliente SSótica",
      telefone,
      documento,
      cpf: documento,
      email: cliente.email_principal ?? cliente.email ?? "",
      numero_documento: maisAntiga.numero_documento,
      descricao: maisAntiga.descricao,
      numero_parcela: maisAntiga.numero_parcela,
      forma_pagamento: maisAntiga.forma_pagamento,
      boleto_nosso_numero: maisAntiga.boleto_nosso_numero,
      // Lista completa de parcelas em atraso desse cliente (consumida pela aba Parcelas no front)
      parcelas_atrasadas: parcelasMerged,
      total_atraso: totalAtraso,
      qtd_parcelas_atrasadas: parcelasMerged.length,
      situacao_especial: hasAjuizadoMerged ? "ajuizado" : hasNegativadoSerasaMerged ? "negativado_serasa" : null,
      ssotica_raw: maisAntiga.ssotica_raw,
    };

    // Decide o status final que será gravado:
    //  • Casos especiais (Serasa / Ajuizado) sempre forçam a coluna fixa.
    //  • Card já existente em coluna travada (>= COLUNA 9) NÃO é movido pelo
    //    sync — quem move dali é o fluxo manual (cobranca-flow-advance).
    let colunaKey = colunaKeyAlvo;
    if (existingCobranca && !hasAjuizadoMerged && !hasNegativadoSerasaMerged) {
      if (lockedKeys.has(existingCobranca.status)) {
        // Cards após a COLUNA 8 (60 dias) só podem permanecer lá se houver
        // parcela "Negativado Serasa". Como não há, voltam para a COLUNA 8
        // e aguardam tratativa da Brenda.
        colunaKey = colunasApos8.has(existingCobranca.status)
          ? coluna8Key
          : existingCobranca.status; // mantém a coluna atual (travada)
      }
    }

    let targetCobrancaId = existingCobranca?.id ?? null;

    if (existingCobranca) {
      const cobrancaMudou =
        existingCobranca.ssotica_parcela_id !== (maisAntiga.parcela_id ?? null) ||
        (existingCobranca as any).ssotica_titulo_id !== (maisAntiga.titulo_id ?? null) ||
        Number(existingCobranca.valor ?? 0) !== totalAtraso ||
        (existingCobranca.vencimento ?? null) !== (maisAntiga.vencimento ?? null) ||
        Number((existingCobranca as any).dias_atraso ?? 0) !== Number(maisAntiga.dias_atraso ?? 0) ||
        existingCobranca.status !== colunaKey ||
        ((existingCobranca as any).scheduled_date ?? null) !== (maisAntiga.vencimento ?? null) ||
        stableStringify((existingCobranca as any).data ?? null) !== stableStringify(data);

      if (cobrancaMudou) {
        const { error: updateCobErr } = await supabase
          .from("crm_cobrancas")
          .update({
            ssotica_parcela_id: maisAntiga.parcela_id,
            ssotica_titulo_id: maisAntiga.titulo_id,
            data,
            valor: totalAtraso,
            vencimento: maisAntiga.vencimento,
            dias_atraso: maisAntiga.dias_atraso,
            status: colunaKey,
            scheduled_date: maisAntiga.vencimento,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingCobranca.id);

        if (updateCobErr) {
          throw new Error(`Falha ao atualizar cobrança ${existingCobranca.id} do cliente ${clienteIdNum}: ${updateCobErr.message}`);
        }

        updated++;
      }
    } else {
      const { data: insertedCob, error: insertCobErr } = await supabase.from("crm_cobrancas").insert({
        company_id: integ.company_id,
        ssotica_parcela_id: maisAntiga.parcela_id,
        ssotica_titulo_id: maisAntiga.titulo_id,
        ssotica_cliente_id: clienteIdNum,
        ssotica_company_id: integ.company_id,
        assigned_to: defaultAssignee,
        data,
        valor: totalAtraso,
        vencimento: maisAntiga.vencimento,
        dias_atraso: maisAntiga.dias_atraso,
        status: colunaKey,
        scheduled_date: maisAntiga.vencimento,
      }).select("id").maybeSingle();

      if (insertCobErr) {
        throw new Error(`Falha ao criar cobrança do cliente ${clienteIdNum}: ${insertCobErr.message}`);
      }

      targetCobrancaId = (insertedCob as any)?.id ?? null;
      created++;

      // Verifica se o cliente vinha de Renovação ANTES de logar
      const { data: renPreCheck } = await supabase
        .from("crm_renovacoes")
        .select("id")
        .eq("ssotica_cliente_id", clienteIdNum)
        .eq("ssotica_company_id", integ.company_id)
        .maybeSingle();

      // Só loga "criação direta" (none → cobranca) se NÃO vinha de Renovação.
      // Se vinha, o log de transição (renovacao → cobranca) será gerado abaixo.
      if (!renPreCheck) {
        await supabase.from("crm_module_transition_logs").insert({
          cliente_nome: String((data as any)?.nome ?? "Cliente SSótica"),
          from_module: "none",
          to_module: "cobranca",
          to_status_key: colunaKey,
          to_status_label: cobStatusLabelByKey.get(colunaKey) ?? colunaKey,
          target_record_id: (insertedCob as any)?.id ?? null,
          ssotica_cliente_id: clienteIdNum,
          company_id: integ.company_id,
          triggered_by: null,
          trigger_source: "auto",
        });
      }
    }

    // Cliente entrou em cobrança → remove da Renovação (se estiver lá) e registra log de transição
    const { data: renovacaoExistente } = await supabase
      .from("crm_renovacoes")
      .select("id")
      .eq("ssotica_cliente_id", clienteIdNum)
      .eq("ssotica_company_id", integ.company_id)
      .maybeSingle();

    await supabase
      .from("crm_renovacoes")
      .delete()
      .eq("ssotica_cliente_id", clienteIdNum)
      .eq("ssotica_company_id", integ.company_id);

    if (renovacaoExistente) {
      await logTransition({
        cliente_nome: data.nome,
        from_module: "renovacao",
        to_module: "cobranca",
        to_status_key: colunaKey,
        to_status_label: cobStatusLabelByKey.get(colunaKey) ?? colunaKey,
        source_record_id: (renovacaoExistente as any).id,
        target_record_id: targetCobrancaId,
        ssotica_cliente_id: clienteIdNum,
      });
    }
  }

  // ===== Pós-processamento: remover cards de clientes que não têm mais nenhuma parcela em atraso =====
  // ATENÇÃO: pulamos este passo em modo backfill (chunk antigo) porque vimos só 12 meses
  // específicos da API — não dá pra concluir que uma parcela "sumiu" baseado numa janela parcial.
  // O delete só roda no sync incremental (que cobre 12 meses recentes + 60 dias futuros).
  const clientesQuitadosSet = new Set<number>();
  if (!isBackfillChunk) {
    const { data: cobrancasNoBanco } = await supabase
      .from("crm_cobrancas")
      .select("id, ssotica_parcela_id, ssotica_cliente_id, vencimento, data, assigned_to")
      .eq("ssotica_company_id", integ.company_id)
      .not("ssotica_cliente_id", "is", null);
    const storedCobrancas = (cobrancasNoBanco ?? []) as (StoredCobranca & { data?: any })[];

    // Cache de labels das colunas de Renovação (para registrar log da transição reversa)
    const { data: renStatusRowsForCob } = await supabase
      .from("crm_renovacao_statuses")
      .select("key,label");
    const renStatusLabelByKeyForCob = new Map<string, string>(
      (renStatusRowsForCob ?? []).map((s: any) => [s.key, s.label]),
    );

    // Pool de vendedores ATIVOS da empresa para fallback round-robin
    // (mesma lógica usada em syncVendas) — quando a cobrança é quitada e
    // criamos um card de Renovação, garantimos um responsável.
    const { data: cobCompanyProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("company_id", integ.company_id);
    const cobCompanyUserIds = (cobCompanyProfiles ?? []).map((p: any) => p.user_id);
    const { data: cobCompanyRoles } = cobCompanyUserIds.length > 0
      ? await supabase.from("user_roles").select("user_id, role").in("user_id", cobCompanyUserIds)
      : { data: [] as Array<{ user_id: string; role: AppRole }> };
    const cobRoleByUserId = new Map<string, AppRole>(
      (cobCompanyRoles ?? []).map((r: any) => [r.user_id, r.role as AppRole]),
    );
    const cobVendedoresPool = (cobCompanyProfiles ?? [])
      .filter((p: any) => cobRoleByUserId.get(p.user_id) === "vendedor")
      .map((p: any) => p.user_id as string)
      .sort();
    const cobManagerUserId = (cobCompanyProfiles ?? []).find(
      (p: any) => cobRoleByUserId.get(p.user_id) === "gerente",
    )?.user_id ?? null;

    if (storedCobrancas.length > 0) {
      for (const cob of storedCobrancas) {
        const parcelaId = cob.ssotica_parcela_id ? Number(cob.ssotica_parcela_id) : null;
        const parcelasDoCard = Array.isArray((cob as any)?.data?.parcelas_atrasadas)
          ? ((cob as any).data.parcelas_atrasadas as any[])
          : [];
        const parcelasDaLojaAtual = parcelasDoCard.filter((p) => {
          const parcelaCompanyId = p?.ssotica_company_id ? String(p.ssotica_company_id) : String(integ.company_id);
          return parcelaCompanyId === String(integ.company_id);
        });
        const hasParcelasOutraLoja = parcelasDoCard.some((p) => {
          const parcelaCompanyId = p?.ssotica_company_id ? String(p.ssotica_company_id) : String(integ.company_id);
          return parcelaCompanyId !== String(integ.company_id);
        });
        const parcelaIdsDoCard = Array.from(new Set([
          ...(parcelaId ? [parcelaId] : []),
          ...parcelasDaLojaAtual
            .map((p) => (p?.parcela_id != null ? Number(p.parcela_id) : null))
            .filter((id): id is number => Number.isFinite(id) && id > 0),
        ]));
        const clienteId = Number(cob.ssotica_cliente_id);
        const parcelasConhecidasDaLoja = parcelasDaLojaAtual.length > 0
          ? parcelasDaLojaAtual
          : (cob.vencimento ? [{ vencimento: cob.vencimento }] : []);
        const todasParcelasDaLojaNaJanela = parcelasConhecidasDaLoja.length > 0
          && parcelasConhecidasDaLoja.every((p) => isParcelaInWindow(p?.vencimento ?? null));

        // Cliente AINDA tem parcelas em atraso na janela atual → mantém o card
        if (parcelasPorCliente.has(clienteId)) continue;

        // Defesa extra: se QUALQUER parcela deste card apareceu como ativa nesta
        // sync, segura (race condition entre páginas / card consolidado com mais
        // de uma parcela em atraso).
        if (parcelaIdsDoCard.some((id) => parcelasAtivasIds.has(id))) continue;

        // CRÍTICO: só deleta se TEMOS EVIDÊNCIA DIRETA de que TODAS as parcelas
        // conhecidas desse card foram retornadas como pagas/canceladas/
        // renegociadas/baixadas. Isso cobre cards cujo ssotica_parcela_id ficou
        // desatualizado, mas a lista interna de parcelas_atrasadas já reflete o
        // conjunto real de parcelas do lead.
        // Se alguma parcela conhecida não foi vista como inativa nesta janela,
        // NÃO deletamos — preferimos manter um falso positivo do que migrar errado.
        const hasDirectQuitacaoEvidence =
          parcelaIdsDoCard.length > 0 &&
          parcelaIdsDoCard.every((id) => parcelasInativasIds.has(id));

        // ⚠️ REGRA DO NEGÓCIO: o card sai da cobrança quando:
        //  1) Temos EVIDÊNCIA DIRETA (situação paga/renegociada/em aberto/
        //     baixada/cancelada/estornada retornada pela API), OU
        //  2) TODAS as parcelas conhecidas desse card têm vencimento DENTRO
        //     da janela que acabamos de consultar e NENHUMA delas voltou —
        //     a SSótica costuma simplesmente remover parcelas pagas da
        //     resposta em vez de devolvê-las com status "pago", então a
        //     ausência dentro de uma janela revisada é evidência confiável.
        //     Esse caminho NÃO roda em backfill (janela parcial) — apenas
        //     em sync incremental ou manualRecent.
        const allowAbsenceAsPaid = (!isBackfillChunk) &&
          parcelasConhecidasDaLoja.length > 0 &&
          todasParcelasDaLojaNaJanela &&
          !hasParcelasOutraLoja;

        // 3) Em modo fullSweep (96 meses, fim do backfill) OU manualRecent
        //    (365 dias + 60 futuros, botão "Sincronizar agora"), qualquer card
        //    cujo cliente NÃO apareça com nenhuma parcela ativa em toda a
        //    janela é considerado quitado. Cobre cards antigos cujas parcelas
        //    a SSótica já removeu da resposta.
        const allowEmptyClientAsPaid = isFullSweep || !!manualRecentWindow;

        if (!hasDirectQuitacaoEvidence && !allowAbsenceAsPaid && !allowEmptyClientAsPaid) continue;

        // OK, evidência confirmada de quitação DESTA parcela: remove só este card.
        const cobData = (cob as any).data ?? {};
        const clienteNome = String(cobData?.nome ?? cobData?.ssotica_raw?.titulo?.cliente?.nome ?? "Cliente SSótica");
        const telefone = String(cobData?.telefone ?? "");
        const documento = String(cobData?.documento ?? cobData?.cpf ?? "");
        const email = String(cobData?.email ?? "");

        await supabase.from("crm_cobrancas").delete().eq("id", cob.id);
        removed++;
        if (hasDirectQuitacaoEvidence) removedByDirectEvidence++;
        else removedByAbsence++;

        // ⚠️ IMPORTANTE: o cliente pode ter OUTRAS parcelas em aberto (mais
        // antigas ou em outros cards). Só consideramos "quitado de verdade"
        // — e portanto candidato a voltar para Renovação — se NÃO existir
        // mais nenhum card de cobrança ativa para esse cliente nesta loja.
        const { data: cobrancasRestantes } = await supabase
          .from("crm_cobrancas")
          .select("id")
          .eq("ssotica_cliente_id", clienteId)
          .eq("ssotica_company_id", integ.company_id)
          .not("status", "in", "(pago,cancelado)")
          .limit(1);

        if (cobrancasRestantes && cobrancasRestantes.length > 0) {
          // Ainda há parcelas em aberto desse cliente → mantém em Cobrança,
          // não cria Renovação e não loga a transição.
          continue;
        }

        clientesQuitadosSet.add(clienteId);

        // Log: exclusão automática do card de cobrança (cliente quitou TUDO)
        await supabase.from("crm_module_transition_logs").insert({
          cliente_nome: clienteNome,
          from_module: "cobranca",
          to_module: "none",
          to_status_key: null,
          to_status_label: null,
          source_record_id: cob.id,
          ssotica_cliente_id: clienteId,
          company_id: integ.company_id,
          triggered_by: null,
          trigger_source: "auto",
        });

        // Verifica se já existe Renovação desse cliente; se não, cria com base no que sabemos
        const { data: jaTemRen } = await supabase
          .from("crm_renovacoes")
          .select("id")
          .eq("ssotica_cliente_id", clienteId)
          .eq("ssotica_company_id", integ.company_id)
          .maybeSingle();

        if (!jaTemRen) {
          // Resolve responsável: prioriza vendedor que já atendeu o cliente
          // (assigned_to da cobrança quitada se for vendedor da loja) e cai
          // para round-robin estável entre vendedores ativos da empresa.
          // Último fallback: gerente da loja.
          const cobAssignedTo = (cob as any).assigned_to as string | null | undefined;
          const cobAssignedRole = cobAssignedTo ? cobRoleByUserId.get(cobAssignedTo) : null;
          const preserveCobVendedor = cobAssignedRole === "vendedor";
          const fallbackVendedor = cobVendedoresPool.length > 0
            ? cobVendedoresPool[Math.abs(clienteId) % cobVendedoresPool.length]
            : null;
          const resolvedAssignedTo: string | null = preserveCobVendedor
            ? cobAssignedTo!
            : (fallbackVendedor ?? cobManagerUserId ?? null);

          // Tenta extrair data da última receita/venda dos dados já armazenados
          // na cobrança (preenchidos pelo sync anterior). Se não houver, deixa
          // null — o próximo syncVendas/syncOS vai reclassificar com a data real.
          const dataReceita: string | null =
            (cobData?.data_ultima_receita as string | undefined) ??
            (cobData?.ssotica_raw?.data_ultima_receita as string | undefined) ??
            null;
          const dataVenda: string | null =
            (cobData?.data_ultima_venda as string | undefined) ??
            (cobData?.data_ultima_compra as string | undefined) ??
            null;
          const dataReferencia: string | null = dataReceita ?? dataVenda;

          // Define status com base na data conhecida (igual syncVendas).
          // Sem data confiável → coluna de direcionamento se tiver vendedor,
          // ou "novo" se não tivermos ninguém.
          let renStatusKey: string;
          if (dataReferencia) {
            const refDate = new Date(dataReferencia + "T00:00:00Z");
            const dias = daysBetween(refDate, new Date());
            renStatusKey = resolvedAssignedTo
              ? statusKeyForRenovacao(dias)
              : DIRECIONAMENTO_STATUS;
          } else {
            renStatusKey = resolvedAssignedTo ? DIRECIONAMENTO_STATUS : "novo";
          }

          const { data: insertedRen } = await supabase
            .from("crm_renovacoes")
            .insert({
              ssotica_cliente_id: clienteId,
              ssotica_company_id: integ.company_id,
              assigned_to: resolvedAssignedTo,
              data: {
                nome: clienteNome,
                telefone,
                documento,
                cpf: documento,
                email,
                data_ultima_receita: dataReceita,
                data_ultima_venda: dataVenda,
                data_ultima_compra: dataReferencia,
                origem_transicao: "cobranca_quitada",
              },
              status: renStatusKey,
              data_ultima_compra: dataReferencia,
              scheduled_date: dataReferencia,
            })
            .select("id")
            .maybeSingle();

          await supabase.from("crm_module_transition_logs").insert({
            cliente_nome: clienteNome,
            from_module: "cobranca",
            to_module: "renovacao",
            to_status_key: renStatusKey,
            to_status_label: renStatusLabelByKeyForCob.get(renStatusKey) ?? renStatusKey,
            source_record_id: cob.id,
            target_record_id: (insertedRen as any)?.id ?? null,
            ssotica_cliente_id: clienteId,
            company_id: integ.company_id,
            triggered_by: null,
            trigger_source: "auto",
          });
        }
      }
    }
  }

  // Log de diagnóstico para entender por que parcelas estão sendo filtradas
  const topSituacoes = Array.from(situacoesVistas.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log(`[ssotica-sync][cobrancas] empresa=${integ.company_id} processed=${processed} created=${created} updated=${updated} removed=${removed} removed_direct=${removedByDirectEvidence} removed_absence=${removedByAbsence} quitados=${clientesQuitadosSet.size} skipped=${JSON.stringify(skipped)} top_situacoes=${JSON.stringify(topSituacoes)}`);

  return { processed, created, updated, removed, chunks: chunksProcessed, clientesQuitados: Array.from(clientesQuitadosSet) };
}

async function syncVendas(
  supabase: any,
  integ: Integration,
  forceFull = false,
  clientesQuitados: number[] = [],
  windowOverride?: { start: Date; end: Date },
): Promise<{ processed: number; created: number; updated: number; chunks: number }> {
  const today = new Date();
  const isBackfillChunk = !!windowOverride;
  // Janela:
  //  - windowOverride (modo backfill): processa só o chunk indicado.
  //  - sync incremental: a partir do último sync (ou últimos 12 meses se primeira vez).
  let overallStart: Date;
  let overallEnd: Date;
  if (windowOverride) {
    overallStart = windowOverride.start;
    overallEnd = windowOverride.end;
  } else {
    overallEnd = today;
    overallStart = integ.last_sync_vendas_at && !forceFull && clientesQuitados.length === 0 && integ.initial_sync_done
      ? addDays(new Date(integ.last_sync_vendas_at), -1)
      : addDays(today, -CHUNK_DAYS); // 12 meses na primeira sync
  }

  let processed = 0, created = 0, updated = 0;
  // Vendas: SEMPRE usa o CNPJ puro (não aceita código de licença).
  const cnpjVendas = normalizeIdentifier(integ.cnpj);

  const { data: companyProfiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .eq("company_id", integ.company_id);
  const typedCompanyProfiles = (companyProfiles ?? []) as CompanyProfile[];

  const companyUserIds = typedCompanyProfiles.map((profile) => profile.user_id);
  const { data: companyRoles } = companyUserIds.length > 0
    ? await supabase.from("user_roles").select("user_id, role").in("user_id", companyUserIds)
    : { data: [] as Array<{ user_id: string; role: AppRole }> };
  const typedCompanyRoles = (companyRoles ?? []) as CompanyRole[];

  const roleByUserId = new Map<string, AppRole>(
    typedCompanyRoles.map((entry) => [entry.user_id, entry.role]),
  );
  const managerUserId = typedCompanyProfiles.find((profile) => roleByUserId.get(profile.user_id) === "gerente")?.user_id ?? null;

  // Carrega mapeamento manual SSótica → CRM (vendedor por funcionário SSótica)
  const { data: mappings } = await supabase
    .from("ssotica_user_mappings")
    .select("ssotica_funcionario_id, user_id")
    .eq("company_id", integ.company_id);
  const userIdByFuncionarioId = new Map<number, string>(
    (mappings ?? []).map((m: any) => [Number(m.ssotica_funcionario_id), m.user_id as string]),
  );

  // Pool de vendedores ATIVOS da loja para fallback round-robin (quando nenhum
  // vendedor SSótica está mapeado e nenhum match por nome foi encontrado).
  // Inclui apenas role "vendedor" — gerente fica como último fallback.
  const vendedoresPool = typedCompanyProfiles
    .filter((p) => roleByUserId.get(p.user_id) === "vendedor")
    .map((p) => p.user_id)
    .sort(); // ordem estável

  // Cache de labels das colunas de renovação (key -> label) para registro de logs
  const { data: renStatusRows } = await supabase
    .from("crm_renovacao_statuses")
    .select("key,label");
  const renStatusLabelByKey = new Map<string, string>(
    (renStatusRows ?? []).map((s: any) => [s.key, s.label]),
  );
  const clientesQuitadosSet = new Set<number>(clientesQuitados);

  async function logRenovacaoTransition(params: {
    cliente_nome: string;
    statusKey: string;
    target_record_id: string | null;
    ssotica_cliente_id: number;
  }) {
    try {
      await supabase.from("crm_module_transition_logs").insert({
        cliente_nome: params.cliente_nome || "Cliente SSótica",
        from_module: "cobranca",
        to_module: "renovacao",
        to_status_key: params.statusKey,
        to_status_label: renStatusLabelByKey.get(params.statusKey) ?? params.statusKey,
        source_record_id: null,
        target_record_id: params.target_record_id,
        ssotica_cliente_id: params.ssotica_cliente_id,
        company_id: integ.company_id,
        triggered_by: null,
        trigger_source: "auto",
      });
    } catch (e) {
      console.error("[transition-log] erro ao registrar:", e);
    }
  }

  const findResponsibleProfile = (responsavelNome: string | null | undefined) => {
    if (!responsavelNome) return null;

    return typedCompanyProfiles.find(
      (profile) => roleByUserId.get(profile.user_id) === "vendedor" && isSamePerson(profile.full_name, responsavelNome),
    ) ?? typedCompanyProfiles.find((profile) => isSamePerson(profile.full_name, responsavelNome)) ?? null;
  };

  // Cache de funcionários SSótica vistos nesta sync (alimenta a tela de mapeamento)
  const funcionariosVistos = new Map<number, { nome: string; funcao: string }>();

  // Mapa cliente_id -> última venda (data + venda_id + valor + cliente)
  const ultimaCompraPorCliente = new Map<number, { data: string; vendaId: number; valor: number; cliente: any; funcionario: any }>();

  // Mapa cliente_id -> última RECEITA (vinda de Ordens de Serviço).
  // É a data em que a receita médica foi emitida (campo `data` da O.S.).
  // Quando disponível, usamos essa data ao invés da data da venda como
  // "última consulta" do cliente (faz mais sentido para óticas: o que precisa
  // renovar é a receita, não necessariamente a compra).
  const ultimaReceitaPorCliente = new Map<number, { data: string; osId: number; optometrista: string; validade: string | null }>();

  // Janela única (definida por overallStart/overallEnd) dividida em sub-janelas de 30 dias.
  const windows = buildWindows(overallStart, overallEnd);

  // ===== PASSO 1: Ordens de Serviço (receitas) =====
  // ⚡ OTIMIZAÇÃO: durante backfill (chunks históricos), pulamos a busca de O.S.
  // — é a parte mais cara da sync (loja grande = ~1500 clientes_com_receita por chunk
  // de 6 meses, demora 30-60s só pra esse passo) e raramente muda a coluna do card,
  // já que o que importa é a data da última VENDA. No sync incremental (janela curta),
  // continuamos buscando OS para manter "última receita" precisa.
  if (!isBackfillChunk) {
    for (const w of windows) {
      const url =
        `${SSOTICA_BASE}/ordens-servico/periodo?cnpj=${encodeURIComponent(cnpjVendas)}&inicio_periodo=${w.start}&fim_periodo=${w.end}`;
      let ordens: any[] = [];
      try {
        ordens = await fetchSSotica(url, integ.bearer_token) as any[];
      } catch (e) {
        console.warn(`[ssotica-sync][os] janela ${w.start}→${w.end} falhou:`, (e as Error).message);
        continue;
      }
      if (!Array.isArray(ordens)) continue;
      for (const os of ordens) {
        // Só interessa quando a O.S. tem receita registrada
        const receita = os?.receita;
        if (!receita || !os?.cliente?.id || !os?.data) continue;
        const clienteId = Number(os.cliente.id);
        const dataOs = String(os.data); // YYYY-MM-DD — data em que a O.S./receita foi emitida
        const prev = ultimaReceitaPorCliente.get(clienteId);
        if (!prev || prev.data < dataOs) {
          ultimaReceitaPorCliente.set(clienteId, {
            data: dataOs,
            osId: Number(os.id ?? 0),
            optometrista: String(receita.optometrista ?? ""),
            validade: receita.validade ? String(receita.validade).slice(0, 10) : null,
          });
        }
      }
    }
    console.log(`[ssotica-sync][os] empresa=${integ.company_id} clientes_com_receita=${ultimaReceitaPorCliente.size}`);
  } else {
    console.log(`[ssotica-sync][os] empresa=${integ.company_id} pulado (backfill chunk — usa data da venda)`);
  }

  // ===== PASSO 2: Vendas =====
  for (const w of windows) {
    const url =
      `${SSOTICA_BASE}/vendas/periodo?cnpj=${encodeURIComponent(cnpjVendas)}&inicio_periodo=${w.start}&fim_periodo=${w.end}`;
    const vendas = await fetchSSotica(url, integ.bearer_token) as any[];
    if (!Array.isArray(vendas)) continue;

    for (const venda of vendas) {
      processed++;
      // Cacheia funcionário visto ANTES de qualquer filtro (pra alimentar a tela de mapeamento)
      const func = venda.funcionario;
      if (func) {
        const nome = String(func.nome ?? "").trim();
        const funcao = String(func.funcao ?? "").trim();
        let funcKey: number | null = null;
        if (func.id != null && !Number.isNaN(Number(func.id))) {
          funcKey = Number(func.id);
        } else if (nome) {
          let h = 0;
          for (let i = 0; i < nome.length; i++) h = ((h << 5) - h + nome.charCodeAt(i)) | 0;
          funcKey = -Math.abs(h) || -1;
        }
        if (funcKey !== null && (nome || funcao)) {
          funcionariosVistos.set(funcKey, { nome: nome || "(sem nome)", funcao });
        }
      }

      const statusVenda = String(venda.status ?? "").toUpperCase();
      if (statusVenda && statusVenda !== "ATIVA") continue;
      const cliente = venda.cliente;
      if (!cliente?.id) continue;
      const data = venda.data as string;
      const valor = Number(venda.valor_liquido ?? venda.valor_bruto ?? 0);
      const prev = ultimaCompraPorCliente.get(cliente.id);
      if (!prev || prev.data < data) {
        ultimaCompraPorCliente.set(cliente.id, { data, vendaId: venda.id, valor, cliente, funcionario: venda.funcionario ?? null });
      }
    }
  }
  const chunksProcessed = 1;
  console.log(`[ssotica-sync][vendas] empresa=${integ.company_id} janela=${ymd(overallStart)}→${ymd(overallEnd)} processed=${processed} clientes_unicos=${ultimaCompraPorCliente.size} backfill_chunk=${isBackfillChunk}`);

  // Persiste cache de funcionários SSótica vistos (upsert)
  if (funcionariosVistos.size > 0) {
    const rows = Array.from(funcionariosVistos.entries()).map(([id, f]) => ({
      company_id: integ.company_id,
      ssotica_funcionario_id: id,
      nome: f.nome || "(sem nome)",
      funcao: f.funcao || null,
      last_seen_at: new Date().toISOString(),
    }));
    await supabase
      .from("ssotica_funcionarios")
      .upsert(rows, { onConflict: "company_id,ssotica_funcionario_id" });
  }

  // Para cada cliente que comprou: se NÃO tem cobrança em aberto/vencida, vai para Renovações.
  // Se TEM cobrança aberta, garante que o card NÃO esteja em Renovação (remove se necessário).
  for (const [clienteId, info] of ultimaCompraPorCliente) {
    // Verifica se há cobrança em aberto desse cliente nesta loja
    // (qualquer status que não seja pago/cancelado conta como dívida pendente)
    const { data: cobrancasAbertas } = await supabase
      .from("crm_cobrancas")
      .select("id")
      .eq("ssotica_cliente_id", clienteId)
      .eq("ssotica_company_id", integ.company_id)
      .not("status", "in", "(pago,cancelado)")
      .limit(1);

    if (cobrancasAbertas && cobrancasAbertas.length > 0) {
      // Cliente TEM dívida aberta → não pode estar em Renovação.
      // Se já existe um card de renovação, remove e registra a transição reversa.
      const { data: renExistente } = await supabase
        .from("crm_renovacoes")
        .select("id, data")
        .eq("ssotica_cliente_id", clienteId)
        .eq("ssotica_company_id", integ.company_id)
        .maybeSingle();
      if (renExistente) {
        const renData = (renExistente as any).data ?? {};
        const clienteNome = String(renData?.nome ?? info.cliente?.nome ?? "Cliente SSótica");
        await supabase.from("crm_renovacoes").delete().eq("id", (renExistente as any).id);
        // Log: exclusão automática do card de renovação (cliente entrou em cobrança)
        await supabase.from("crm_module_transition_logs").insert({
          cliente_nome: clienteNome,
          from_module: "renovacao",
          to_module: "none",
          to_status_key: null,
          to_status_label: null,
          source_record_id: (renExistente as any).id,
          ssotica_cliente_id: clienteId,
          company_id: integ.company_id,
          triggered_by: null,
          trigger_source: "auto",
        });
        // Log: transição (renovacao -> cobranca)
        await supabase.from("crm_module_transition_logs").insert({
          cliente_nome: clienteNome,
          from_module: "renovacao",
          to_module: "cobranca",
          to_status_key: null,
          to_status_label: null,
          source_record_id: (renExistente as any).id,
          target_record_id: cobrancasAbertas[0].id,
          ssotica_cliente_id: clienteId,
          company_id: integ.company_id,
          triggered_by: null,
          trigger_source: "auto",
        });
      }
      continue; // tem dívida → não cria nem mantém renovação
    }

    const cliente = info.cliente;
    const telefone = cliente.telefones?.[0]?.numero ?? "";
    const responsavelNome = info.funcionario?.nome ?? "";
    const responsavelFuncao = info.funcionario?.funcao ?? "";

    // Data de referência: usa data da última receita (O.S.) se houver,
    // senão cai na data da última venda. É essa data que vai para
    // data_ultima_compra/scheduled_date e classifica a coluna do Kanban.
    const receitaInfo = ultimaReceitaPorCliente.get(clienteId) ?? null;
    const dataReferencia = receitaInfo?.data ?? info.data;

    const renovacaoData = {
      nome: cliente.nome,
      telefone,
      documento: cliente.cpf_cnpj ?? "",
      email: cliente.emails?.[0]?.email ?? "",
      data_ultima_compra: dataReferencia, // mantém o nome do campo p/ retro-compat
      data_ultima_receita: receitaInfo?.data ?? null,
      data_ultima_venda: info.data,
      receita_optometrista: receitaInfo?.optometrista ?? null,
      receita_validade: receitaInfo?.validade ?? null,
      tem_receita: !!receitaInfo,
      responsavel_ssotica_nome: responsavelNome,
      responsavel_ssotica_funcao: responsavelFuncao,
      ssotica_raw: cliente,
    };

    // Calcula dias desde a data de referência (receita > venda) para escolher a coluna
    const referenciaDate = new Date(dataReferencia + "T00:00:00Z");
    const diasDesdeUltimaCompra = daysBetween(referenciaDate, today);
    const { data: existing } = await supabase
      .from("crm_renovacoes")
      .select("id, data_ultima_compra, status, assigned_to")
      .eq("ssotica_cliente_id", clienteId)
      .eq("ssotica_company_id", integ.company_id)
      .maybeSingle();
    const existingRenovacao = existing as ExistingRenovacao | null;

    // Prioridade: mapeamento manual (por ID do funcionário SSótica, ou hash do nome se sem ID) > matching por nome > gerente
    let funcionarioKey: number | null = null;
    if (info.funcionario?.id != null && !Number.isNaN(Number(info.funcionario.id))) {
      funcionarioKey = Number(info.funcionario.id);
    } else if (responsavelNome) {
      let h = 0;
      for (let i = 0; i < responsavelNome.length; i++) h = ((h << 5) - h + responsavelNome.charCodeAt(i)) | 0;
      funcionarioKey = -Math.abs(h) || -1;
    }
    const manualUserId = funcionarioKey !== null ? userIdByFuncionarioId.get(funcionarioKey) ?? null : null;
    const matchedProfile = manualUserId ? null : findResponsibleProfile(responsavelNome);
    const existingAssignedRole = existingRenovacao?.assigned_to ? roleByUserId.get(existingRenovacao.assigned_to) : null;
    const preserveExistingVendedor = existingAssignedRole === "vendedor" && !manualUserId;

    // Round-robin estável por clienteId quando não há mapeamento, match por nome
    // nem vendedor existente. Garante que cada cliente sem responsável recebe
    // um vendedor da loja (distribuição equilibrada).
    const fallbackVendedor = vendedoresPool.length > 0
      ? vendedoresPool[Math.abs(clienteId) % vendedoresPool.length]
      : null;

    const resolvedAssignedTo = manualUserId
      ?? (preserveExistingVendedor
        ? existingRenovacao?.assigned_to ?? null
        : matchedProfile?.user_id ?? existingRenovacao?.assigned_to ?? fallbackVendedor ?? managerUserId ?? null);
    // Qualquer usuário atribuído (vendedor, gerente, admin, financeiro) conta como responsável
    const hasAssignedVendedor = !!resolvedAssignedTo;
    const flowStatus = statusKeyForRenovacao(diasDesdeUltimaCompra);

    if (existingRenovacao) {
      // Não mexe se vendedor já está atendendo manualmente
      const isManualStatus = existingRenovacao.status === "em_atendimento" || existingRenovacao.status === "nunca_fez_exame";
      const newStatus = !hasAssignedVendedor
        ? DIRECIONAMENTO_STATUS
        : isManualStatus
          ? existingRenovacao.status
          : flowStatus;
      // Atualiza se a data de referência é mais recente OU se o status precisa mudar de coluna pelo tempo
      const dataMaisRecente = !existingRenovacao.data_ultima_compra || existingRenovacao.data_ultima_compra < dataReferencia;
      const statusMudou = existingRenovacao.status !== newStatus;
      const assignedMudou = (existingRenovacao.assigned_to ?? null) !== resolvedAssignedTo;
      const renovacaoDataMudou = stableStringify(existingRenovacao.data ?? null) !== stableStringify(renovacaoData);
      const vendaMudou = Number(existingRenovacao.ssotica_venda_id ?? 0) !== Number(info.vendaId ?? 0);
      const valorMudou = Number(existingRenovacao.valor ?? 0) !== Number(info.valor ?? 0);
      const scheduledMudou = (existingRenovacao.scheduled_date ?? null) !== (dataReferencia ?? null);
      if (dataMaisRecente || statusMudou || assignedMudou || renovacaoDataMudou || vendaMudou || valorMudou || scheduledMudou) {
        await supabase
          .from("crm_renovacoes")
          .update({
            data: renovacaoData,
            data_ultima_compra: dataReferencia,
            ssotica_venda_id: info.vendaId,
            assigned_to: resolvedAssignedTo,
            valor: info.valor,
            scheduled_date: dataReferencia,
            status: newStatus,
          })
          .eq("id", existingRenovacao.id);
        updated++;
      }
    } else {
      const newStatusKey = hasAssignedVendedor ? flowStatus : DIRECIONAMENTO_STATUS;
      const { data: inserted } = await supabase
        .from("crm_renovacoes")
        .insert({
          ssotica_cliente_id: clienteId,
          ssotica_venda_id: info.vendaId,
          ssotica_company_id: integ.company_id,
          assigned_to: resolvedAssignedTo,
          data: renovacaoData,
          data_ultima_compra: dataReferencia,
          valor: info.valor,
          status: newStatusKey,
          scheduled_date: dataReferencia,
        })
        .select("id")
        .maybeSingle();
      created++;

      // Log: card de renovação criado automaticamente
      await supabase.from("crm_module_transition_logs").insert({
        cliente_nome: cliente.nome ?? "Cliente SSótica",
        from_module: "none",
        to_module: "renovacao",
        to_status_key: newStatusKey,
        to_status_label: renStatusLabelByKey.get(newStatusKey) ?? newStatusKey,
        target_record_id: (inserted as any)?.id ?? null,
        ssotica_cliente_id: clienteId,
        company_id: integ.company_id,
        triggered_by: null,
        trigger_source: "auto",
      });

      // Se o cliente saiu da Cobrança nesta sync, registra a transição
      if (clientesQuitadosSet.has(clienteId)) {
        await logRenovacaoTransition({
          cliente_nome: cliente.nome,
          statusKey: newStatusKey,
          target_record_id: (inserted as any)?.id ?? null,
          ssotica_cliente_id: clienteId,
        });
      }
    }
  }

  return { processed, created, updated, chunks: chunksProcessed };
}

// Reconciliação: para uma loja, encontra todas as renovações cujo cliente tem cobrança
// aberta (status != pago/cancelado) e as remove, registrando a transição reversa.
// É uma rede de segurança contra cards mal posicionados durante backfill por chunks.
// ============================================================
// Consolida cards de cobrança de UM MESMO cliente em LOJAS DIFERENTES.
// Quando um cliente tem compras (e parcelas em atraso) em duas ou mais lojas,
// cada sync por loja cria/atualiza um card próprio. Esta função roda DEPOIS
// que todas as integrações terminaram e funde os cards num único, escolhendo
// como "dona" a loja com a parcela MAIS ANTIGA. Todas as parcelas em atraso
// (de todas as lojas) ficam visíveis num único card.
//
// Identificação do mesmo cliente:
//  1) Mesmo CPF/documento normalizado (somente dígitos, >= 11)
//  2) Fallback: mesmo telefone normalizado (somente dígitos, >= 10)
// ============================================================
function normalizeDigits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

async function consolidateCrossStoreCobrancas(supabase: any): Promise<{ groups_merged: number; cards_removed: number }> {
  // Busca TODAS as cobranças ativas com vínculo SSótica.
  const { data: rows } = await supabase
    .from("crm_cobrancas")
    .select("id, ssotica_cliente_id, ssotica_company_id, vencimento, valor, dias_atraso, status, data, assigned_to, created_by, scheduled_date, ssotica_parcela_id, ssotica_titulo_id")
    .not("ssotica_company_id", "is", null);
  const cards = (rows ?? []) as any[];
  if (cards.length === 0) return { groups_merged: 0, cards_removed: 0 };

  // Agrupa por chave de identidade do cliente (CPF preferencial, telefone como fallback).
  const groups = new Map<string, any[]>();
  for (const c of cards) {
    const data = c.data ?? {};
    const cpf = normalizeDigits(data.documento ?? data.cpf);
    const tel = normalizeDigits(data.telefone);
    let key: string | null = null;
    if (cpf.length >= 11) key = `cpf:${cpf}`;
    else if (tel.length >= 10) key = `tel:${tel}`;
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  let groupsMerged = 0;
  let cardsRemoved = 0;

  for (const [_key, list] of groups.entries()) {
    if (list.length < 2) continue; // só mescla se houver 2+ cards (lojas diferentes)
    // Garante que envolve mais de uma loja (se for tudo da mesma loja, deixa o sync por loja resolver).
    const lojas = new Set(list.map((c) => String(c.ssotica_company_id)));
    if (lojas.size < 2) continue;

    // Junta todas as parcelas em atraso de todos os cards (dedup por parcela_id).
    const parcelasMap = new Map<string, any>();
    for (const c of list) {
      const arr = (c.data?.parcelas_atrasadas ?? []) as any[];
      const company = c.ssotica_company_id;
      for (const p of arr) {
        const pid = p.parcela_id != null ? `pid:${p.parcela_id}` : `tit:${p.titulo_id ?? ""}-num:${p.numero_parcela ?? ""}-venc:${p.vencimento ?? ""}`;
        if (!parcelasMap.has(pid)) {
          parcelasMap.set(pid, { ...p, ssotica_company_id: company });
        }
      }
    }
    const todasParcelas = Array.from(parcelasMap.values()).sort((a, b) =>
      (a.vencimento ?? "") < (b.vencimento ?? "") ? -1 : (a.vencimento ?? "") > (b.vencimento ?? "") ? 1 : 0,
    );
    if (todasParcelas.length === 0) continue;

    // Loja "vencedora" = loja da parcela mais antiga.
    const maisAntiga = todasParcelas[0];
    const winnerCompany = String(maisAntiga.ssotica_company_id ?? "");
    if (!winnerCompany) continue;

    // Card vencedor = card cuja loja é a vencedora (se houver mais de um na mesma loja, mantém o de menor vencimento).
    const winnerCandidates = list.filter((c) => String(c.ssotica_company_id) === winnerCompany);
    winnerCandidates.sort((a, b) => (a.vencimento ?? "") < (b.vencimento ?? "") ? -1 : 1);
    const winner = winnerCandidates[0];
    const losers = list.filter((c) => c.id !== winner.id);

    // Merge dos dados: mantém o "data" do winner, atualiza parcelas e totais, e indica que é cross-loja.
    const totalAtraso = todasParcelas.reduce((s, p) => s + Number(p.valor ?? 0), 0);
    const winnerData = { ...(winner.data ?? {}) };
    winnerData.parcelas_atrasadas = todasParcelas;
    winnerData.total_atraso = totalAtraso;
    winnerData.qtd_parcelas_atrasadas = todasParcelas.length;
    winnerData.lojas_envolvidas = Array.from(lojas);
    winnerData.cross_store_merged_at = new Date().toISOString();

    await supabase
      .from("crm_cobrancas")
      .update({
        ssotica_parcela_id: maisAntiga.parcela_id ?? null,
        ssotica_titulo_id: maisAntiga.titulo_id ?? null,
        data: winnerData,
        valor: totalAtraso,
        vencimento: maisAntiga.vencimento,
        dias_atraso: maisAntiga.dias_atraso,
        scheduled_date: maisAntiga.vencimento,
        updated_at: new Date().toISOString(),
      })
      .eq("id", winner.id);

    // Remove os cards perdedores. Loga transição "cobranca → none" como auto/merge.
    for (const loser of losers) {
      const cliId = loser.ssotica_cliente_id;
      const nome = String(loser.data?.nome ?? winnerData.nome ?? "Cliente SSótica");
      await supabase.from("crm_cobrancas").delete().eq("id", loser.id);
      cardsRemoved++;
      await supabase.from("crm_module_transition_logs").insert({
        cliente_nome: nome,
        from_module: "cobranca",
        to_module: "none",
        to_status_key: null,
        to_status_label: null,
        source_record_id: loser.id,
        target_record_id: winner.id,
        ssotica_cliente_id: cliId,
        company_id: loser.ssotica_company_id,
        triggered_by: null,
        trigger_source: "auto_cross_store_merge",
      });
    }
    groupsMerged++;
  }

  return { groups_merged: groupsMerged, cards_removed: cardsRemoved };
}

async function reconcileRenovacoesVsCobrancas(
  supabase: any,
  companyId: string,
): Promise<number> {
  const { data: wrong } = await supabase
    .from("crm_renovacoes")
    .select("id, ssotica_cliente_id, data")
    .eq("ssotica_company_id", companyId)
    .not("ssotica_cliente_id", "is", null);
  if (!wrong || wrong.length === 0) return 0;

  let removed = 0;
  for (const ren of wrong) {
    const clienteId = (ren as any).ssotica_cliente_id;
    if (clienteId == null) continue;
    const { data: cob } = await supabase
      .from("crm_cobrancas")
      .select("id")
      .eq("ssotica_cliente_id", clienteId)
      .eq("ssotica_company_id", companyId)
      .not("status", "in", "(pago,cancelado)")
      .limit(1);
    if (!cob || cob.length === 0) continue;

    const renData = (ren as any).data ?? {};
    const clienteNome = String(renData?.nome ?? "Cliente SSótica");
    const renId = (ren as any).id;
    const { error: delErr } = await supabase.from("crm_renovacoes").delete().eq("id", renId);
    if (delErr) {
      console.error(`[reconcile] falha ao remover renovacao ${renId}:`, delErr.message);
      continue;
    }
    // Log: exclusão automática (reconcile) — renovação removida porque cliente tem cobrança aberta
    await supabase.from("crm_module_transition_logs").insert({
      cliente_nome: clienteNome,
      from_module: "renovacao",
      to_module: "none",
      to_status_key: null,
      to_status_label: null,
      source_record_id: renId,
      ssotica_cliente_id: clienteId,
      company_id: companyId,
      triggered_by: null,
      trigger_source: "auto_reconcile",
    });
    // Log: transição reconcile (renovacao -> cobranca)
    await supabase.from("crm_module_transition_logs").insert({
      cliente_nome: clienteNome,
      from_module: "renovacao",
      to_module: "cobranca",
      to_status_key: null,
      to_status_label: null,
      source_record_id: renId,
      target_record_id: cob[0].id,
      ssotica_cliente_id: clienteId,
      company_id: companyId,
      triggered_by: null,
      trigger_source: "auto_reconcile",
    });
    removed++;
  }
  return removed;
}


// Helper: roda 1 chunk de backfill (vendas + cobranças daquela janela histórica).
async function runBackfillChunk(
  supabase: any,
  integ: Integration,
  dispatchConfig: DispatchConfig,
): Promise<{ ok: true; chunk_index: number; finished: boolean; skipped?: boolean } | { ok: false; error: string }> {
  const nowIso = new Date().toISOString();
  const configuredTotal = integ.backfill_total_chunks || 32;
  const total = Math.max(configuredTotal, 32);
  const idx = integ.backfill_chunk_index || 0;

    if (configuredTotal !== total) {
      await supabase.from("ssotica_integrations").update({
        backfill_total_chunks: total,
        updated_at: nowIso,
      }).eq("id", integ.id);
      integ.backfill_total_chunks = total;
    console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} migrada automaticamente de ${configuredTotal} para ${total} chunks`);
  }

  if (idx >= total) {
    await supabase.from("ssotica_integrations").update({
      backfill_chunk_index: total,
      backfill_status: "done",
      backfill_next_run_at: null,
      sync_status: "idle",
      updated_at: nowIso,
    }).eq("id", integ.id);
    console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} já concluída (${idx}/${total})`);
    return { ok: true, chunk_index: total, finished: true, skipped: true };
  }
  // chunk 0 = mais recente (últimos 6 meses) — futureDays=COBRANCAS_FUTURE_DAYS pra pegar parcelas a vencer
  const futureDays = idx === 0 ? COBRANCAS_FUTURE_DAYS : 0;
  const range = chunkDateRange(idx, futureDays);
  console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} iniciando chunk ${idx + 1}/${total} (${ymd(range.start)}→${ymd(range.end)})`);

  // Claim do chunk atual usando lease temporário. O cursor só avança DEPOIS que
  // cobranças e vendas terminarem com sucesso; assim evitamos pular de 1/16 para
  // 2/16, 3/16... quando a execução cai no meio do processamento.
  const claimLeaseUntil = new Date(Date.now() + BACKFILL_CLAIM_WINDOW_MS).toISOString();
  const { data: claimRow, error: claimError } = await supabase
    .from("ssotica_integrations")
    .update({
      backfill_next_run_at: claimLeaseUntil,
      backfill_status: "running",
      sync_status: "running",
      last_error: null,
      updated_at: nowIso,
    })
    .eq("id", integ.id)
    .eq("backfill_chunk_index", idx)
    .in("backfill_status", ["running", "scheduled"])
    .lte("backfill_next_run_at", nowIso)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimRow) {
    console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} chunk ${idx + 1}/${total} ignorado: fora da janela ou já assumido por outra execução`);
    return { ok: true, chunk_index: idx, finished: false, skipped: true };
  }

  // Fase atual dentro do chunk: 'cr' (cobranças) → 'vendas'.
  // Cada fase é uma invocação separada para respeitar o limite de CPU do edge runtime.
  // Escopo do backfill define quais fases rodam:
  //   - 'all'         → cr + vendas (cobranças e renovações)
  //   - 'cobrancas'   → apenas cr  (mas também roda vendas para mover pagas → renovação)
  //   - 'renovacoes'  → apenas vendas
  const scope: "all" | "cobrancas" | "renovacoes" =
    (integ.backfill_scope === "cobrancas" || integ.backfill_scope === "renovacoes")
      ? integ.backfill_scope
      : "all";
  const runsCr = scope === "all" || scope === "cobrancas";
  const runsVendas = scope === "all" || scope === "cobrancas" || scope === "renovacoes";
  // Decide a fase inicial respeitando o escopo
  let phase: "cr" | "vendas" = (integ.backfill_phase === "vendas") ? "vendas" : "cr";
  if (phase === "cr" && !runsCr) phase = "vendas";
  if (phase === "vendas" && !runsVendas) phase = "cr";

  const { data: log } = await supabase.from("ssotica_sync_logs").insert({
    integration_id: integ.id,
    sync_type: `backfill_chunk_${idx + 1}_of_${total}_${phase}`,
    status: "running",
    details: { chunk_index: idx, total_chunks: total, phase, scope, range: { start: ymd(range.start), end: ymd(range.end) } },
  }).select("id").single();
  const logId = log?.id ?? null;
  const stopHeartbeat = startBackfillHeartbeat({
    supabase,
    integrationId: integ.id,
    chunkIndex: idx,
    phase,
  });

  try {
    let cr: any = null;
    let v: any = null;
    if (phase === "cr") {
      cr = await syncContasReceber(supabase, integ, range);
    } else {
      v = await syncVendas(supabase, integ, false, [], range);
    }

    // Avanço de fase/chunk respeitando o escopo:
    // - Se acabou 'cr' e o escopo também roda 'vendas' → próxima fase do MESMO chunk = 'vendas'.
    // - Caso contrário → avança chunk e volta para a primeira fase válida do escopo.
    let nextIdx = idx;
    let nextPhase: "cr" | "vendas" = phase;
    let phaseDone = false;
    if (phase === "cr") {
      if (runsVendas) {
        nextPhase = "vendas";
      } else {
        phaseDone = true;
        nextIdx = idx + 1;
        nextPhase = "cr";
      }
    } else {
      phaseDone = true;
      nextIdx = idx + 1;
      nextPhase = runsCr ? "cr" : "vendas";
    }
    const finished = phaseDone && nextIdx >= total;
    const finishedAt = new Date().toISOString();

    // Antes de reagendar, verifica se o usuário pausou manualmente (backfill_status = 'idle').
    // Se sim, respeita a pausa e NÃO reagenda nem avança chunk_index/phase.
    const { data: currentState } = await supabase
      .from("ssotica_integrations")
      .select("backfill_status")
      .eq("id", integ.id)
      .maybeSingle();
    const wasPausedByUser = currentState?.backfill_status === "idle";

    const nextRunAt = finished || wasPausedByUser ? null : finishedAt;
    const nextStatus = finished ? "done" : (wasPausedByUser ? "idle" : "scheduled");

    const updatePayload: Record<string, unknown> = {
      backfill_status: nextStatus,
      backfill_next_run_at: nextRunAt,
      sync_status: "idle",
      initial_sync_done: finished ? true : integ.initial_sync_done,
      last_sync_receber_at: (phase === "cr" || finished) ? finishedAt : integ.last_sync_receber_at,
      last_sync_vendas_at: (phase === "vendas" || finished) ? finishedAt : integ.last_sync_vendas_at,
      last_error: wasPausedByUser ? "Pausado manualmente pelo usuário" : null,
      updated_at: finishedAt,
    };
    if (!wasPausedByUser) {
      updatePayload.backfill_chunk_index = nextIdx;
      updatePayload.backfill_phase = nextPhase;
    }
    await supabase.from("ssotica_integrations").update(updatePayload).eq("id", integ.id).eq("backfill_chunk_index", idx);

    if (logId) {
      const processed = (cr?.processed ?? 0) + (v?.processed ?? 0);
      const created = (cr?.created ?? 0) + (v?.created ?? 0);
      const updated = (cr?.updated ?? 0) + (v?.updated ?? 0);
      await supabase.from("ssotica_sync_logs").update({
        finished_at: finishedAt,
        status: "success",
        items_processed: processed,
        items_created: created,
        items_updated: updated,
        details: { chunk_index: idx, total_chunks: total, phase, range: { start: ymd(range.start), end: ymd(range.end) }, contas_receber: cr, vendas: v },
      }).eq("id", logId);
    }

    console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} chunk ${idx + 1}/${total} fase=${phase} OK. ${finished ? 'CONCLUÍDO!' : `próximo: chunk ${nextIdx + 1} fase ${nextPhase} (agendado)`}`);

    if (!finished && !wasPausedByUser) {
      try {
        if (!dispatchConfig.url || !dispatchConfig.auth) {
          console.warn(`[ssotica-sync][backfill] empresa=${integ.company_id} continuação automática não disparada agora; runner agendado continuará pelo backfill_next_run_at`);
        } else {
          const { error: dispatchErr } = await supabase.rpc("ssotica_enqueue_sync", {
            _url: dispatchConfig.url,
            _auth: dispatchConfig.auth,
            _integration_id: integ.id,
            _force_full: false,
          });

          if (dispatchErr) {
            console.error(`[ssotica-sync][backfill] empresa=${integ.company_id} erro ao enfileirar continuação automática:`, dispatchErr.message);
          } else {
            console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} próxima execução enfileirada via pg_net`);
          }
        }
      } catch (dispatchError) {
        console.error(`[ssotica-sync][backfill] empresa=${integ.company_id} falha ao disparar continuação automática:`, dispatchError);
      }
    }

    // RECONCILIAÇÃO: no chunk final, roda uma varredura COMPLETA (96 meses)
    // de Contas a Receber com a lógica de deleção habilitada. Isso é crucial
    // porque a SSótica costuma remover da resposta as parcelas já pagas;
    // durante o backfill por chunks não deletamos cards por ausência, então
    // essa passada final é a que limpa cobranças quitadas (de qualquer época)
    // e devolve o cliente para Renovação.
    if (finished) {
      try {
        const finalSweepCobrancas = await syncContasReceber(supabase, integ, undefined, { fullSweep: true });
        console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} full sweep final: removed=${finalSweepCobrancas.removed} quitados=${finalSweepCobrancas.clientesQuitados.length}`);
        const reconciled = await reconcileRenovacoesVsCobrancas(supabase, integ.company_id);
        console.log(`[ssotica-sync][backfill] empresa=${integ.company_id} reconciliação final removeu ${reconciled} renovações com dívida aberta`);
      } catch (recErr) {
        console.error(`[ssotica-sync][backfill] reconciliação final falhou (não crítico):`, recErr);
      }
    }

    // Quando o backfill é concluído, notifica todos os admins
    if (finished) {
      try {
        const { data: company } = await supabase
          .from("companies")
          .select("name")
          .eq("id", integ.company_id)
          .maybeSingle();
        const companyName = company?.name ?? "loja";

        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");

        if (admins && admins.length > 0) {
          const notifs = admins.map((a: any) => ({
            user_id: a.user_id,
            title: "Backfill SSótica concluído",
            message: `A importação dos 96 meses de histórico da loja "${companyName}" foi concluída com sucesso.`,
          }));
          const { error: notifErr } = await supabase.from("notifications").insert(notifs);
          if (notifErr) {
            console.error(`[ssotica-sync][backfill] erro ao criar notificações:`, notifErr.message);
          } else {
            console.log(`[ssotica-sync][backfill] ${notifs.length} notificações criadas para admins`);
          }
        }
      } catch (notifErr) {
        console.error(`[ssotica-sync][backfill] falha ao notificar conclusão:`, notifErr);
      }
    }

    return { ok: true, chunk_index: idx, finished };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ssotica-sync][backfill] empresa=${integ.company_id} chunk ${idx + 1} FALHOU:`, msg);
    // Em caso de erro, mantemos o MESMO chunk pendente para retry automático.
    await supabase.from("ssotica_integrations").update({
      sync_status: "error",
      backfill_status: "scheduled",
      backfill_next_run_at: new Date(Date.now() + 30 * 1000).toISOString(),
      last_error: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq("id", integ.id).eq("backfill_chunk_index", idx);
    if (logId) {
      await supabase.from("ssotica_sync_logs").update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: msg.slice(0, 2000),
      }).eq("id", logId);
    }
    return { ok: false, error: msg };
  } finally {
    stopHeartbeat();
  }
}

function isRunningSyncStale(integration: Pick<Integration, "sync_status" | "updated_at">): boolean {
  if (integration.sync_status !== "running" || !integration.updated_at) return false;
  const updatedAt = new Date(integration.updated_at).getTime();
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > RUNNING_SYNC_STALE_MINUTES * 60 * 1000;
}

async function shouldRunGlobalConsolidation(supabase: any, onlyIntegrationId?: string): Promise<boolean> {
  if (!onlyIntegrationId) return true;

  const { data: coordinator, error } = await supabase
    .from("ssotica_integrations")
    .select("id")
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[ssotica-sync][consolidation] falha ao determinar coordenador; executando mesmo assim: ${error.message}`);
    return true;
  }

  return !coordinator || coordinator.id === onlyIntegrationId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const dispatchConfig = getDispatchConfig(req);

  try {
    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode ?? (body.start_backfill ? "start_backfill" : "incremental");
    const onlyIntegrationId: string | undefined = body.integration_id;
    const forceFull: boolean = body.force_full === true;
    const manualRecent: boolean = body.manual_recent === true;

    if (mode === "force_unlock") {
      if (!onlyIntegrationId) {
        return new Response(JSON.stringify({ ok: false, error: "integration_id obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const nowIso = new Date().toISOString();
      const { data: current, error: currentError } = await supabase
        .from("ssotica_integrations")
        .select("id, sync_status, backfill_status, backfill_chunk_index, backfill_total_chunks, backfill_phase")
        .eq("id", onlyIntegrationId)
        .maybeSingle();

      if (currentError) throw currentError;
      if (!current) {
        return new Response(JSON.stringify({ ok: false, error: "Integração não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const totalChunks = current.backfill_total_chunks ?? 32;
      const chunkIndex = current.backfill_chunk_index ?? 0;
      const hasPendingBackfill =
        current.backfill_status !== "done" &&
        (totalChunks === 0 || chunkIndex < totalChunks);

      await supabase
        .from("ssotica_sync_logs")
        .update({
          finished_at: nowIso,
          status: "error",
          error_message: "Execução encerrada manualmente pelo usuário via destravar.",
        })
        .eq("integration_id", onlyIntegrationId)
        .eq("status", "running");

      const { error: unlockError } = await supabase
        .from("ssotica_integrations")
        .update({
          sync_status: "idle",
          backfill_status: hasPendingBackfill ? "scheduled" : current.backfill_status ?? "idle",
          backfill_next_run_at: hasPendingBackfill ? nowIso : null,
          backfill_phase: current.backfill_phase === "vendas" ? "vendas" : "cr",
          last_error: null,
          updated_at: nowIso,
        })
        .eq("id", onlyIntegrationId);

      if (unlockError) throw unlockError;

      return new Response(JSON.stringify({
        ok: true,
        mode: "force_unlock",
        integration_id: onlyIntegrationId,
        resumed_backfill: hasPendingBackfill,
        message: hasPendingBackfill
          ? "Execução destravada e backfill reagendado a partir do lote atual."
          : "Execução destravada com sucesso.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== MODO 1: tick do cron — processa próximo chunk de qualquer integração pronta ==========
    if (mode === "backfill_tick") {
      // Inclui tanto "running" (já em andamento) quanto "scheduled" (agendadas pelo "Ressincronizar tudo").
      // Quando uma loja "scheduled" é pega, promovemos para "running" antes de processar.
      const { data: pending } = await supabase
        .from("ssotica_integrations")
        .select("*")
        .eq("is_active", true)
        .in("backfill_status", ["running", "scheduled"])
        .lte("backfill_next_run_at", new Date().toISOString())
        .order("backfill_next_run_at", { ascending: true })
        .limit(BACKFILL_MAX_PARALLEL); // limita concorrência para evitar cancelamento do worker
      const list = await decryptIntegrations(supabase, (pending ?? []) as Integration[]);
      if (list.length === 0) {
        return new Response(JSON.stringify({ ok: true, message: "Nenhum chunk pronto" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const results: any[] = [];
      for (const integ of list) {
        // Promove "scheduled" → "running" para que runBackfillChunk processe normalmente
        if (integ.backfill_status === "scheduled") {
          await supabase
            .from("ssotica_integrations")
            .update({ backfill_status: "running", sync_status: "running" })
            .eq("id", integ.id);
          (integ as any).backfill_status = "running";
        }
        const r = await runBackfillChunk(supabase, integ, dispatchConfig);
        results.push({ integration_id: integ.id, ...r });
      }
      return new Response(JSON.stringify({ ok: true, mode: "backfill_tick", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== MODO 2: consolidar cobranças cross-store sem reimportar dados ==========
    if (mode === "consolidate_only") {
      const consolidation = await consolidateCrossStoreCobrancas(supabase);
      console.log(`[ssotica-sync][consolidation-only] groups_merged=${consolidation.groups_merged} cards_removed=${consolidation.cards_removed}`);
      return new Response(JSON.stringify({ ok: true, mode, consolidation }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== MODO 3: iniciar backfill de 96 meses (botão "Resincronizar tudo") ==========
    if (mode === "start_backfill") {
      if (!onlyIntegrationId) {
        return new Response(JSON.stringify({ ok: false, error: "integration_id obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rawScope = typeof body.scope === "string" ? body.scope : "all";
      const scope: "all" | "cobrancas" | "renovacoes" =
        rawScope === "cobrancas" || rawScope === "renovacoes" ? rawScope : "all";
      const initialPhase: "cr" | "vendas" = scope === "renovacoes" ? "vendas" : "cr";

      // 🔒 EXCLUSIVIDADE: pausa qualquer outra loja em execução para evitar
      // sobrecarregar a SSótica com requisições paralelas e estourar timeouts.
      // Marca como "idle" e zera o agendamento de backfill das demais. O backfill
      // pode ser retomado depois manualmente pelo botão Sincronizar.
      // Obs: feito em duas chamadas separadas para evitar o problema do PostgREST
      // que confunde vírgulas dentro de `in.()` quando usado em `.or()`.
      try {
        const pauseFields = {
          sync_status: "idle",
          backfill_status: "idle",
          backfill_next_run_at: null,
          last_error: "Pausado automaticamente — outra loja foi acionada manualmente.",
          updated_at: new Date().toISOString(),
        };
        await supabase
          .from("ssotica_integrations")
          .update(pauseFields)
          .neq("id", onlyIntegrationId)
          .eq("sync_status", "running");
        await supabase
          .from("ssotica_integrations")
          .update(pauseFields)
          .neq("id", onlyIntegrationId)
          .in("backfill_status", ["running", "scheduled"]);
      } catch (pauseErr) {
        console.error("[ssotica-sync][start_backfill] erro ao pausar outras lojas:", pauseErr);
      }

      // Reseta o progresso e marca pra rodar AGORA (próximo tick do cron pega)
      const { data: integ, error } = await supabase
        .from("ssotica_integrations")
        .update({
          backfill_chunk_index: 0,
          backfill_total_chunks: 32,
          backfill_phase: initialPhase,
          backfill_scope: scope,
          backfill_status: "scheduled",
          backfill_started_at: new Date().toISOString(),
          backfill_next_run_at: new Date().toISOString(),
          sync_status: "idle",
          last_error: null,
        })
        .eq("id", onlyIntegrationId)
        .select("*")
        .single();
      if (error || !integ) throw error ?? new Error("Integração não encontrada");
      if (!dispatchConfig.url || !dispatchConfig.auth) {
        throw new Error("Configuração de dispatch ausente para enfileirar o backfill");
      }

      const { error: dispatchErr } = await supabase.rpc("ssotica_enqueue_sync", {
        _url: dispatchConfig.url,
        _auth: dispatchConfig.auth,
        _integration_id: onlyIntegrationId,
        _force_full: false,
      });
      if (dispatchErr) throw dispatchErr;

      const scopeLabel = scope === "renovacoes" ? "renovações" : scope === "cobrancas" ? "cobranças" : "completo";
      return new Response(JSON.stringify({
        ok: true,
        mode: "start_backfill",
        scope,
        message: `Backfill de 96 meses (${scopeLabel}) agendado em background. Demais lojas foram pausadas para evitar sobrecarga.`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== MODO 3.5: retomar backfill pendente sem reiniciar do zero ==========
    // Se vier manual_recent=true junto, caímos no fluxo padrão abaixo para rodar
    // primeiro o sweep manual de cobrança e só então continuar o backfill.
    if (mode === "resume_backfill" && !manualRecent) {
      if (!onlyIntegrationId) {
        return new Response(JSON.stringify({ ok: false, error: "integration_id obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const nowIso = new Date().toISOString();
      const { data: current, error: currentError } = await supabase
        .from("ssotica_integrations")
        .select("*")
        .eq("id", onlyIntegrationId)
        .maybeSingle();

      if (currentError) throw currentError;
      if (!current || current.backfill_status === "done") {
        return new Response(JSON.stringify({ ok: false, error: "Nenhum backfill pendente para retomar" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const leaseActive = !!current.backfill_next_run_at && new Date(current.backfill_next_run_at).getTime() > Date.now();
      if (current.backfill_status === "running" && leaseActive) {
        return new Response(JSON.stringify({
          ok: true,
          mode: "resume_backfill",
          already_running: true,
          chunk_index: current.backfill_chunk_index || 0,
          total_chunks: current.backfill_total_chunks || 32,
          message: `O chunk ${(current.backfill_chunk_index || 0) + 1}/${current.backfill_total_chunks || 32} já está em execução.`,
        }), {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: integ, error } = await supabase
        .from("ssotica_integrations")
        .update({
          sync_status: "idle",
          backfill_status: "scheduled",
          backfill_next_run_at: nowIso,
          last_error: null,
        })
        .eq("id", onlyIntegrationId)
        .eq("backfill_chunk_index", current.backfill_chunk_index || 0)
        .neq("backfill_status", "done")
        .select("*")
        .maybeSingle();

      if (error) throw error;
      if (!integ) {
        return new Response(JSON.stringify({ ok: false, error: "Nenhum backfill pendente para retomar" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!dispatchConfig.url || !dispatchConfig.auth) {
        throw new Error("Configuração de dispatch ausente para retomar o backfill");
      }

      const { error: dispatchErr } = await supabase.rpc("ssotica_enqueue_sync", {
        _url: dispatchConfig.url,
        _auth: dispatchConfig.auth,
        _integration_id: onlyIntegrationId,
        _force_full: false,
      });
      if (dispatchErr) throw dispatchErr;

      return new Response(JSON.stringify({
        ok: true,
        mode: "resume_backfill",
        chunk_index: integ.backfill_chunk_index || 0,
        total_chunks: integ.backfill_total_chunks || 32,
        message: `Backfill retomado em background a partir do chunk ${(integ.backfill_chunk_index || 0) + 1}/${integ.backfill_total_chunks || 32}.`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== MODO 4 (default): sync incremental ==========
    // 🔒 EXCLUSIVIDADE: clique manual em "Sincronizar" de UMA loja pausa as
    // demais para evitar sobrecarregar a SSótica com requisições paralelas.
    if (onlyIntegrationId && manualRecent) {
      await supabase
        .from("ssotica_integrations")
        .update({
          sync_status: "idle",
          backfill_status: "idle",
          backfill_next_run_at: null,
          last_error: "Pausado automaticamente — outra loja foi acionada manualmente.",
          updated_at: new Date().toISOString(),
        })
        .neq("id", onlyIntegrationId)
        .or("sync_status.eq.running,backfill_status.in.(running,scheduled)");
    }

    const query = supabase
      .from("ssotica_integrations")
      .select("*")
      .eq("is_active", true);
    if (onlyIntegrationId) query.eq("id", onlyIntegrationId);

    const { data: integrations, error: intErr } = await query;
    if (intErr) throw intErr;
    if (!integrations || integrations.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "Nenhuma integração ativa" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 🧹 LIMPEZA AUTOMÁTICA: SEMPRE roda (fan-out OU sub-invocação single).
    // Libera integrações que ficaram presas em "running" há mais de
    // RUNNING_SYNC_STALE_MINUTES min (execuções abortadas, fechamento de browser,
    // runtime morto, timeout da edge function ~400s, etc.) e fecha logs órfãos.
    //
    // ⚠️ CRÍTICO: rodar isso também em sub-invocações (com onlyIntegrationId)
    // garante que, mesmo se uma execução anterior morreu por timeout, a próxima
    // tentativa via pg_net consiga destravar a si mesma e prosseguir. Antes,
    // a limpeza só rodava no fan-out, então uma loja que travasse permanecia
    // presa até o próximo ciclo COMPLETO do cron principal — e mesmo aí,
    // se o pg_net já tivesse re-enfileirado, o status voltava a "running"
    // antes do auto-cleanup do ciclo seguinte rodar.
    {
      const staleCutoff = new Date(Date.now() - RUNNING_SYNC_STALE_MINUTES * 60 * 1000).toISOString();
      const nowIsoStale = new Date().toISOString();
      const staleQuery = supabase
        .from("ssotica_integrations")
        .select("id")
        .eq("sync_status", "running")
        .lt("updated_at", staleCutoff)
        // Só considera órfã se o lease do heartbeat também expirou (ou não existe).
        // Isso evita matar uma execução viva que está apenas processando um chunk grande.
        .or(`backfill_next_run_at.is.null,backfill_next_run_at.lt.${nowIsoStale}`);
      // Em sub-invocação, restringe à própria integração (evita interferir em outras lojas)
      if (onlyIntegrationId) staleQuery.eq("id", onlyIntegrationId);
      const { data: staleIntegs } = await staleQuery;
      if (staleIntegs && staleIntegs.length > 0) {
        const staleIds = staleIntegs.map((s: any) => s.id);
        await supabase
          .from("ssotica_integrations")
          .update({
            sync_status: "idle",
            last_error: `Destravado automaticamente — execução excedeu ${RUNNING_SYNC_STALE_MINUTES} min sem finalizar.`,
            updated_at: new Date().toISOString(),
          })
          .in("id", staleIds);
        await supabase
          .from("ssotica_sync_logs")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: `Execução órfã encerrada automaticamente após ${RUNNING_SYNC_STALE_MINUTES} min.`,
          })
          .in("integration_id", staleIds)
          .eq("status", "running");
        // Atualiza o array em memória para que o processamento abaixo reconheça as liberadas
        for (const integ of integrations as any[]) {
          if (staleIds.includes(integ.id)) {
            integ.sync_status = "idle";
            integ.updated_at = new Date().toISOString();
          }
        }
        console.log(`[ssotica-sync][auto-cleanup] destravadas ${staleIds.length} integrações: ${staleIds.join(", ")}`);
      }
    }

    // ⚡ FAN-OUT via pg_net: enfileiramos um POST HTTP no banco para cada loja.
    // Diferente de `fetch + waitUntil` (que pode ser morto quando o runtime pai
    // termina), `pg_net.http_post` é executado pelo worker do Postgres — cada
    // chamada vira uma invocação totalmente isolada da edge function, com seu
    // próprio orçamento de tempo. Isso elimina os travamentos de Caicó/Jucurutu
    // que ocorriam quando o runtime pai era encerrado antes dos disparos paralelos.
    if (!onlyIntegrationId && integrations.length > 1) {
      if (!dispatchConfig.url || !dispatchConfig.auth) {
        throw new Error("Configuração de dispatch ausente para enfileirar o fan-out das integrações");
      }
      const dispatched: string[] = [];
      const fanoutSkipped: any[] = [];
      const fanoutErrors: any[] = [];
      for (const integ of integrations as Integration[]) {
        if (integ.sync_status === "running" && !isRunningSyncStale(integ as any)) {
          fanoutSkipped.push({ integration_id: integ.id, ok: true, skipped: true, reason: "already_running" });
          continue;
        }
        const { error: dispatchErr } = await supabase.rpc("ssotica_enqueue_sync", {
          _url: dispatchConfig.url,
          _auth: dispatchConfig.auth,
          _integration_id: integ.id,
          _force_full: forceFull,
        });
        if (dispatchErr) {
          console.error(`[ssotica-sync][fanout] erro enfileirando ${integ.id}:`, dispatchErr);
          fanoutErrors.push({ integration_id: integ.id, error: dispatchErr.message });
          continue;
        }
        dispatched.push(integ.id);
      }
      return new Response(JSON.stringify({
        ok: true,
        mode: "incremental_fanout_pgnet",
        dispatched_count: dispatched.length,
        dispatched,
        skipped: fanoutSkipped,
        errors: fanoutErrors,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await decryptIntegrations(supabase, integrations as Integration[]);

    const results: any[] = [];
    for (const integ of integrations as Integration[]) {
      let logId: string | null = null;
      try {
        // 🔓 Sync MANUAL (botão "Sincronizar" de uma loja específica): força destrave.
        // Mesmo que outra execução tenha travado essa loja em "running" (e ainda não
        // tenha passado o auto-cleanup de 15min), liberamos AGORA — afeta apenas a
        // loja escolhida, sem mexer nas outras.
        const isManualSingle = !!onlyIntegrationId && manualRecent;

        if (!isManualSingle && integ.sync_status === "running" && !isRunningSyncStale(integ)) {
          results.push({ integration_id: integ.id, ok: true, skipped: true, reason: "already_running" });
          continue;
        }

        if (isManualSingle || isRunningSyncStale(integ)) {
          await supabase
            .from("ssotica_sync_logs")
            .update({
              finished_at: new Date().toISOString(),
              status: "error",
              error_message: isManualSingle
                ? "Execução anterior encerrada — usuário acionou sincronização manual desta loja."
                : `Execução anterior excedeu ${RUNNING_SYNC_STALE_MINUTES} min e foi encerrada automaticamente antes do novo ciclo.`,
            })
            .eq("integration_id", integ.id)
            .eq("status", "running");
          // Garante que o claim abaixo encontre sync_status != "running"
          if (isManualSingle && integ.sync_status === "running") {
            await supabase
              .from("ssotica_integrations")
              .update({ sync_status: "idle" })
              .eq("id", integ.id);
            integ.sync_status = "idle";
          }
        }

        const { data: claimedIntegration } = await supabase
          .from("ssotica_integrations")
          .update({ sync_status: "running", last_error: null })
          .eq("id", integ.id)
          .neq("sync_status", "running")
          .select("id")
          .maybeSingle();

        if (!claimedIntegration) {
          results.push({ integration_id: integ.id, ok: true, skipped: true, reason: "claim_failed" });
          continue;
        }

        // ===== Se o backfill ainda está em andamento, roda APENAS o próximo chunk e
        // retorna. Não roda o sync incremental por cima — isso duplicava trabalho
        // (mesmas vendas/cobranças sincronizadas 2x) e em lojas grandes (Parelhas/
        // Jucurutu) estourava o timeout de 400s do edge runtime, fazendo o cursor
        // ser avançado mas o processamento NUNCA terminar — o que causava o loop
        // visível: chunk 1/16 sendo "iniciado" repetidamente sem nunca ir pro 2/16.
        // O incremental real só roda DEPOIS que o backfill chegar a "done". =====
        if (integ.backfill_status === "running" || integ.backfill_status === "scheduled") {
          // 🧹 Sync MANUAL ("Sincronizar agora") com backfill pendente: roda PRIMEIRO
          // o sweep de contas a receber em modo manualRecent (365d + 60 futuros)
          // para limpar cards cuja parcela a SSótica já removeu da resposta
          // (ex.: cliente quitou e o card ficou preso). Sem isso, o usuário teria
          // que esperar o backfill terminar (pode levar dias em lojas grandes).
          let manualSweep: any = null;
          if (isManualSingle) {
            try {
              console.log(`[ssotica-sync][manual_sweep] empresa=${integ.company_id} rodando sweep de quitação antes do chunk de backfill`);
              manualSweep = await syncContasReceber(supabase, integ, undefined, { manualRecent: true });
              console.log(`[ssotica-sync][manual_sweep] empresa=${integ.company_id} sweep done removed=${manualSweep?.removed ?? 0} updated=${manualSweep?.updated ?? 0}`);
            } catch (e) {
              console.error(`[ssotica-sync][manual_sweep] empresa=${integ.company_id} falhou: ${(e as Error).message}`);
            }
          }
          const r = await runBackfillChunk(supabase, integ, dispatchConfig);
          await supabase.from("ssotica_integrations").update({
            sync_status: "idle",
          }).eq("id", integ.id);
          results.push({ integration_id: integ.id, ok: true, mode: "backfill_chunk", chunk: r, manual_sweep: manualSweep });
          continue;
        }

        const { data: log } = await supabase.from("ssotica_sync_logs").insert({
          integration_id: integ.id,
          sync_type: forceFull ? "full_force" : "incremental",
          status: "running",
        }).select("id").single();
        logId = log?.id ?? null;

        // ⏱️ Timeout interno por integração: 2 min (120s) — abaixo do idle timeout
        // do runtime hospedado. Isso garante que mesmo se
        // a SSótica travar/lentificar para uma loja específica, o catch abaixo
        // roda, o log é marcado como "error" com diagnóstico claro, e a próxima
        // execução do cron pode imediatamente tentar de novo (sem ficar 5min "running").
        const integrationStart = Date.now();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            const elapsed = Math.round((Date.now() - integrationStart) / 1000);
            reject(new Error(
              `Timeout interno (${elapsed}s) — integração ${integ.id} (empresa=${integ.company_id}) ` +
              `não concluiu em ${PER_INTEGRATION_TIMEOUT_MS / 1000}s. ` +
              `Provável causa: SSótica lenta/travada, volume de dados grande, ou loop em uma etapa específica. ` +
              `Veja os checkpoints anteriores no log para identificar onde travou.`
            ));
          }, PER_INTEGRATION_TIMEOUT_MS);
        });

        const work = (async () => {
          // Checkpoint 1: Contas a Receber (para que Renovações saibam quem tem dívida)
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=contas_receber:start`);
          const cr = await syncContasReceber(supabase, integ, undefined, { manualRecent: manualRecent && !!onlyIntegrationId });
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=contas_receber:done processed=${cr.processed} created=${cr.created} updated=${cr.updated}`);

          // Checkpoint 2: Consolidação cross-store de cobranças
          const shouldConsolidateAfterReceber = await shouldRunGlobalConsolidation(supabase, onlyIntegrationId);
          let consolidationAfterReceber = { groups_merged: 0, cards_removed: 0 };
          if (shouldConsolidateAfterReceber) {
            console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=consolidation:start`);
            consolidationAfterReceber = await consolidateCrossStoreCobrancas(supabase);
            console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=consolidation:done groups_merged=${consolidationAfterReceber.groups_merged} cards_removed=${consolidationAfterReceber.cards_removed}`);
          } else {
            console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=consolidation:skipped coordinator_only=true`);
          }

          // Checkpoint 3: Vendas
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=vendas:start`);
          const v = await syncVendas(supabase, integ, forceFull, cr.clientesQuitados);
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=vendas:done processed=${v.processed} created=${v.created} updated=${v.updated}`);

          // Checkpoint 4: Reconciliação Renovações × Cobranças
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=reconcile:start`);
          const reconciled = await reconcileRenovacoesVsCobrancas(supabase, integ.company_id);
          console.log(`[ssotica-sync][checkpoint] empresa=${integ.company_id} step=reconcile:done removed=${reconciled}`);

          return { cr, v, consolidationAfterReceber, reconciled };
        })();

        const { cr, v, consolidationAfterReceber, reconciled } = await Promise.race([work, timeoutPromise]);
        console.log(`[ssotica-sync][incremental] empresa=${integ.company_id} reconciliação removeu ${reconciled} renovações com dívida aberta`);

        const finishedAt = new Date().toISOString();
        await supabase.from("ssotica_integrations").update({
          sync_status: "idle",
          last_sync_receber_at: finishedAt,
          last_sync_vendas_at: finishedAt,
          initial_sync_done: true,
          last_error: null,
        }).eq("id", integ.id);

        if (logId) {
          await supabase.from("ssotica_sync_logs").update({
            finished_at: finishedAt,
            status: "success",
            items_processed: cr.processed + v.processed,
            items_created: cr.created + v.created,
            items_updated: cr.updated + v.updated,
            details: { contas_receber: cr, vendas: v, consolidation_after_cobrancas: consolidationAfterReceber },
          }).eq("id", logId);
        }

        results.push({ integration_id: integ.id, ok: true, contas_receber: cr, vendas: v, consolidation_after_cobrancas: consolidationAfterReceber });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[ssotica-sync] integration ${integ.id} failed:`, msg);
        await supabase.from("ssotica_integrations").update({
          sync_status: "error",
          last_error: msg.slice(0, 1000),
        }).eq("id", integ.id);
        if (logId) {
          await supabase.from("ssotica_sync_logs").update({
            finished_at: new Date().toISOString(),
            status: "error",
            error_message: msg.slice(0, 2000),
          }).eq("id", logId);
        }
        results.push({ integration_id: integ.id, ok: false, error: msg });
      }
    }

    // ===== Consolidação cross-loja =====
    // Depois que todas as integrações sincronizaram, mescla cards do mesmo cliente
    // (por CPF/telefone) que estejam em lojas diferentes. Mantém o card da loja
    // que possui a parcela mais antiga e une todas as parcelas em atraso ali.
    let consolidation: { groups_merged: number; cards_removed: number } = { groups_merged: 0, cards_removed: 0 };
    const shouldRunFinalConsolidation = await shouldRunGlobalConsolidation(supabase, onlyIntegrationId);
    if (shouldRunFinalConsolidation) {
      try {
        consolidation = await consolidateCrossStoreCobrancas(supabase);
        console.log(`[ssotica-sync][consolidation] groups_merged=${consolidation.groups_merged} cards_removed=${consolidation.cards_removed}`);
      } catch (e) {
        console.error("[ssotica-sync][consolidation] erro:", e instanceof Error ? e.message : String(e));
      }
    } else {
      console.log(`[ssotica-sync][consolidation] skipped coordinator_only=true integration=${onlyIntegrationId}`);
    }

    return new Response(JSON.stringify({ ok: true, results, consolidation, started_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ssotica-sync] fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
