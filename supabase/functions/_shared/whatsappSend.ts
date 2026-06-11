/**
 * Envio WhatsApp unificado: API Full (legado) ou Cloud API (Meta).
 */
import { normalizeMetaLanguage, resolveMetaTemplateParams } from "./metaTemplateVars.ts";
export type WhatsAppProvider = "apifull" | "meta";

export type InstanceRow = {
  id?: string;
  provider?: string | null;
  session?: string | null;
  phone_number_id?: string | null;
  waba_id?: string | null;
  meta_default_template?: string | null;
  meta_template_language?: string | null;
  is_active?: boolean | null;
};

export type SendTarget = {
  provider: WhatsAppProvider;
  session: string | null;
  phoneNumberId: string | null;
  instanceId: string | null;
  wabaId: string | null;
  metaDefaultTemplate: string | null;
  metaTemplateLanguage: string;
};

export type SendResult = {
  ok: boolean;
  errorMessage: string | null;
  raw?: unknown;
  httpStatus?: number;
  metaMessageId?: string;
  usedTemplate?: boolean;
  templateDebug?: {
    source: string;
    wabaId: string | null;
    language: string;
    bodyCount: number;
    headerCount: number;
    buttonCount: number;
    bodyParams?: Array<{ name?: string; text: string }>;
  };
};

export type MetaTemplateButtonSlot = {
  index: number;
  subType: string;
  params: MetaTemplateBodyParam[];
};

const APIFULL_BASE = "https://api.apifull.com.br/whatsapp";
const GRAPH_API_VERSION = "v21.0";

const SUCCESS_TOKENS = ["success", "sucesso", "sent", "enviado", "accepted", "queued", "ok"];
const ERROR_TOKENS = [
  "error", "erro", "failed", "failure", "invalid", "invalido", "inválido",
  "offline", "disconnected", "desconect", "not connected", "não conectado",
  "nao conectado", "not found", "forbidden", "blocked",
  "restri", "banimento", "banido", "bloqueio", "limite excedido",
];

