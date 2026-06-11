export type MetaTemplateBodyParam = {
  /** Nome do parâmetro no template Meta (ex.: valor_a_vencer). */
  name: string;
  text: string;
};

/**
 * Nome do parâmetro na API Meta para cada chave usada no texto do CRM.
 * A Meta limita nomes de variáveis a 20 caracteres — use sempre as chaves curtas
 * (valor_total, data_boleto_ant, etc.) em templates novos.
 */
const CRM_KEY_TO_META_PARAM: Record<string, string> = {
  nome: "nome",
  valor_a_vencer: "valor_a_vencer",
  valor_vencido: "valor_vencido",
  data_a_vencer: "data_a_vencer",
  data_vencida: "data_vencida",
  cnpj_empresa: "cnpj_empresa",
  nome_empresa: "nome_empresa",
  valor_total: "valor_total",
  parcelas_vencidas: "parcelas_vencidas",
  data_boleto_ant: "data_boleto_ant",
  // Legado (>20 chars na Meta) → parâmetro curto aprovado
  valor_parcela_a_vencer: "valor_a_vencer",
  valor_parcela_vencida: "valor_vencido",
  data_parcela_a_vencer: "data_a_vencer",
  data_parcela_vencida: "data_vencida",
  valor_total_parcelas: "valor_total",
  data_boleto_mais_antigo: "data_boleto_ant",
};

/** Chaves alternativas no mapa de variáveis (CRM pode usar nome longo ou curto). */
const VAR_LOOKUP_ALIASES: Record<string, string[]> = {
  nome: ["nome"],
  valor_a_vencer: ["valor_a_vencer", "valor_parcela_a_vencer"],
  valor_parcela_a_vencer: ["valor_parcela_a_vencer", "valor_a_vencer"],
  valor_vencido: ["valor_vencido", "valor_parcela_vencida"],
  valor_parcela_vencida: ["valor_parcela_vencida", "valor_vencido"],
  data_a_vencer: ["data_a_vencer", "data_parcela_a_vencer"],
  data_parcela_a_vencer: ["data_parcela_a_vencer", "data_a_vencer"],
  data_vencida: ["data_vencida", "data_parcela_vencida"],
  data_parcela_vencida: ["data_parcela_vencida", "data_vencida"],
  cnpj_empresa: ["cnpj_empresa"],
  nome_empresa: ["nome_empresa"],
  valor_total: ["valor_total", "valor_total_parcelas"],
  valor_total_parcelas: ["valor_total_parcelas", "valor_total"],
  parcelas_vencidas: ["parcelas_vencidas"],
  data_boleto_ant: ["data_boleto_ant", "data_boleto_mais_antigo"],
  data_boleto_mais_antigo: ["data_boleto_mais_antigo", "data_boleto_ant"],
};

