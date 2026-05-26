/**
 * ============================================================================
 * Edge Function: send-whatsapp
 * ============================================================================
 * Envia mensagens de WhatsApp via API Full (https://api.apifull.com.br).
 *
 * RESPONSABILIDADES:
 *   - Receber pedido de envio (lead/cobranca/renovacao + texto/imagem)
 *   - Resolver placeholders no template ({{nome}}, {{valor}}, etc.)
 *   - Chamar a API Full e interpretar a resposta (success / error)
 *   - Registrar log do envio na tabela `whatsapp_logs`
 *
 * MÓDULOS SUPORTADOS:
 *   - leads      → tabela crm_leads      / status crm_statuses
 *   - cobrancas  → tabela crm_cobrancas  / status crm_cobranca_statuses
 *   - renovacoes → tabela crm_renovacoes / status crm_renovacao_statuses
 *
 * REFERÊNCIA DA API:
 *   POST /send-message  → texto puro
 *   POST /send-image    → texto + imagem (campo `file` com URL)
 *   Headers: Authorization: Bearer <api_key>
 * ============================================================================
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Headers CORS para permitir chamada do frontend. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** URL base da API Full (provedor de WhatsApp). */
const APIFULL_BASE = "https://api.apifull.com.br/whatsapp";

const SUCCESS_TOKENS = ["success", "sucesso", "sent", "enviado", "accepted", "queued", "ok"];
const ERROR_TOKENS = [
  "error", "erro", "failed", "failure", "invalid", "invalido", "inválido",
  "offline", "disconnected", "desconect", "not connected", "não conectado",
  "nao conectado", "not found", "forbidden", "blocked",
];

// ========== Module configuration ==========
type ModuleKey = "leads" | "cobrancas" | "renovacoes";
const MODULE_CONFIG: Record<ModuleKey, { dataTable: string; statusTable: string; useFormBuilder: boolean; activityTable: string; activityFk: string }> = {
  leads:      { dataTable: "crm_leads",      statusTable: "crm_statuses",            useFormBuilder: true,  activityTable: "lead_activities",      activityFk: "lead_id" },
  cobrancas:  { dataTable: "crm_cobrancas",  statusTable: "crm_cobranca_statuses",   useFormBuilder: false, activityTable: "cobranca_activities",  activityFk: "cobranca_id" },
  renovacoes: { dataTable: "crm_renovacoes", statusTable: "crm_renovacao_statuses",  useFormBuilder: false, activityTable: "renovacao_activities", activityFk: "renovacao_id" },
};

// Cache de um admin para usar como created_by fallback em activities geradas pelo sistema.
let _systemUserIdCache: string | null = null;
async function getSystemUserId(supabase: any): Promise<string | null> {
  if (_systemUserIdCache) return _systemUserIdCache;
  const { data } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  _systemUserIdCache = data?.user_id || null;
  return _systemUserIdCache;
}

async function logWhatsappActivity(
  supabase: any,
  moduleKey: ModuleKey,
  card: any,
  title: string,
  description: string,
) {
  try {
    const cfg = MODULE_CONFIG[moduleKey];
    const createdBy = card?.assigned_to || card?.created_by || (await getSystemUserId(supabase));
    if (!createdBy) {
      console.warn(`[logWhatsappActivity] sem created_by para card ${card?.id}, pulando`);
      return;
    }
    const nowIso = new Date().toISOString();
    await supabase.from(cfg.activityTable).insert({
      [cfg.activityFk]: card.id,
      created_by: createdBy,
      title,
      description,
      scheduled_date: nowIso,
      completed_at: nowIso,
    });
  } catch (e) {
    console.error("[logWhatsappActivity] erro:", e);
  }
}