/** Dígitos nacionais BR (DDD + número), sem código 55. */
export function nationalPhoneDigits(value: string): string {
  let d = (value || "").replace(/\D/g, "");
  while (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  while (d.startsWith("0") && d.length > 11) d = d.slice(1);
  return d;
}

function isBrazilianMobileNational(d: string): boolean {
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return false;
  if (d.length === 11) return d.charAt(2) === "9";
  const firstSubscriber = d.charAt(2);
  return firstSubscriber >= "6" && firstSubscriber <= "9";
}

/** Celular BR com 9 dígitos após o DDD (insere o 9º dígito móvel quando faltar). */
export function nationalMobileDigits(value: string): string {
  let d = nationalPhoneDigits(value);
  if (d.length === 10 && isBrazilianMobileNational(d)) {
    d = `${d.slice(0, 2)}9${d.slice(2)}`;
  }
  return d;
}

export function waIdsEquivalent(a: string, b: string): boolean {
  const da = nationalMobileDigits(a);
  const db = nationalMobileDigits(b);
  if (da.length >= 10 && db.length >= 10 && da === db) return true;
  if (da.length >= 10 && db.length >= 10 && da.slice(-8) === db.slice(-8)) return true;
  return false;
}

/** wa_id canônico para inbox e envio (55 + DDD + celular com 9 dígitos). */
export function normalizeWaId(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.slice(1);
  const national = nationalMobileDigits(d.startsWith("55") ? d : `55${d}`);
  if (national.length >= 10) return `55${national}`;
  if (!d.startsWith("55")) return `55${d}`;
  return d;
}

export function cleanPhone(phone: string): string {
  return normalizeWaId(phone);
}

export function instanceRowToTarget(row: InstanceRow | null): SendTarget | null {
  if (!row) return null;
  const provider: WhatsAppProvider = row.provider === "meta" ? "meta" : "apifull";
  if (provider === "meta") {
    const phoneNumberId = row.phone_number_id || row.session || null;
    if (!phoneNumberId) return null;
    return {
      provider: "meta",
      session: row.session || phoneNumberId,
      phoneNumberId,
      instanceId: row.id || null,
      wabaId: row.waba_id || null,
      metaDefaultTemplate: row.meta_default_template || null,
      metaTemplateLanguage: row.meta_template_language || "pt_BR",
    };
  }
  if (!row.session) return null;
  return {
    provider: "apifull",
    session: row.session,
    phoneNumberId: null,
    instanceId: row.id || null,
    wabaId: null,
    metaDefaultTemplate: null,
    metaTemplateLanguage: "pt_BR",
  };
}

function extractApiMessages(result: unknown): string[] {
  const r = result as Record<string, unknown>;
  return [
    r?.message, r?.mensagem, r?.error, r?.msg, r?.status,
    (r?.data as Record<string, unknown>)?.message,
    (r?.data as Record<string, unknown>)?.mensagem,
    (r?.data as Record<string, unknown>)?.error,
    (r?.data as Record<string, unknown>)?.msg,
    (r?.data as Record<string, unknown>)?.status,
  ].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function includesToken(values: string[], tokens: string[]) {
  const haystack = values.join(" ").toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

function resolveApifullResult(responseOk: boolean, result: unknown): SendResult {
  const messages = extractApiMessages(result);
  const fallback = messages[0] || "A API Full não confirmou o envio da mensagem";
  const r = result as Record<string, unknown>;
  const boolFlags = [
    r?.success, r?.sucesso, (r?.data as Record<string, unknown>)?.success,
    (r?.data as Record<string, unknown>)?.sucesso,
  ].filter((v) => typeof v === "boolean") as boolean[];

  if (!responseOk) return { ok: false, errorMessage: fallback, raw: result };
  if (boolFlags.includes(false)) return { ok: false, errorMessage: fallback, raw: result };
  if (includesToken(messages, ERROR_TOKENS)) return { ok: false, errorMessage: fallback, raw: result };
  if (boolFlags.includes(true) || includesToken(messages, SUCCESS_TOKENS)) {
    return { ok: true, errorMessage: null, raw: result };
  }
  if (responseOk) return { ok: true, errorMessage: null, raw: result };
  return { ok: false, errorMessage: fallback, raw: result };
}

export function translateWhatsAppError(message: string): string {
  const raw = (message || "").trim();
  if (!raw) return raw;
  if (/\b463\b/.test(raw)) {
    return (
      "WhatsApp recusou o envio (erro 463): limite para iniciar conversa com este número. " +
      "Use um template aprovado na Meta ou aguarde o cliente responder."
    );
  }
  if (/template/i.test(raw) && /required|obrigat/i.test(raw)) {
    return raw;
  }
  if (/\b131047\b/.test(raw) || /re-engagement|24.?hour|janela/i.test(raw)) {
    return (
      "Fora da janela de 24h da Meta: só é permitido enviar mensagem com template aprovado. " +
      "Configure o nome do template na campanha/gatilho ou aguarde resposta do cliente."
    );
  }
  if (/api access blocked|access blocked|blocked by meta/i.test(raw)) {
    return (
      "Meta bloqueou o envio (API access blocked). Veja business.facebook.com → Suporte da conta: " +
      "se a WABA estiver «desativada permanentemente», nenhum ajuste no CRM resolve — só revisão Meta ou nova conta/número. " +
      "Se o app estiver só em Desenvolvimento, cadastre o destinatário em WhatsApp → API Setup → números de teste."
    );
  }
  if (/\b131031\b/.test(raw) || /account (is )?locked|conta.*bloqueada|desativad/i.test(raw)) {
    return (
      "Conta WhatsApp Business (WABA) bloqueada ou desativada pela Meta. " +
      "Envio e recebimento ficam suspensos até a revisão ser aprovada ou até usar outra WABA/número aprovado."
    );
  }
  if (/\b368\b/.test(raw) || /temporarily blocked|policy|política/i.test(raw)) {
    return (
      "Meta restringiu a conta por política (spam, template ou qualidade). " +
      "Abra business.facebook.com → Suporte → violações e solicite revisão com evidências."
    );
  }
  if (/\(#100\)|\b100\b/.test(raw) && /invalid parameter/i.test(raw)) {
    return (
      "Meta recusou o template (erro #100 — parâmetro inválido). " +
      "Confira se o nome/idioma do template batem com o painel Meta e se a quantidade de variáveis {{1}}, {{2}}… " +
      "é igual às chaves {nome}, {valor_a_vencer}, {data_a_vencer} etc. na mensagem do gatilho."
    );
  }
  if (/\b132001\b/.test(raw) || /template name does not exist/i.test(raw)) {
    return (
      "Meta: template não encontrado nesta conta WhatsApp (erro #132001). " +
      "Cada número (Cobrança 1, Cobrança 2, etc.) pertence a uma conta WABA diferente na Meta — o template precisa estar " +
      "APROVADO (Ativo) na mesma conta do número que envia, com o mesmo nome e idioma (ex.: pt_BR) configurados no gatilho."
    );
  }
  if (/\b132018\b/.test(raw) || /issue with the parameters/i.test(raw)) {
    return (
      "Meta: parâmetros do template incorretos (erro #132018). " +
      "As variáveis na mensagem do gatilho ({nome}, {valor_total}, {data_boleto_ant}, etc.) devem ter os mesmos nomes " +
      "e a mesma ordem do template aprovado na Meta. Não pode faltar variável nem sobrar."
    );
  }
  return raw;
}

export function isMetaTemplateParamError(message: string): boolean {
  const raw = (message || "").trim();
  return /\b132018\b/.test(raw) || /issue with the parameters/i.test(raw);
}

async function sendApifull(
  apiKey: string,
  session: string,
  phone: string,
  text: string,
  imageUrl?: string | null,
): Promise<SendResult> {
  const endpoint = imageUrl ? "/send-image" : "/send-message";
  const body: Record<string, unknown> = imageUrl
    ? { session, number: phone, text, file: imageUrl }
    : { session, number: phone, text, isGroup: false };

  const response = await fetch(`${APIFULL_BASE}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let result: unknown = null;
  try { result = responseText ? JSON.parse(responseText) : null; } catch { result = { raw: responseText }; }
  const resolved = resolveApifullResult(response.ok, result);
  return { ...resolved, httpStatus: response.status };
}

export async function isMetaWindowOpen(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  instanceId: string | null,
  waId: string,
  conversationId?: string | null,
): Promise<boolean> {
  const cp = cleanPhone(waId);
  if (!cp) return false;

  if (instanceId) {
    const { data: exact } = await supabase
      .from("whatsapp_conversations")
      .select("window_expires_at")
      .eq("instance_id", instanceId)
      .eq("wa_id", cp)
      .maybeSingle();
    if (exact?.window_expires_at && new Date(exact.window_expires_at).getTime() > Date.now()) {
      return true;
    }

    const { data: rows } = await supabase
      .from("whatsapp_conversations")
      .select("window_expires_at, wa_id")
      .eq("instance_id", instanceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(80);
    for (const row of rows || []) {
      if (!waIdsEquivalent(String(row.wa_id || ""), cp)) continue;
      if (row.window_expires_at && new Date(row.window_expires_at).getTime() > Date.now()) {
        return true;
      }
    }
  }

  if (conversationId) {
    const { data: lastIn } = await supabase
      .from("whatsapp_messages")
      .select("created_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastIn?.created_at) {
      const expires = new Date(lastIn.created_at).getTime() + 24 * 60 * 60 * 1000;
      return expires > Date.now();
    }
  }

  return false;
}

async function sendMetaText(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  text: string,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = (json as { error?: { message?: string; code?: number } })?.error;
    const msg = translateWhatsAppError(
      err?.message || `Meta API HTTP ${response.status}`,
    );
    return { ok: false, errorMessage: msg, raw: json, httpStatus: response.status };
  }
  const messageId = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id;
  return { ok: true, errorMessage: null, raw: json, httpStatus: response.status, metaMessageId: messageId };
}

async function sendMetaImage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption: caption || undefined },
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = (json as { error?: { message?: string } })?.error;
    return {
      ok: false,
      errorMessage: translateWhatsAppError(err?.message || `Meta API HTTP ${response.status}`),
      raw: json,
      httpStatus: response.status,
    };
  }
  const messageId = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id;
  return { ok: true, errorMessage: null, raw: json, metaMessageId: messageId, usedTemplate: false };
}

export type MetaTemplateBodyParam = {
  name?: string;
  text: string;
};

function buildMetaTemplateComponents(
  useNamedParams: boolean,
  headerParams: MetaTemplateBodyParam[],
  bodyParams: MetaTemplateBodyParam[],
  buttonSlots: MetaTemplateButtonSlot[],
): { type: string; sub_type?: string; index?: string; parameters: Record<string, string>[] }[] {
  const components: { type: string; sub_type?: string; index?: string; parameters: Record<string, string>[] }[] = [];

  const mapParams = (params: MetaTemplateBodyParam[]) =>
    params.map((param) => {
      const item: Record<string, string> = {
        type: "text",
        text: (param.text ?? "").trim() || "-",
      };
      if (useNamedParams && param.name?.trim() && !/^\d+$/.test(param.name.trim())) {
        item.parameter_name = param.name.trim();
      }
      return item;
    });

  if (headerParams.length > 0) {
    components.push({ type: "header", parameters: mapParams(headerParams) });
  }
  if (bodyParams.length > 0) {
    components.push({ type: "body", parameters: mapParams(bodyParams) });
  }
  for (const slot of buttonSlots) {
    if (!slot.params.length) continue;
    components.push({
      type: "button",
      sub_type: slot.subType === "url" ? "url" : slot.subType,
      index: String(slot.index),
      parameters: mapParams(slot.params),
    });
  }
  return components;
}

async function sendMetaTemplate(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: MetaTemplateBodyParam[],
  headerParams: MetaTemplateBodyParam[] = [],
  buttonSlots: MetaTemplateButtonSlot[] = [],
): Promise<SendResult> {
  const postTemplate = async (
    useNamedParams: boolean,
    opts?: { header?: MetaTemplateBodyParam[]; body?: MetaTemplateBodyParam[]; buttons?: MetaTemplateButtonSlot[] },
  ): Promise<SendResult> => {
    const h = opts?.header ?? headerParams;
    const b = opts?.body ?? bodyParams;
    const btns = opts?.buttons ?? buttonSlots;
    const components = buildMetaTemplateComponents(useNamedParams, h, b, btns);
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components.length > 0 ? { components } : {}),
        },
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (json as { error?: { message?: string } })?.error;
      return {
        ok: false,
        errorMessage: translateWhatsAppError(err?.message || `Meta template HTTP ${response.status}`),
        raw: json,
        httpStatus: response.status,
      };
    }
    const messageId = (json as { messages?: { id?: string }[] })?.messages?.[0]?.id;
    return { ok: true, errorMessage: null, raw: json, metaMessageId: messageId, usedTemplate: true };
  };

  const allParams = [
    ...headerParams,
    ...bodyParams,
    ...buttonSlots.flatMap((s) => s.params),
  ];
  const preferPositional = allParams.length > 0 && allParams.every((p) => /^\d+$/.test(String(p.name || "")));

  let result = await postTemplate(preferPositional ? false : true);
  if (!result.ok && isMetaTemplateParamError(result.errorMessage || "")) {
    if (allParams.length > 0) {
      const positionalRetry = await postTemplate(false);
      if (positionalRetry.ok) return positionalRetry;
      const namedRetry = await postTemplate(true);
      if (namedRetry.ok) return namedRetry;
      // Header/botão dinâmico ausente costuma causar #132018 — tenta só o corpo.
      if (headerParams.length > 0 || buttonSlots.length > 0) {
        const bodyOnly = await postTemplate(false, { header: [], body: bodyParams, buttons: [] });
        if (bodyOnly.ok) return bodyOnly;
        const bodyOnlyNamed = await postTemplate(true, { header: [], body: bodyParams, buttons: [] });
        if (bodyOnlyNamed.ok) return bodyOnlyNamed;
      }
    }
    // Template estático (sem variáveis) — envia só nome + idioma.
    const staticRetry = await postTemplate(false, { header: [], body: [], buttons: [] });
    if (staticRetry.ok) return staticRetry;
  }
  return result;
}

export type SendWhatsAppParams = {
  target: SendTarget;
  phone: string;
  text: string;
  imageUrl?: string | null;
  apiFullKey?: string;
  metaAccessToken?: string;
  metaTemplateName?: string | null;
  metaTemplateLanguage?: string | null;
  /** Parâmetros nomeados do corpo do template Meta. Se vazio, envia só o nome do template. */
  metaTemplateBodyParams?: MetaTemplateBodyParam[];
  /** Texto do gatilho/campanha no CRM — usado para alinhar params com o template Meta. */
  metaTemplateMessageSource?: string | null;
  /** Variáveis resolvidas ({nome}, {valor_vencido}, etc.). */
  metaTemplateVars?: Record<string, string>;
  supabase?: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;
  skipWindowCheck?: boolean;
  conversationId?: string | null;
};

export async function sendWhatsAppMessage(params: SendWhatsAppParams): Promise<SendResult> {
  const {
    target,
    phone,
    text,
    imageUrl,
    apiFullKey,
    metaAccessToken,
    metaTemplateName,
    metaTemplateLanguage,
    metaTemplateBodyParams = [],
    metaTemplateMessageSource = null,
    metaTemplateVars = {},
    supabase,
    skipWindowCheck = false,
    conversationId = null,
  } = params;

  const cp = cleanPhone(phone);
  if (!cp) return { ok: false, errorMessage: "Telefone inválido" };

  if (target.provider === "apifull") {
    if (!apiFullKey || !target.session) {
      return { ok: false, errorMessage: "API Full não configurada ou sessão ausente" };
    }
    return sendApifull(apiFullKey, target.session, cp, text, imageUrl);
  }

  if (!metaAccessToken || !target.phoneNumberId) {
    return { ok: false, errorMessage: "WhatsApp Cloud API (Meta) não configurado" };
  }

  const templateName =
    metaTemplateName || target.metaDefaultTemplate || null;
  let lang = normalizeMetaLanguage(metaTemplateLanguage || target.metaTemplateLanguage || "pt_BR");

  let windowOpen = skipWindowCheck;
  if (!windowOpen && supabase && target.instanceId) {
    windowOpen = await isMetaWindowOpen(supabase, target.instanceId, cp, conversationId);
  }

  if (windowOpen) {
    if (imageUrl) {
      return sendMetaImage(metaAccessToken, target.phoneNumberId, cp, imageUrl, text);
    }
    return sendMetaText(metaAccessToken, target.phoneNumberId, cp, text);
  }

  if (!templateName) {
    return {
      ok: false,
      errorMessage: translateWhatsAppError(
        "Fora da janela de 24h: configure meta_template_name na campanha ou aguarde resposta do cliente.",
      ),
    };
  }

  let bodyParams = metaTemplateBodyParams.length > 0 ? metaTemplateBodyParams : [];
  let headerParams: MetaTemplateBodyParam[] = [];
  let buttonSlots: MetaTemplateButtonSlot[] = [];
  let templateDebug: SendResult["templateDebug"];

  if (metaTemplateMessageSource || Object.keys(metaTemplateVars).length > 0) {
    const resolved = await resolveMetaTemplateParams(metaAccessToken, {
      wabaId: target.wabaId,
      phoneNumberId: target.phoneNumberId,
      templateName,
      languageCode: lang,
      messageTemplate: metaTemplateMessageSource || "",
      vars: metaTemplateVars,
    });
    bodyParams = resolved.bodyParams;
    headerParams = resolved.headerParams;
    buttonSlots = resolved.buttonSlots;
    lang = resolved.language || lang;
    templateDebug = {
      source: resolved.source,
      wabaId: resolved.wabaId,
      language: lang,
      bodyCount: bodyParams.length,
      headerCount: headerParams.length,
      buttonCount: buttonSlots.reduce((n, s) => n + s.params.length, 0),
      bodyParams: bodyParams.map((p) => ({ name: p.name, text: (p.text ?? "").slice(0, 80) })),
    };
    if (resolved.source === "message") {
      console.warn(
        `[whatsapp] template params from CRM message (schema miss) template=${templateName} waba=${resolved.wabaId || "?"}`,
      );
    }
  }

  const tplResult = await sendMetaTemplate(
    metaAccessToken,
    target.phoneNumberId,
    cp,
    templateName,
    lang,
    bodyParams,
    headerParams,
    buttonSlots,
  );
  tplResult.templateDebug = templateDebug;

  if (!tplResult.ok && imageUrl) {
    return {
      ok: false,
      errorMessage: translateWhatsAppError(
        `${tplResult.errorMessage || "Falha no template"}. Imagens em campanha exigem template com mídia aprovado na Meta.`,
      ),
      raw: tplResult.raw,
    };
  }

  return tplResult;
}

export async function loadGlobalProvider(supabase: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { setting_value?: string } | null }>;
      };
    };
  };
}): Promise<WhatsAppProvider> {
  const { data } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "whatsapp_provider")
    .maybeSingle();
  return data?.setting_value === "meta" ? "meta" : "apifull";
}

export async function resolveSendTargetBySession(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: InstanceRow | null }>;
        };
      };
    };
  },
  session: string,
): Promise<SendTarget | null> {
  if (!session?.trim()) return null;
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("id, provider, session, phone_number_id, waba_id, meta_default_template, meta_template_language, is_active")
    .eq("session", session)
    .maybeSingle();
  if (!error && data) return instanceRowToTarget(data);
  // Legado: sessão só em system_settings (apifull_session) sem linha em whatsapp_instances
  return {
    provider: "apifull",
    session: session.trim(),
    phoneNumberId: null,
    instanceId: null,
    wabaId: null,
    metaDefaultTemplate: null,
    metaTemplateLanguage: "pt_BR",
  };
}

export async function resolveSendTargetByInstanceId(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: InstanceRow | null }>;
        };
      };
    };
  },
  instanceId: string | null,
): Promise<SendTarget | null> {
  if (!instanceId) return null;
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("id, provider, session, phone_number_id, waba_id, meta_default_template, meta_template_language, is_active")
    .eq("id", instanceId)
    .maybeSingle();
  return instanceRowToTarget(data);
}