export function formatBRL(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateBR(s: unknown): string {
  if (!s) return "";
  const str = String(s).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return String(s);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Meta rejeita parâmetros vazios no corpo do template (erro #100). */
export function sanitizeMetaTemplateParam(value: string): string {
  let v = String(value ?? "").trim();
  if (!v) return "-";
  v = v.replace(/\0/g, "").replace(/\t/g, " ");
  // Quebras de linha costumam causar #132018 em templates de cobrança.
  v = v.replace(/\r?\n+/g, " • ").replace(/\s+/g, " ").trim();
  if (v.length > 1024) v = `${v.slice(0, 1021)}...`;
  return v || "-";
}

export function normalizeMetaLanguage(code: string): string {
  const c = (code || "pt_BR").trim().replace(/-/g, "_");
  if (!c) return "pt_BR";
  const [lang, region] = c.split("_");
  if (region) return `${lang.toLowerCase()}_${region.toUpperCase()}`;
  return c.toLowerCase();
}

const wabaIdCache = new Map<string, { expires: number; wabaId: string | null }>();

/** WABA da instância → consulta pelo phone_number_id → WHATSAPP_WABA_ID do .env */
export async function resolveMetaWabaId(
  accessToken: string,
  phoneNumberId: string | null | undefined,
  instanceWabaId: string | null | undefined,
): Promise<string | null> {
  if (instanceWabaId?.trim()) return instanceWabaId.trim();
  const envWaba = Deno.env.get("WHATSAPP_WABA_ID")?.trim() || null;
  const pid = phoneNumberId?.trim();
  if (!accessToken || !pid) return envWaba;

  const cached = wabaIdCache.get(pid);
  if (cached && cached.expires > Date.now()) return cached.wabaId || envWaba;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${pid}?fields=whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const json = await res.json().catch(() => ({}));
    const waba = (json as { whatsapp_business_account?: { id?: string } })?.whatsapp_business_account?.id?.trim()
      || null;
    wabaIdCache.set(pid, { expires: Date.now() + 10 * 60 * 1000, wabaId: waba });
    return waba || envWaba;
  } catch {
    return envWaba;
  }
}

function resolveVarValue(key: string, varsLower: Record<string, string>): string {
  const aliases = VAR_LOOKUP_ALIASES[key] || [key];
  for (const alias of aliases) {
    const val = varsLower[alias];
    if (val != null && String(val).trim() !== "") return val;
  }
  return varsLower[key] ?? "";
}

export function buildCobrancaVars(
  card: Record<string, unknown>,
  name: string,
  companies: Map<string, { name: string; cnpj: string | null }>,
): Record<string, string> {
  const data = (card?.data && typeof card.data === "object") ? (card.data as Record<string, unknown>) : {};
  const parcelas: Record<string, unknown>[] = Array.isArray(data.parcelas_atrasadas)
    ? (data.parcelas_atrasadas as Record<string, unknown>[])
    : [];

  const vencidas = parcelas.filter((p) => Number(p?.dias_atraso) > 0);
  const aVencerFuturas = parcelas
    .filter((p) => Number(p?.dias_atraso) < 0)
    .sort((a, b) => String(a?.vencimento || "").localeCompare(String(b?.vencimento || "")));
  const aVencer = parcelas
    .filter((p) => Number(p?.dias_atraso) <= 0)
    .sort((a, b) => String(a?.vencimento || "").localeCompare(String(b?.vencimento || "")));

  const vencidasOrdenadas = vencidas.slice().sort(
    (a, b) => Number(b?.dias_atraso || 0) - Number(a?.dias_atraso || 0),
  );
  const pVencida = vencidasOrdenadas[0] || parcelas.find((p) => Number(p?.dias_atraso) > 0);
  const pAVencer =
    parcelas.find((p) => Number(p?.dias_atraso) === -1) ||
    aVencerFuturas[0] ||
    aVencer[0];

  const totalParcelas = vencidas.reduce((sum, p) => {
    const v = typeof p?.valor === "number" ? p.valor : parseFloat(String(p?.valor ?? "0").replace(",", "."));
    return sum + (isFinite(v) ? v : 0);
  }, 0);
  const totalEffective = totalParcelas > 0 ? totalParcelas : Number(data.total_atraso || 0);

  const baseListagem = vencidas.length > 0 ? vencidas : parcelas;
  const vencidasParaLista = baseListagem.slice().sort((a, b) =>
    String(a?.vencimento || "9999-12-31").localeCompare(String(b?.vencimento || "9999-12-31")),
  );
  const listaParcelasVencidas = vencidasParaLista
    .map((p) => `• Valor: ${formatBRL(p?.valor)} | Vencimento: ${formatDateBR(p?.vencimento)}`)
    .join("\n");
  const maisAntigo = vencidasParaLista[0];

  const companyId = (card?.ssotica_company_id || card?.company_id || null) as string | null;
  const company = companyId ? companies.get(companyId) : null;

  let valorParcelaAVencer = pAVencer ? formatBRL(pAVencer.valor) : "";
  let dataParcelaAVencer = pAVencer ? formatDateBR(pAVencer.vencimento) : "";
  if (!valorParcelaAVencer && card?.valor != null) valorParcelaAVencer = formatBRL(card.valor);
  if (!dataParcelaAVencer && card?.vencimento) dataParcelaAVencer = formatDateBR(card.vencimento);
  if (!valorParcelaAVencer && data?.valor != null) valorParcelaAVencer = formatBRL(data.valor);
  if (!dataParcelaAVencer && data?.vencimento) dataParcelaAVencer = formatDateBR(data.vencimento);

  let valorParcelaVencida = pVencida ? formatBRL(pVencida.valor) : "";
  let dataParcelaVencida = pVencida ? formatDateBR(pVencida.vencimento) : "";
  if (!valorParcelaVencida && card?.valor != null) valorParcelaVencida = formatBRL(card.valor);
  if (!dataParcelaVencida && card?.vencimento) dataParcelaVencida = formatDateBR(card.vencimento);
  if (!valorParcelaVencida && data?.valor != null) valorParcelaVencida = formatBRL(data.valor);
  if (!dataParcelaVencida && data?.vencimento) dataParcelaVencida = formatDateBR(data.vencimento);

  const valorTotalFmt = formatBRL(totalEffective);
  const dataBoletoAnt = maisAntigo ? formatDateBR(maisAntigo.vencimento) : "";

  return {
    nome: name || "Cliente",
    valor_vencido: valorParcelaVencida,
    valor_a_vencer: valorParcelaAVencer,
    data_vencida: dataParcelaVencida,
    data_a_vencer: dataParcelaAVencer,
    cnpj_empresa: company?.cnpj?.replace(/\D/g, "") || "-",
    nome_empresa: company?.name || "-",
    valor_total: valorTotalFmt,
    parcelas_vencidas: listaParcelasVencidas,
    data_boleto_ant: dataBoletoAnt,
    // Aliases legados (gatilhos antigos no CRM)
    valor_parcela_vencida: valorParcelaVencida,
    valor_parcela_a_vencer: valorParcelaAVencer,
    data_parcela_vencida: dataParcelaVencida,
    data_parcela_a_vencer: dataParcelaAVencer,
    valor_total_parcelas: valorTotalFmt,
    data_boleto_mais_antigo: dataBoletoAnt,
  };
}

export function applyTemplateVars(template: string, vars: Record<string, string>): string {
  if (!template) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\s*${k}\\s*\\}`, "gi");
    out = out.replace(re, v ?? "");
  }
  return out;
}

/** Nomes Meta → chaves CRM (para montar params a partir do schema da Meta). */
const META_PARAM_TO_CRM_KEYS: Record<string, string[]> = {
  nome: ["nome"],
  valor_a_vencer: ["valor_a_vencer", "valor_parcela_a_vencer"],
  valor_vencido: ["valor_vencido", "valor_parcela_vencida"],
  data_a_vencer: ["data_a_vencer", "data_parcela_a_vencer"],
  data_vencida: ["data_vencida", "data_parcela_vencida"],
  cnpj_empresa: ["cnpj_empresa"],
  nome_empresa: ["nome_empresa"],
  valor_total: ["valor_total", "valor_total_parcelas"],
  parcelas_vencidas: ["parcelas_vencidas"],
  data_boleto_ant: ["data_boleto_ant", "data_boleto_mais_antigo"],
};

function resolveVarForMetaParam(metaName: string, varsLower: Record<string, string>): string {
  const metaLower = metaName.toLowerCase();
  const crmKeys = META_PARAM_TO_CRM_KEYS[metaLower] || [metaLower];
  for (const key of crmKeys) {
    const val = varsLower[key];
    if (val != null && String(val).trim() !== "") return val;
  }
  return varsLower[metaLower] ?? "";
}

/** Extrai variáveis {{x}} do texto do template Meta (ordem de 1ª aparição). */
export function parseMetaTemplateVariableNames(text: string): string[] {
  if (!text?.trim()) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{([^}#][^}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type MetaTemplateButtonSlot = {
  index: number;
  subType: "url" | "quick_reply" | "phone_number";
  varNames: string[];
};

export type MetaTemplateSchema = {
  bodyVarNames: string[];
  headerVarNames: string[];
  buttonSlots: MetaTemplateButtonSlot[];
  language: string;
};

export type ResolvedMetaTemplateParams = {
  bodyParams: MetaTemplateBodyParam[];
  headerParams: MetaTemplateBodyParam[];
  buttonSlots: Array<{ index: number; subType: string; params: MetaTemplateBodyParam[] }>;
  source: "meta" | "message";
  wabaId: string | null;
  language: string;
};

const templateSchemaCache = new Map<string, { expires: number; schema: MetaTemplateSchema | null }>();
const TEMPLATE_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchMetaTemplateSchema(
  accessToken: string,
  wabaId: string,
  templateName: string,
  languageCode: string,
): Promise<MetaTemplateSchema | null> {
  const cacheKey = `${wabaId}::${templateName}::${languageCode}`;
  const cached = templateSchemaCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.schema;

  const url = new URL(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`);
  url.searchParams.set("name", templateName);
  url.searchParams.set("fields", "name,language,components");
  url.searchParams.set("limit", "20");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[metaTemplate] fetch schema failed:", (json as { error?: { message?: string } })?.error?.message);
    templateSchemaCache.set(cacheKey, { expires: Date.now() + 60_000, schema: null });
    return null;
  }

  const templates = ((json as { data?: unknown[] }).data || []) as Array<{
    name?: string;
    language?: string;
    components?: Array<{
      type?: string;
      format?: string;
      text?: string;
      buttons?: Array<{ type?: string; url?: string; text?: string }>;
    }>;
  }>;
  const lang = normalizeMetaLanguage(languageCode);
  const sameName = templates.filter((t) => t.name === templateName);
  const tpl = sameName.find((t) => normalizeMetaLanguage(t.language || "") === lang)
    || sameName[0]
    || null;
  if (!tpl) {
    templateSchemaCache.set(cacheKey, { expires: Date.now() + 60_000, schema: null });
    return null;
  }

  let headerVarNames: string[] = [];
  let bodyVarNames: string[] = [];
  const buttonSlots: MetaTemplateButtonSlot[] = [];
  for (const comp of tpl.components || []) {
    const type = String(comp.type || "").toUpperCase();
    if (type === "HEADER" && String(comp.format || "TEXT").toUpperCase() === "TEXT" && comp.text) {
      headerVarNames = parseMetaTemplateVariableNames(comp.text);
    }
    if (type === "BODY" && comp.text) {
      bodyVarNames = parseMetaTemplateVariableNames(comp.text);
    }
    if (type === "BUTTONS" && Array.isArray(comp.buttons)) {
      comp.buttons.forEach((btn, index) => {
        const btnType = String(btn.type || "").toUpperCase();
        if (btnType === "URL" && btn.url) {
          const vars = parseMetaTemplateVariableNames(btn.url);
          if (vars.length > 0) {
            buttonSlots.push({ index, subType: "url", varNames: vars });
          }
        }
      });
    }
  }

  const schema: MetaTemplateSchema = {
    bodyVarNames,
    headerVarNames,
    buttonSlots,
    language: normalizeMetaLanguage(tpl.language || lang),
  };
  templateSchemaCache.set(cacheKey, { expires: Date.now() + TEMPLATE_SCHEMA_CACHE_TTL_MS, schema });
  return schema;
}