function extractApiMessages(result: any) {
  return [
    result?.message, result?.mensagem, result?.error, result?.msg, result?.status,
    result?.data?.message, result?.data?.mensagem, result?.data?.error, result?.data?.msg, result?.data?.status,
  ].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function includesToken(values: string[], tokens: string[]) {
  const haystack = values.join(" ").toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

function resolveSendResult(responseOk: boolean, result: any) {
  const messages = extractApiMessages(result);
  const fallback = messages[0] || "A API Full não confirmou o envio da mensagem";
  const boolFlags = [result?.success, result?.sucesso, result?.data?.success].filter((v) => typeof v === "boolean");

  if (!responseOk) return { ok: false, errorMessage: fallback };
  if (boolFlags.includes(false)) return { ok: false, errorMessage: fallback };
  if (includesToken(messages, ERROR_TOKENS)) return { ok: false, errorMessage: fallback };
  if (boolFlags.includes(true) || includesToken(messages, SUCCESS_TOKENS)) return { ok: true, errorMessage: null };
  return { ok: false, errorMessage: "A API Full respondeu sem confirmar claramente que a mensagem foi enviada" };
}

async function sendMessage(session: string, apiKey: string, phone: string, text: string, imageUrl?: string | null) {
  const endpoint = imageUrl ? "/send-image" : "/send-message";
  const body: Record<string, any> = imageUrl
    ? { session, number: phone, text, file: imageUrl }
    : { session, number: phone, text, isGroup: false };

  const response = await fetch(`${APIFULL_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let result: any = null;
  try { result = responseText ? JSON.parse(responseText) : null; } catch { result = { raw: responseText }; }
  return resolveSendResult(response.ok, result);
}

// Delay between WhatsApp sends to avoid being banned (default 30s, configurable via system_settings)
const DEFAULT_SEND_DELAY_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadSendDelayMs(supabase: any): Promise<number> {
  const { data } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "whatsapp_send_delay_seconds")
    .maybeSingle();
  const secs = parseInt(data?.setting_value || "", 10);
  if (!isNaN(secs) && secs >= 0) return secs * 1000;
  return DEFAULT_SEND_DELAY_MS;
}

async function loadCobrancasSessions(supabase: any): Promise<string[]> {
  // 1) Sessões explicitamente selecionadas via settings (round-robin)
  const { data: setting } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "whatsapp_cobrancas_sessions")
    .maybeSingle();
  let configured: string[] = [];
  const raw = setting?.setting_value;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) configured = parsed.filter((s: any) => typeof s === "string" && s.trim());
    } catch {
      configured = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (configured.length > 0) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("session, is_active")
      .in("session", configured)
      .eq("is_active", true);
    const valid = new Set(((data || []) as any[]).map((i) => i.session));
    const ordered = configured.filter((s) => valid.has(s));
    if (ordered.length > 0) return ordered;
  }

  // 2) Fallback: todas as instâncias ativas sem empresa vinculada
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("session, is_active, company_id, created_at")
    .is("company_id", null)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  return ((data || []) as any[]).map((i) => i.session).filter(Boolean);
}

// Brasília time helpers (UTC-3, no DST)
const BRT_OFFSET_MINUTES = -180;
function nowInBrasilia(): Date {
  const now = new Date();
  return new Date(now.getTime() + (BRT_OFFSET_MINUTES - now.getTimezoneOffset()) * 60_000);
}
function currentMinutesOfDayBRT(): number {
  const d = nowInBrasilia();
  return d.getHours() * 60 + d.getMinutes();
}
function timeStringToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [hh, mm] = t.split(":").map((x) => parseInt(x, 10));
  if (isNaN(hh) || isNaN(mm)) return null;
  return hh * 60 + mm;
}
function isWithinDailyWindow(startTime?: string | null, endTime?: string | null): boolean {
  const start = timeStringToMinutes(startTime) ?? 0;     // default 00:00
  const end   = timeStringToMinutes(endTime)   ?? 24 * 60; // default 24:00
  const now = currentMinutesOfDayBRT();
  return now >= start && now < end;
}

function cleanPhone(phone: string) {
  let clean = phone.replace(/\D/g, "");
  if (clean.startsWith("0")) clean = clean.substring(1);
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
}

function resolveCardFields(
  module: ModuleKey,
  data: Record<string, any>,
  nameFields: any[],
  phoneFields: any[],
) {
  if (MODULE_CONFIG[module].useFormBuilder) {
    let phone = "";
    for (const f of phoneFields) {
      const val = data[`field_${f.id}`];
      if (val) { phone = val; break; }
    }
    if (!phone) phone = data.telefone || data.phone || "";

    let name = "";
    for (const f of nameFields) {
      const val = data[`field_${f.id}`];
      if (val) { name = val; break; }
    }
    if (!name) name = data.nome_lead || data.nome || "Cliente";

    return { phone, name };
  }
  const phone = data.telefone || data.phone || data.celular || "";
  const name = data.nome || data.nome_lead || data.name || "Cliente";
  return { phone, name };
}

async function resolveSession(supabase: any, instanceId: string | null): Promise<string | null> {
  if (instanceId) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("session, is_active")
      .eq("id", instanceId)
      .single();
    if (data?.is_active) return data.session;
    return null;
  }
  const { data } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "apifull_session")
    .single();
  return data?.setting_value || null;
}

async function getCompanyUserIds(supabase: any, companyId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: profs } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("company_id", companyId);
  for (const p of (profs || []) as { user_id: string }[]) ids.add(p.user_id);

  const { data: mgrs } = await supabase
    .from("manager_companies")
    .select("user_id")
    .eq("company_id", companyId);
  for (const m of (mgrs || []) as { user_id: string }[]) ids.add(m.user_id);

  return ids;
}

function filterCardsByCompany(cards: any[], companyUserIds: Set<string>): any[] {
  return cards.filter((l) => {
    const cb = l.created_by;
    const at = l.assigned_to;
    return (cb && companyUserIds.has(cb)) || (at && companyUserIds.has(at));
  });
}

// Para campanhas globais: descobre o company_id de um lead pelos seus user ids (assigned_to/created_by → profiles.company_id)
async function buildUserToCompanyMap(supabase: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: profs } = await supabase
    .from("profiles")
    .select("user_id, company_id");
  for (const p of (profs || []) as { user_id: string; company_id: string | null }[]) {
    if (p.user_id && p.company_id) map.set(p.user_id, p.company_id);
  }
  return map;
}

// Para campanhas globais: cache de instância ativa por empresa
async function buildCompanyToSessionMap(supabase: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: insts } = await supabase
    .from("whatsapp_instances")
    .select("company_id, session, is_active")
    .eq("is_active", true);
  for (const i of (insts || []) as { company_id: string | null; session: string }[]) {
    if (i.company_id && i.session && !map.has(i.company_id)) {
      map.set(i.company_id, i.session);
    }
  }
  return map;
}

function resolveCardCompanyId(card: any, userToCompany: Map<string, string>): string | null {
  if (card.assigned_to && userToCompany.has(card.assigned_to)) return userToCompany.get(card.assigned_to)!;
  if (card.created_by && userToCompany.has(card.created_by)) return userToCompany.get(card.created_by)!;
  return null;
}

async function resolveStatusKey(supabase: any, statusTable: string, statusId: string): Promise<string> {
  const { data } = await supabase.from(statusTable).select("key").eq("id", statusId).single();
  return data?.key || "";
}

// ============= Template variables (placeholders) =============
function formatBRL(v: any): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatDateBR(s: any): string {
  if (!s) return "";
  const str = String(s).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return String(s);
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function buildCobrancaVars(
  card: any,
  name: string,
  companies: Map<string, { name: string; cnpj: string | null }>,
): Record<string, string> {
  const data = (card?.data && typeof card.data === "object") ? card.data : {};
  const parcelas: any[] = Array.isArray(data.parcelas_atrasadas) ? data.parcelas_atrasadas : [];
  const vencidas = parcelas.filter((p) => Number(p?.dias_atraso) > 0);
  const aVencer = parcelas.filter((p) => Number(p?.dias_atraso) <= 0)
    .sort((a, b) => String(a?.vencimento || "").localeCompare(String(b?.vencimento || "")));
  const vencidasOrdenadas = vencidas.slice().sort((a, b) => Number(b?.dias_atraso || 0) - Number(a?.dias_atraso || 0));
  const pVencida = vencidasOrdenadas[0] || parcelas.find((p) => Number(p?.dias_atraso) > 0);
  const pAVencer = aVencer[0];

  const totalParcelas = vencidas.reduce((sum, p) => {
    const v = typeof p?.valor === "number" ? p.valor : parseFloat(String(p?.valor ?? "0").replace(",", "."));
    return sum + (isFinite(v) ? v : 0);
  }, 0);
  const totalEffective = totalParcelas > 0 ? totalParcelas : Number(data.total_atraso || 0);

  // Lista formatada das parcelas em atraso, ordenadas do vencimento mais antigo
  // para o mais novo. Mostra Valor e Data de vencimento em cada linha.
  // Fallback: se o filtro estrito de dias_atraso>0 não retornar nada (algumas
  // integrações gravam dias_atraso=0 mesmo para vencidas), usamos todas as
  // parcelas do array parcelas_atrasadas.
  const baseListagem = vencidas.length > 0 ? vencidas : parcelas;
  const vencidasParaLista = baseListagem.slice().sort((a, b) =>
    String(a?.vencimento || "9999-12-31").localeCompare(String(b?.vencimento || "9999-12-31")),
  );
  const listaParcelasVencidas = vencidasParaLista
    .map((p) => `• Valor: ${formatBRL(p?.valor)} | Vencimento: ${formatDateBR(p?.vencimento)}`)
    .join("\n");

  // Boleto/parcela mais antigo entre as vencidas (menor vencimento).
  // Usa o mesmo fallback de baseListagem para cobrir integrações que gravam
  // dias_atraso=0 mesmo em parcelas já vencidas.
  const maisAntigo = vencidasParaLista[0];


  const companyId = card?.company_id || card?.ssotica_company_id || null;
  const company = companyId ? companies.get(companyId) : null;

  return {
    nome: name || "",
    valor_parcela_vencida: pVencida ? formatBRL(pVencida.valor) : "",
    valor_parcela_a_vencer: pAVencer ? formatBRL(pAVencer.valor) : "",
    data_parcela_vencida: pVencida ? formatDateBR(pVencida.vencimento) : "",
    data_parcela_a_vencer: pAVencer ? formatDateBR(pAVencer.vencimento) : "",
    cnpj_empresa: company?.cnpj || "",
    nome_empresa: company?.name || "",
    valor_total_parcelas: formatBRL(totalEffective),
    parcelas_vencidas: listaParcelasVencidas,
    data_boleto_mais_antigo: maisAntigo ? formatDateBR(maisAntigo.vencimento) : "",
  };
}
function applyTemplateVars(template: string, vars: Record<string, string>): string {
  if (!template) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\s*${k}\\s*\\}`, "gi");
    out = out.replace(re, v ?? "");
  }
  return out;
}

function resolveCardEnteredAt(card: any): Date {
  const data = (card?.data && typeof card.data === "object") ? card.data : {};
  const currentStatus = String(card?.status || "");
  const enteredStatusKey = String(data?.status_entered_status_key || "");
  const enteredAtRaw = data?.status_entered_at;

  if (enteredAtRaw && enteredStatusKey === currentStatus) {
    const parsed = new Date(String(enteredAtRaw));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // Fallback: created_at do card. Usar updated_at quebrava cards que já estavam
  // na coluna antes da campanha existir — qualquer edição "reiniciava o timer",
  // fazendo passos com delay_days > 0 nunca dispararem para cards antigos.
  const fallback = new Date(card?.created_at || card?.updated_at);
  if (!Number.isNaN(fallback.getTime())) return fallback;

  return new Date();
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const APIFULL_API_KEY = Deno.env.get("APIFULL_API_KEY");
    if (!APIFULL_API_KEY) throw new Error("APIFULL_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: formFields } = await supabase
      .from("crm_form_fields")
      .select("id, label, is_name_field, is_phone_field");
    const nameFields = (formFields || []).filter((f: any) => f.is_name_field);
    const phoneFields = (formFields || []).filter((f: any) => f.is_phone_field);

    let totalSent = 0;
    let totalErrors = 0;
    let skippedNoCompany = 0;
    let skippedOutOfWindow = 0;
    let isFirstSend = true;
    const today = new Date().toISOString().split("T")[0];

    const companyUsersCache = new Map<string, Set<string>>();
    const getUsers = async (companyId: string) => {
      if (!companyUsersCache.has(companyId)) {
        companyUsersCache.set(companyId, await getCompanyUserIds(supabase, companyId));
      }
      return companyUsersCache.get(companyId)!;
    };

    // Pré-carregados para campanhas globais (company_id IS NULL)
    const userToCompany = await buildUserToCompanyMap(supabase);
    const companyToSession = await buildCompanyToSessionMap(supabase);

    // Configurações dinâmicas
    const SEND_DELAY_MS = await loadSendDelayMs(supabase);
    const cobrancasSessions = await loadCobrancasSessions(supabase);
    const pickRoundRobinSession = (index: number): string | null => {
      if (cobrancasSessions.length === 0) return null;
      return cobrancasSessions[index % cobrancasSessions.length];
    };

    // Mapa session -> nome da instância (para logs de gatilho de cobrança)
    const sessionToInstanceName = new Map<string, string>();
    {
      const { data: allInstances } = await supabase
        .from("whatsapp_instances")
        .select("session, name");
      for (const i of (allInstances || []) as any[]) {
        if (i?.session) sessionToInstanceName.set(i.session, i.name || i.session);
      }
    }
    // Mapa company_id -> { name, cnpj } para variáveis de template
    const companiesMap = new Map<string, { name: string; cnpj: string | null }>();
    {
      const { data: comps } = await supabase.from("companies").select("id, name, cnpj");
      for (const c of (comps || []) as any[]) {
        if (c?.id) companiesMap.set(c.id, { name: c.name || "", cnpj: c.cnpj || null });
      }
    }


    // ========== PERIOD CAMPAIGNS ==========
    const { data: campaigns } = await supabase.from("whatsapp_campaigns")
      .select("*").eq("is_active", true).lte("start_date", today).gte("end_date", today);

    if (campaigns && campaigns.length > 0) {
      for (const campaign of campaigns) {
        const isGlobal = !campaign.company_id;

        // Daily time window (Brasília)
        if (!isWithinDailyWindow(campaign.start_time, campaign.end_time)) {
          skippedOutOfWindow++;
          continue;
        }

        const moduleKey = (campaign.module || "leads") as ModuleKey;
        const cfg = MODULE_CONFIG[moduleKey];
        if (!cfg) continue;

        // Cobranças: round-robin entre instâncias sem empresa vinculada.
        // Global (sem empresa): sessão por card (instância da empresa do lead).
        // Caso normal: sessão fixa da campanha.
        const isCobrancas = moduleKey === "cobrancas";
        const fixedSession = (isGlobal || isCobrancas) ? null : await resolveSession(supabase, campaign.instance_id);
        if (!isGlobal && !isCobrancas && !fixedSession) continue;
        if (isCobrancas && cobrancasSessions.length === 0) {
          console.warn(`[campaign ${campaign.id}] cobranças sem instâncias sem empresa vinculada — pulando`);
          continue;
        }

        const statusKey = await resolveStatusKey(supabase, cfg.statusTable, campaign.status_id);
        if (!statusKey) continue;

        // Busca label da coluna para o log
        const { data: statusRow } = await supabase
          .from(cfg.statusTable)
          .select("label, key")
          .eq("id", campaign.status_id)
          .single();
        const statusLabel = statusRow?.label || statusKey;

        const { data: cards } = await supabase.from(cfg.dataTable)
          .select(isCobrancas ? "id, data, created_by, assigned_to, company_id, ssotica_company_id" : "id, data, created_by, assigned_to").eq("status", statusKey);
        if (!cards) continue;

        let scopedCards: any[];
        if (isGlobal) {
          // Pega todos os cards da coluna (sem filtrar por empresa)
          scopedCards = cards;
        } else {
          const companyUsers = await getUsers(campaign.company_id);
          scopedCards = filterCardsByCompany(cards, companyUsers);
        }
        if (scopedCards.length === 0) continue;

        const { data: existingSends } = await supabase.from("whatsapp_campaign_sends")
          .select("lead_id, status").eq("campaign_id", campaign.id);
        const sentIds = new Set((existingSends || []).filter((s: any) => s.status === "sent").map((s: any) => s.lead_id));
        const pendingCards = scopedCards.filter((l: any) => !sentIds.has(l.id));

        // Conta envios feitos nesta execução para detectar conclusão da coluna
        let campaignSentNow = 0;
        let campaignErrorsNow = 0;
        let aborted = false;
        // Round-robin index para cobrancas (persistente entre execuções via sentIds.size)
        let rrIndex = sentIds.size;

        for (const card of pendingCards) {
          // Re-check window mid-batch (in case we cross end_time)
          if (!isWithinDailyWindow(campaign.start_time, campaign.end_time)) {
            skippedOutOfWindow++;
            aborted = true;
            break;
          }

          const data = typeof card.data === "object" ? (card.data as Record<string, any>) : {};
          // Lock por entrada na coluna (cobranças): evita reenvio enquanto o
          // card estiver na mesma coluna. Limpo pelo trigger DB ao mudar status.
          const alreadyTriggeredForStatus = isCobrancas && data.gatilho_status_key === statusKey && data.gatilho_enviado_em;
          if (alreadyTriggeredForStatus) continue;
          const { phone, name } = resolveCardFields(moduleKey, data, nameFields, phoneFields);
          if (!phone) continue;

          // Resolve sessão por card
          let session = fixedSession;
          if (isCobrancas) {
            session = pickRoundRobinSession(rrIndex);
            rrIndex++;
          } else if (isGlobal) {
            const cardCompanyId = resolveCardCompanyId(card, userToCompany);
            if (!cardCompanyId) {
              skippedNoCompany++;
              continue;
            }
            session = companyToSession.get(cardCompanyId) || null;
            if (!session) {
              skippedNoCompany++;
              continue;
            }
          }

          const vars = buildCobrancaVars(card, name, companiesMap);
          const messageBody = applyTemplateVars(campaign.message, vars);
          const cp = cleanPhone(phone);

          try {
            if (!isFirstSend) await sleep(SEND_DELAY_MS);
            isFirstSend = false;
            const result = await sendMessage(session!, APIFULL_API_KEY, cp, messageBody, campaign.image_url);
            if (result.ok) {
              await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "sent", sent_at: new Date().toISOString() });
              await logWhatsappActivity(supabase, moduleKey, card, `WhatsApp enviado — ${campaign.name}`, messageBody);
              totalSent++;
              campaignSentNow++;
              await supabase.from(cfg.dataTable).update({
                data: { ...(typeof card.data === "object" ? card.data : {}), envio_erro: null, envio_erro_em: null, envio_erro_campaign_id: null, envio_erro_campaign_name: null },
              }).eq("id", card.id);
            } else {
              const errMsg = result.errorMessage || "Erro";
              await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "error", error_message: errMsg });
              totalErrors++;
              campaignErrorsNow++;
              await supabase.from(cfg.dataTable).update({
                data: { ...(typeof card.data === "object" ? card.data : {}), envio_erro: errMsg, envio_erro_em: new Date().toISOString(), envio_erro_campaign_id: campaign.id, envio_erro_campaign_name: campaign.name },
              }).eq("id", card.id);
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : "Unknown error";
            await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "error", error_message: errMsg });
            totalErrors++;
            campaignErrorsNow++;
            await supabase.from(cfg.dataTable).update({
              data: { ...(typeof card.data === "object" ? card.data : {}), envio_erro: errMsg, envio_erro_em: new Date().toISOString(), envio_erro_campaign_id: campaign.id, envio_erro_campaign_name: campaign.name },
            }).eq("id", card.id);
          }

        }

        // Se processamos todos os cards pendentes (não abortou) e havia algo a fazer, registra conclusão
        if (!aborted && pendingCards.length > 0) {
          // Verifica se realmente todos os cards da coluna agora têm envio
          const { data: finalSends } = await supabase.from("whatsapp_campaign_sends")
            .select("lead_id, status").eq("campaign_id", campaign.id);
          const finalSentIds = new Set((finalSends || []).filter((s: any) => s.status === "sent").map((s: any) => s.lead_id));
          const stillPending = scopedCards.filter((c: any) => !finalSentIds.has(c.id));
          if (stillPending.length === 0) {
            await supabase.from("whatsapp_completion_logs").insert({
              source_type: "campaign",
              source_id: campaign.id,
              source_name: campaign.name,
              module: moduleKey,
              status_id: campaign.status_id,
              status_label: statusLabel,
              status_key: statusKey,
              company_id: campaign.company_id,
              total_cards: scopedCards.length,
              sent_count: campaignSentNow,
              error_count: campaignErrorsNow,
              completed_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    // ========== TRIGGER CAMPAIGNS ==========
    const { data: triggerCampaigns } = await supabase.from("whatsapp_trigger_campaigns")
      .select("*, whatsapp_trigger_steps(*)").eq("is_active", true);

    if (triggerCampaigns && triggerCampaigns.length > 0) {
      for (const tc of triggerCampaigns) {
        const isGlobal = !tc.company_id;

        if (!isWithinDailyWindow(tc.start_time, tc.end_time)) {
          skippedOutOfWindow++;
          continue;
        }

        const moduleKey = (tc.module || "leads") as ModuleKey;
        const cfg = MODULE_CONFIG[moduleKey];
        if (!cfg) continue;

        // ----- Estratégia de sessão -----
        // 1) instance_ids da própria campanha: round-robin se vier 2+
        // 2) instance_id / instance_ids(1) da própria campanha: sessão fixa
        // 3) Cobranças sem instância definida na campanha: fallback global
        // 4) Campanha global sem instância definida: sessão da empresa do card
        const isCobrancas = moduleKey === "cobrancas";
        const rawInstanceIds = Array.isArray((tc as any).instance_ids)
          ? ((tc as any).instance_ids as any[]).filter((v) => typeof v === "string" && v)
          : [];
        const selectedSessions: string[] = [];
        for (const iid of rawInstanceIds) {
          const s = await resolveSession(supabase, iid);
          if (s) selectedSessions.push(s);
        }
        const useMultiRoundRobin = selectedSessions.length >= 2;
        const fixedSelectedSession = selectedSessions.length === 1 ? selectedSessions[0] : null;
        const fixedSession = fixedSelectedSession || (!useMultiRoundRobin && tc.instance_id
          ? await resolveSession(supabase, tc.instance_id)
          : null);
        const useGlobalCobrancasFallback = isCobrancas && !useMultiRoundRobin && !fixedSession;
        const useCompanySessionFallback = isGlobal && !isCobrancas && !useMultiRoundRobin && !fixedSession;

        if (!useMultiRoundRobin && !fixedSession && !useGlobalCobrancasFallback && !useCompanySessionFallback) continue;
        if (useGlobalCobrancasFallback && cobrancasSessions.length === 0) {
          console.warn(`[trigger ${tc.id}] cobranças sem instâncias sem empresa vinculada — pulando`);
          continue;
        }

        const steps = ((tc as any).whatsapp_trigger_steps || []).sort((a: any, b: any) => a.position - b.position);
        if (steps.length === 0) continue;

        const statusKey = await resolveStatusKey(supabase, cfg.statusTable, tc.status_id);
        if (!statusKey) continue;

        const { data: tcStatusRow } = await supabase
          .from(cfg.statusTable)
          .select("label, key")
          .eq("id", tc.status_id)
          .single();
        const tcStatusLabel = tcStatusRow?.label || statusKey;

        const { data: cardsRaw } = await supabase.from(cfg.dataTable)
          .select(isCobrancas ? "id, data, status, created_at, updated_at, created_by, assigned_to, company_id, ssotica_company_id" : "id, data, status, created_at, updated_at, created_by, assigned_to").eq("status", statusKey);
        if (!cardsRaw || cardsRaw.length === 0) continue;

        let cards: any[];
        if (isGlobal) {
          cards = cardsRaw;
        } else {
          const companyUsers = await getUsers(tc.company_id);
          cards = filterCardsByCompany(cardsRaw, companyUsers);
        }
        if (cards.length === 0) continue;

        const { data: existingSends } = await supabase.from("whatsapp_trigger_sends")
          .select("lead_id, step_id, status, sent_at").eq("campaign_id", tc.id);

        // Mantém timestamp por (card, step) para permitir filtrar por "entrada atual" na coluna.
        // Quando o card sai e volta para a coluna, sends anteriores não devem mais contar
        // como "já enviado nesta entrada", senão o gatilho nunca dispararia novamente.
        const sendsByCardWithTs = new Map<string, Map<string, number>>();
        const lastSentAtByCard = new Map<string, number>();
        for (const s of (existingSends || []) as any[]) {
          if (s.status === "sent") {
            const ts = s.sent_at ? new Date(s.sent_at).getTime() : 0;
            if (!sendsByCardWithTs.has(s.lead_id)) sendsByCardWithTs.set(s.lead_id, new Map());
            const m = sendsByCardWithTs.get(s.lead_id)!;
            const prevStep = m.get(s.step_id) || 0;
            if (ts > prevStep) m.set(s.step_id, ts);
            const prev = lastSentAtByCard.get(s.lead_id) || 0;
            if (ts > prev) lastSentAtByCard.set(s.lead_id, ts);
          }
        }
        // Compat para o cálculo de "pendentes" (preview de quantos cards faltam)
        const sendsByCard = new Map<string, Set<string>>();
        for (const [cardId, m] of sendsByCardWithTs.entries()) {
          sendsByCard.set(cardId, new Set(m.keys()));
        }

        const totalSteps = steps.length;
        const cardsWithPendingBefore = cards.filter((c: any) => {
          const sent = sendsByCard.get(c.id) || new Set();
          return sent.size < totalSteps;
        });

        let triggerSentNow = 0;
        let triggerErrorsNow = 0;
        let aborted = false;
        // Round-robin: começa do total de envios bem-sucedidos já feitos (alterna entre execuções)
        let rrIndex = 0;
        for (const s of (existingSends || []) as any[]) {
          if (s.status === "sent") rrIndex++;
        }

        for (const card of cards) {
          if (!isWithinDailyWindow(tc.start_time, tc.end_time)) {
            skippedOutOfWindow++;
            aborted = true;
            break;
          }

          const data = typeof card.data === "object" ? (card.data as Record<string, any>) : {};
          const { phone, name } = resolveCardFields(moduleKey, data, nameFields, phoneFields);
          if (!phone) continue;

          // ----- LOCK por entrada na coluna -----
          // Só envia UMA vez por entrada do card na coluna. O lock é limpo
          // automaticamente pelo trigger DB `_reset_gatilho_on_status_change`
          // quando o card muda de status. Se o card sair e voltar para a mesma
          // coluna, o lock é limpo nas duas transições → reenvia normalmente.
          if (
            data.gatilho_campaign_id === tc.id &&
            data.gatilho_status_key === statusKey &&
            data.gatilho_enviado_em
          ) {
            continue;
          }

          // Reforço: também ignora envios anteriores feitos APÓS a entrada
          // atual na coluna (cobre execuções simultâneas onde o lock ainda
          // não foi gravado).
          const enteredAt = resolveCardEnteredAt(card);
          const enteredAtMs = enteredAt.getTime();
          const sendsMapForCard = sendsByCardWithTs.get(card.id) || new Map<string, number>();
          const sentStepIds = new Set<string>();
          for (const [stepId, ts] of sendsMapForCard.entries()) {
            if (ts >= enteredAtMs) sentStepIds.add(stepId);
          }

          // Resolve sessão por card
          let session = fixedSession;
          if (useGlobalCobrancasFallback) {
            session = pickRoundRobinSession(rrIndex);
          } else if (useMultiRoundRobin) {
            session = selectedSessions[rrIndex % selectedSessions.length];
          } else if (useCompanySessionFallback) {
            const cardCompanyId = resolveCardCompanyId(card, userToCompany);
            if (!cardCompanyId) {
              skippedNoCompany++;
              continue;
            }
            session = companyToSession.get(cardCompanyId) || null;
            if (!session) {
              skippedNoCompany++;
              continue;
            }
          }

          const now = new Date();
          const daysSinceEntry = Math.floor((now.getTime() - enteredAtMs) / (1000 * 60 * 60 * 24));

          for (const step of steps) {
            if (sentStepIds.has(step.id)) continue;
            if (daysSinceEntry < step.delay_days) continue;

            const vars = buildCobrancaVars(card, name, companiesMap);
            const messageBody = applyTemplateVars(step.message, vars);
            const cp = cleanPhone(phone);

            try {
              if (!isFirstSend) await sleep(SEND_DELAY_MS);
              isFirstSend = false;
              const result = await sendMessage(session!, APIFULL_API_KEY, cp, messageBody, step.image_url);
              const instanceName = sessionToInstanceName.get(session!) || session!;
              if (result.ok) {
                const sentAt = new Date().toISOString();
                await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "sent", sent_at: sentAt });
                await logWhatsappActivity(supabase, moduleKey, card, `WhatsApp enviado — ${tc.name} (passo ${step.position})`, messageBody);
                totalSent++;
                triggerSentNow++;
                // avança round-robin (cobrancas / instance_ids) somente após envio bem-sucedido
                rrIndex++;
                // Grava lock "gatilho enviado nesta entrada na coluna" em TODOS os módulos
                await supabase
                  .from(cfg.dataTable)
                  .update({
                    data: {
                      ...data,
                      status_entered_at: data.status_entered_at ?? sentAt,
                      status_entered_status_key: data.status_entered_status_key ?? statusKey,
                      gatilho_enviado_em: sentAt,
                      gatilho_status_key: statusKey,
                      gatilho_campaign_id: tc.id,
                      gatilho_campaign_name: tc.name,
                      envio_erro: null,
                      envio_erro_em: null,
                      envio_erro_campaign_id: null,
                      envio_erro_campaign_name: null,
                    },
                  })
                  .eq("id", card.id);
                if (isCobrancas) {
                  await supabase.from("crm_cobranca_flow_events").insert({
                    cobranca_id: card.id,
                    status_id: tc.status_id,
                    status_key: statusKey,
                    status_label: tcStatusLabel,
                    event_type: "gatilho_enviado",
                    whatsapp_trigger_campaign_id: tc.id,
                    whatsapp_trigger_campaign_name: tc.name,
                    details: { phone: cp, session, instance_name: instanceName, step_position: step.position, sent_at: sentAt },
                  });
                }
              } else {
                const errMsg = result.errorMessage || "Erro";
                await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "error", error_message: errMsg });
                totalErrors++;
                triggerErrorsNow++;
                // Marca o card com erro de envio (vermelho) e fixa o lock do gatilho
                // para NÃO reprocessar este card a cada 5 min — assim libera fila p/ outros gatilhos.
                // Lock é limpo automaticamente quando o card muda de coluna.
                const nowIso = new Date().toISOString();
                await supabase
                  .from(cfg.dataTable)
                  .update({
                    data: {
                      ...data,
                      status_entered_at: data.status_entered_at ?? nowIso,
                      status_entered_status_key: data.status_entered_status_key ?? statusKey,
                      gatilho_enviado_em: nowIso,
                      gatilho_status_key: statusKey,
                      gatilho_campaign_id: tc.id,
                      gatilho_campaign_name: tc.name,
                      envio_erro: errMsg,
                      envio_erro_em: nowIso,
                      envio_erro_campaign_id: tc.id,
                      envio_erro_campaign_name: tc.name,
                    },
                  })
                  .eq("id", card.id);
                if (isCobrancas) {
                  await supabase.from("crm_cobranca_flow_events").insert({
                    cobranca_id: card.id,
                    status_id: tc.status_id,
                    status_key: statusKey,
                    status_label: tcStatusLabel,
                    event_type: "gatilho_falhou",
                    whatsapp_trigger_campaign_id: tc.id,
                    whatsapp_trigger_campaign_name: tc.name,
                    details: { phone: cp, session, instance_name: instanceName, step_position: step.position, error: errMsg },
                  });
                }
              }
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : "Unknown error";
              await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "error", error_message: errMsg });
              totalErrors++;
              triggerErrorsNow++;
              const nowIso = new Date().toISOString();
              await supabase
                .from(cfg.dataTable)
                .update({
                  data: {
                    ...data,
                    status_entered_at: data.status_entered_at ?? nowIso,
                    status_entered_status_key: data.status_entered_status_key ?? statusKey,
                    gatilho_enviado_em: nowIso,
                    gatilho_status_key: statusKey,
                    gatilho_campaign_id: tc.id,
                    gatilho_campaign_name: tc.name,
                    envio_erro: errMsg,
                    envio_erro_em: nowIso,
                    envio_erro_campaign_id: tc.id,
                    envio_erro_campaign_name: tc.name,
                  },
                })
                .eq("id", card.id);
              if (isCobrancas) {
                const instanceName = sessionToInstanceName.get(session!) || session!;
                await supabase.from("crm_cobranca_flow_events").insert({
                  cobranca_id: card.id,
                  status_id: tc.status_id,
                  status_key: statusKey,
                  status_label: tcStatusLabel,
                  event_type: "gatilho_falhou",
                  whatsapp_trigger_campaign_id: tc.id,
                  whatsapp_trigger_campaign_name: tc.name,
                  details: { phone: cp, session, instance_name: instanceName, step_position: step.position, error: errMsg },
                });
              }
            }


            break;
          }
        }

        // Verifica se TODOS os cards da coluna concluíram TODOS os steps após esta execução
        if (!aborted && cardsWithPendingBefore.length > 0 && triggerSentNow > 0) {
          const { data: finalSends } = await supabase.from("whatsapp_trigger_sends")
            .select("lead_id, step_id, status").eq("campaign_id", tc.id);
          const finalByCard = new Map<string, Set<string>>();
          for (const s of (finalSends || []) as any[]) {
            if (s.status === "sent") {
              if (!finalByCard.has(s.lead_id)) finalByCard.set(s.lead_id, new Set());
              finalByCard.get(s.lead_id)!.add(s.step_id);
            }
          }
          const stillPending = cards.filter((c: any) => {
            const sent = finalByCard.get(c.id) || new Set();
            return sent.size < totalSteps;
          });
          if (stillPending.length === 0) {
            await supabase.from("whatsapp_completion_logs").insert({
              source_type: "trigger",
              source_id: tc.id,
              source_name: tc.name,
              module: moduleKey,
              status_id: tc.status_id,
              status_label: tcStatusLabel,
              status_key: statusKey,
              company_id: tc.company_id,
              total_cards: cards.length,
              sent_count: triggerSentNow,
              error_count: triggerErrorsNow,
              completed_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ message: "Processamento concluído", sent: totalSent, errors: totalErrors, skipped_no_company: skippedNoCompany, skipped_out_of_window: skippedOutOfWindow }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("send-whatsapp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
