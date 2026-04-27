import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFULL_BASE = "https://api.apifull.com.br/whatsapp";

const SUCCESS_TOKENS = ["success", "sucesso", "sent", "enviado", "accepted", "queued", "ok"];
const ERROR_TOKENS = [
  "error", "erro", "failed", "failure", "invalid", "invalido", "inválido",
  "offline", "disconnected", "desconect", "not connected", "não conectado",
  "nao conectado", "not found", "forbidden", "blocked",
];

// ========== Module configuration ==========
type ModuleKey = "leads" | "cobrancas" | "renovacoes";
const MODULE_CONFIG: Record<ModuleKey, { dataTable: string; statusTable: string; useFormBuilder: boolean }> = {
  leads:      { dataTable: "crm_leads",      statusTable: "crm_statuses",            useFormBuilder: true  },
  cobrancas:  { dataTable: "crm_cobrancas",  statusTable: "crm_cobranca_statuses",   useFormBuilder: false },
  renovacoes: { dataTable: "crm_renovacoes", statusTable: "crm_renovacao_statuses",  useFormBuilder: false },
};

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

// Delay between WhatsApp sends to avoid being banned (30 seconds)
const SEND_DELAY_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

        // Para global, a sessão é resolvida por card (instância da empresa do lead).
        // Para não-global, resolvemos uma sessão fixa.
        const fixedSession = isGlobal ? null : await resolveSession(supabase, campaign.instance_id);
        if (!isGlobal && !fixedSession) continue;

        const statusKey = await resolveStatusKey(supabase, cfg.statusTable, campaign.status_id);
        if (!statusKey) continue;

        const { data: cards } = await supabase.from(cfg.dataTable)
          .select("id, data, created_by, assigned_to").eq("status", statusKey);
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

        for (const card of pendingCards) {
          // Re-check window mid-batch (in case we cross end_time)
          if (!isWithinDailyWindow(campaign.start_time, campaign.end_time)) {
            skippedOutOfWindow++;
            break;
          }

          const data = typeof card.data === "object" ? (card.data as Record<string, any>) : {};
          const { phone, name } = resolveCardFields(moduleKey, data, nameFields, phoneFields);
          if (!phone) continue;

          // Resolve sessão por card quando global
          let session = fixedSession;
          if (isGlobal) {
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

          const messageBody = campaign.message.replace(/\{nome\}/gi, name);
          const cp = cleanPhone(phone);

          try {
            if (!isFirstSend) await sleep(SEND_DELAY_MS);
            isFirstSend = false;
            const result = await sendMessage(session!, APIFULL_API_KEY, cp, messageBody, campaign.image_url);
            if (result.ok) {
              await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "sent", sent_at: new Date().toISOString() });
              totalSent++;
            } else {
              await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "error", error_message: result.errorMessage || "Erro" });
              totalErrors++;
            }
          } catch (e) {
            await supabase.from("whatsapp_campaign_sends").insert({ campaign_id: campaign.id, lead_id: card.id, phone: cp, status: "error", error_message: e instanceof Error ? e.message : "Unknown error" });
            totalErrors++;
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

        // Para global, sessão é resolvida por card. Para não-global, sessão fixa.
        const fixedSession = isGlobal ? null : await resolveSession(supabase, tc.instance_id);
        if (!isGlobal && !fixedSession) continue;

        const steps = ((tc as any).whatsapp_trigger_steps || []).sort((a: any, b: any) => a.position - b.position);
        if (steps.length === 0) continue;

        const statusKey = await resolveStatusKey(supabase, cfg.statusTable, tc.status_id);
        if (!statusKey) continue;

        const { data: cardsRaw } = await supabase.from(cfg.dataTable)
          .select("id, data, status, updated_at, created_by, assigned_to").eq("status", statusKey);
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
          .select("lead_id, step_id, status").eq("campaign_id", tc.id);

        const sendsByCard = new Map<string, Set<string>>();
        for (const s of (existingSends || []) as any[]) {
          if (s.status === "sent") {
            if (!sendsByCard.has(s.lead_id)) sendsByCard.set(s.lead_id, new Set());
            sendsByCard.get(s.lead_id)!.add(s.step_id);
          }
        }

        for (const card of cards) {
          if (!isWithinDailyWindow(tc.start_time, tc.end_time)) {
            skippedOutOfWindow++;
            break;
          }

          const data = typeof card.data === "object" ? (card.data as Record<string, any>) : {};
          const { phone, name } = resolveCardFields(moduleKey, data, nameFields, phoneFields);
          if (!phone) continue;

          // Resolve sessão por card quando global
          let session = fixedSession;
          if (isGlobal) {
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

          const sentStepIds = sendsByCard.get(card.id) || new Set();
          const enteredAt = new Date(card.updated_at);
          const now = new Date();
          const daysSinceEntry = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));

          for (const step of steps) {
            if (sentStepIds.has(step.id)) continue;
            if (daysSinceEntry < step.delay_days) continue;

            const messageBody = step.message.replace(/\{nome\}/gi, name);
            const cp = cleanPhone(phone);

            try {
              if (!isFirstSend) await sleep(SEND_DELAY_MS);
              isFirstSend = false;
              const result = await sendMessage(session!, APIFULL_API_KEY, cp, messageBody, step.image_url);
              if (result.ok) {
                await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "sent", sent_at: new Date().toISOString() });
                totalSent++;
              } else {
                await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "error", error_message: result.errorMessage || "Erro" });
                totalErrors++;
              }
            } catch (e) {
              await supabase.from("whatsapp_trigger_sends").insert({ campaign_id: tc.id, step_id: step.id, lead_id: card.id, phone: cp, status: "error", error_message: e instanceof Error ? e.message : "Unknown error" });
              totalErrors++;
            }

            break;
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