export function buildMetaTemplateBodyParamsFromSchema(
  metaVarNames: string[],
  vars: Record<string, string>,
  messageTemplate = "",
): MetaTemplateBodyParam[] {
  if (!metaVarNames.length) return [];
  const fromMessage = messageTemplate.trim()
    ? buildMetaTemplateBodyParams(messageTemplate, vars)
    : [];
  const allPositional = metaVarNames.every((n) => /^\d+$/.test(String(n)));

  // Template Meta posicional ({{1}}, {{2}}): valores vêm da ordem das chaves no texto do CRM.
  if (allPositional) {
    return metaVarNames.map((name, index) => ({
      name,
      text: fromMessage[index]?.text ?? "-",
    }));
  }

  const varsLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    varsLower[k.toLowerCase()] = v ?? "";
  }
  return metaVarNames.map((name) => ({
    name,
    text: sanitizeMetaTemplateParam(resolveVarForMetaParam(name, varsLower)),
  }));
}

/**
 * Alinha parâmetros com o template aprovado na Meta (por WABA).
 * Se a consulta falhar, usa a mensagem do CRM como fallback.
 */
export async function resolveMetaTemplateParams(
  accessToken: string,
  opts: {
    wabaId?: string | null;
    phoneNumberId?: string | null;
    templateName: string;
    languageCode: string;
    messageTemplate: string;
    vars: Record<string, string>;
  },
): Promise<ResolvedMetaTemplateParams> {
  const {
    templateName,
    messageTemplate,
    vars,
    phoneNumberId,
  } = opts;
  const lang = normalizeMetaLanguage(opts.languageCode);
  const fallback = buildMetaTemplateBodyParams(messageTemplate, vars);
  const empty: ResolvedMetaTemplateParams = {
    bodyParams: fallback,
    headerParams: [],
    buttonSlots: [],
    source: "message",
    wabaId: null,
    language: lang,
  };

  if (!accessToken || !templateName?.trim()) return empty;

  const wabaId = await resolveMetaWabaId(accessToken, phoneNumberId, opts.wabaId);
  if (!wabaId) return empty;

  const schema = await fetchMetaTemplateSchema(accessToken, wabaId, templateName.trim(), lang);
  if (!schema) {
    return { ...empty, wabaId };
  }

  const buttonSlots = schema.buttonSlots.map((slot) => ({
    index: slot.index,
    subType: slot.subType,
    params: buildMetaTemplateBodyParamsFromSchema(slot.varNames, vars, messageTemplate),
  }));

  return {
    bodyParams: buildMetaTemplateBodyParamsFromSchema(schema.bodyVarNames, vars, messageTemplate),
    headerParams: buildMetaTemplateBodyParamsFromSchema(schema.headerVarNames, vars, messageTemplate),
    buttonSlots,
    source: "meta",
    wabaId,
    language: schema.language || lang,
  };
}

