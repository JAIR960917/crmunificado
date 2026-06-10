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
  const v = (value ?? "").trim();
  return v || "-";
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

  const companyId = (card?.company_id || card?.ssotica_company_id || null) as string | null;
  const company = companyId ? companies.get(companyId) : null;

  let valorParcelaAVencer = pAVencer ? formatBRL(pAVencer.valor) : "";
  let dataParcelaAVencer = pAVencer ? formatDateBR(pAVencer.vencimento) : "";
  if (!valorParcelaAVencer && card?.valor != null) valorParcelaAVencer = formatBRL(card.valor);
  if (!dataParcelaAVencer && card?.vencimento) dataParcelaAVencer = formatDateBR(card.vencimento);
  if (!valorParcelaAVencer && data?.valor != null) valorParcelaAVencer = formatBRL(data.valor);
  if (!dataParcelaAVencer && data?.vencimento) dataParcelaAVencer = formatDateBR(data.vencimento);

  const valorParcelaVencida = pVencida ? formatBRL(pVencida.valor) : "";
  const dataParcelaVencida = pVencida ? formatDateBR(pVencida.vencimento) : "";

  const valorTotalFmt = formatBRL(totalEffective);
  const dataBoletoAnt = maisAntigo ? formatDateBR(maisAntigo.vencimento) : "";

  return {
    nome: name || "Cliente",
    valor_vencido: valorParcelaVencida,
    valor_a_vencer: valorParcelaAVencer,
    data_vencida: dataParcelaVencida,
    data_a_vencer: dataParcelaAVencer,
    cnpj_empresa: company?.cnpj || "",
    nome_empresa: company?.name || "",
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
  const seen = new Set<string>();
  const params: MetaTemplateBodyParam[] = [];
  const re = /\{\s*([a-z0-9_]+)\s*\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(messageTemplate)) !== null) {
    const key = m[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    params.push({
      name: CRM_KEY_TO_META_PARAM[key] || key,
      text: sanitizeMetaTemplateParam(resolveVarValue(key, varsLower)),
    });
  }
  return params;
}
