/**
 * Envio WhatsApp unificado: API Full (legado) ou Cloud API (Meta).
 */
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

export function cleanPhone(phone: string): string {
  let clean = (phone || "").replace(/\D/g, "");
  if (!clean) return "";
  if (clean.startsWith("0")) clean = clean.substring(1);
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
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
  return raw;
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
): Promise<boolean> {
  if (!instanceId || !waId) return false;
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("window_expires_at")
    .eq("instance_id", instanceId)
    .eq("wa_id", cleanPhone(waId))
    .maybeSingle();
  if (!data?.window_expires_at) return false;
  return new Date(data.window_expires_at).getTime() > Date.now();
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

async function sendMetaTemplate(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
): Promise<SendResult> {
  const components: { type: string; parameters: { type: string; text: string }[] }[] = [];
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }
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
  /** Parâmetros do corpo do template ({{1}}, {{2}}…). Se vazio, envia só o nome do template. */
  metaTemplateBodyParams?: string[];
  supabase?: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;
  skipWindowCheck?: boolean;
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
    supabase,
    skipWindowCheck = false,
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
  const lang = metaTemplateLanguage || target.metaTemplateLanguage || "pt_BR";

  let windowOpen = skipWindowCheck;
  if (!windowOpen && supabase && target.instanceId) {
    windowOpen = await isMetaWindowOpen(supabase, target.instanceId, cp);
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

  const bodyParams =
    metaTemplateBodyParams.length > 0
      ? metaTemplateBodyParams
      : text ? [text.slice(0, 1024)] : [];

  const tplResult = await sendMetaTemplate(
    metaAccessToken,
    target.phoneNumberId,
    cp,
    templateName,
    lang,
    bodyParams,
  );

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