/**
 * Parâmetros nomeados do corpo do template Meta, na ordem em que as variáveis
 * aparecem na mensagem do CRM ({nome}, {valor_a_vencer}, etc.).
 */
export function buildMetaTemplateBodyParams(
  messageTemplate: string,
  vars: Record<string, string>,
): MetaTemplateBodyParam[] {
  if (!messageTemplate?.trim()) return [];
  const varsLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    varsLower[k.toLowerCase()] = v ?? "";
  }
  const seenKeys = new Set<string>();
  const seenMetaNames = new Set<string>();
  const params: MetaTemplateBodyParam[] = [];
  const re = /\{\s*([a-z0-9_]+)\s*\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(messageTemplate)) !== null) {
    const key = m[1].toLowerCase();
    if (seenKeys.has(key)) continue;
    const metaName = CRM_KEY_TO_META_PARAM[key] || key;
    // Aliases ({valor_parcela_vencida} + {valor_vencido}) viram o mesmo param na Meta — duplicar causa #132018.
    if (seenMetaNames.has(metaName)) {
      seenKeys.add(key);
      continue;
    }
    seenKeys.add(key);
    seenMetaNames.add(metaName);
    params.push({
      name: metaName,
      text: sanitizeMetaTemplateParam(resolveVarValue(key, varsLower)),
    });
  }
  return params;
}
