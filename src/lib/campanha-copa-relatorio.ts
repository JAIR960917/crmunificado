import { supabase } from "@/integrations/supabase/client";
import {
  resolveCompanyForCity,
  type CidadeLojaRoute,
} from "@/lib/campanha-copa-cidade";

/** Valor sentinela para o filtro de empresa: leads sem empresa mapeada pela cidade. */
export const NO_COMPANY_FILTER = "__no_company__";

export const EXAME_VISTA_OPTIONS = [
  "Menos de 6 meses",
  "6 meses a 1 ano",
  "1 a 2 anos",
  "Mais de 2 anos",
  "Nunca fiz",
] as const;

export type RenovacaoMatch = "sim" | "nao" | "outra_loja";

export type LeadsStatusFilter = "em_renovacao" | "em_leads" | "prospect";

export type CampanhaCopaRelatorioFilters = {
  ultimo_exame?: string | null;
  cidade?: string | null;
  jogo?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  leads_status_filtro?: LeadsStatusFilter | null;
  assigned_to?: string | null;
  placar?: string | null;
  company_id?: string | null;
  converteu?: boolean | null;
  tracking_slug?: string | null;
};

export type CampanhaCopaRelatorioMetrics = {
  total: number;
  em_renovacao: number;
  em_leads_externo: number;
  em_leads_via_copa: number;
  prospect: number;
  outra_loja: number;
  pct_renovacao: number;
  pct_leads_externo: number;
  pct_leads_via_copa: number;
  pct_prospect: number;
  pct_outra_loja: number;
  consentimento_marketing: number;
  convertidos: number;
  prospect_convertidos: number;
  por_empresa: Array<{ empresa: string; total: number }>;
  por_exame: Array<{ exame: string; total: number }>;
};

export type CampanhaCopaRelatorioRow = {
  id: string;
  lead_id: string | null;
  nome: string;
  cpf: string | null;
  idade: string | null;
  cidade: string | null;
  telefone: string;
  usa_oculos: string | null;
  ultimo_exame_vista: string | null;
  jogo: string | null;
  jogo_label: string | null;
  palpite_brasil: number | null;
  palpite_marrocos: number | null;
  palpite_texto: string | null;
  consentimento_marketing: boolean;
  assigned_to: string | null;
  created_at: string;
  tracking_slug: string | null;
  company_id: string | null;
  company_name: string | null;
  renovacao_match: RenovacaoMatch;
  renovacao_match_type: string | null;
  renovacao_match_id: string | null;
  renovacao_match_status: string | null;
  renovacao_status_label: string | null;
  renovacao_match_data_compra: string | null;
  renovacao_match_company_id: string | null;
  renovacao_company_name: string | null;
  converteu_apos_campanha: boolean;
  cliente_novo_pos_campanha: boolean;
  /** Valor da última venda (crm_renovacoes.valor) — só é a venda "qualificada" quando converteu_apos_campanha é true. */
  valor_venda: number | null;
  /** Telefone já existia como card em Leads ANTES/independente da Campanha Copa. */
  em_leads_externo: boolean;
  /** Telefone está em Leads só porque a própria inscrição da Campanha Copa criou o card. */
  em_leads_via_copa: boolean;
};

export type CampanhaCopaRelatorioResult = {
  metrics: CampanhaCopaRelatorioMetrics;
  rows: CampanhaCopaRelatorioRow[];
};

type SubmissionRaw = {
  id: string;
  lead_id: string | null;
  nome: string;
  cpf: string | null;
  idade: string | null;
  cidade: string | null;
  telefone: string;
  usa_oculos: string | null;
  ultimo_exame_vista: string | null;
  jogo: string | null;
  jogo_label: string | null;
  palpite_brasil: number | null;
  palpite_marrocos: number | null;
  palpite_texto: string | null;
  consentimento_marketing: boolean;
  assigned_to: string | null;
  created_at: string;
  tracking_slug: string | null;
};

type RenovacaoLite = {
  id: string;
  status: string;
  data_ultima_compra: string | null;
  data_ultima_venda: string | null;
  valor: number | null;
  ssotica_company_id: string;
  cpf_digits: string;
  phone_digits: string;
  updated_at: string;
  created_at: string;
};

/**
 * data_ultima_compra prioriza a data da última RECEITA (exame de vista)
 * sobre a venda quando o cliente tem alguma receita no histórico (regra do
 * fluxo de Renovação). Isso esconde vendas novas sem receita associada.
 * Usamos o maior valor entre data_ultima_compra e data_ultima_venda (JSONB)
 * para saber a data real da compra mais recente.
 */
function ultimaCompraReal(ren: RenovacaoLite): string | null {
  const a = ren.data_ultima_compra;
  const b = ren.data_ultima_venda;
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Compara uma data (coluna `date`, ex.: "2026-06-17") com um timestamp
 * completo (ex.: "2026-06-17T14:23:00.000Z") por dia civil, evitando o caso
 * em que uma compra no MESMO DIA da inscrição é avaliada como anterior por
 * comparação de string pura (string mais curta é "menor").
 */
function dateOnOrAfterTimestamp(dateOnly: string, isoTimestamp: string): boolean {
  return dateOnly.slice(0, 10) >= isoTimestamp.slice(0, 10);
}

function timestampBefore(isoA: string, isoB: string): boolean {
  return isoA.slice(0, 10) < isoB.slice(0, 10);
}

const MAX_SUBMISSIONS = 50000;

function toIsoStart(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  return `${dateStr}T00:00:00.000Z`;
}

function toIsoEnd(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  return `${dateStr}T23:59:59.999Z`;
}

function cpfDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizePhoneDigits(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 && d[2] !== "9") d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}

export function normalizePlacarInput(
  home: string | number | null | undefined,
  away: string | number | null | undefined,
): string | null {
  const homeRaw = String(home ?? "").trim();
  const awayRaw = String(away ?? "").trim();
  if (homeRaw === "" || awayRaw === "") return null;
  const homeNum = Number(homeRaw);
  const awayNum = Number(awayRaw);
  if (!Number.isInteger(homeNum) || !Number.isInteger(awayNum)) return null;
  if (homeNum < 0 || homeNum > 99 || awayNum < 0 || awayNum > 99) return null;
  return `${homeNum} x ${awayNum}`;
}

export function parsePlacarText(value: string | null | undefined): string | null {
  const match = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return normalizePlacarInput(match[1], match[2]);
}

function parsePlacarScores(placar: string | null | undefined): { home: number; away: number } | null {
  const normalized = parsePlacarText(placar);
  if (!normalized) return null;
  const [home, away] = normalized.split(" x ").map(Number);
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  return { home, away };
}

/**
 * Match exige CPF E telefone batendo ao MESMO TEMPO — número de telefone é
 * frequentemente compartilhado entre pessoas da mesma casa/família no
 * Brasil, então confiar só no telefone já causou caso real de atribuir a
 * compra de uma pessoa (ex.: marido) a outra (ex.: esposa) que nunca comprou,
 * só porque usam o mesmo número. CPF isolado também não basta (CPF errado
 * digitado no formulário é possível) — exige os dois pra reduzir falsos
 * positivos nas duas direções.
 */
function findSameStoreRenovacao(
  companyId: string,
  cpf: string,
  phone: string,
  byCompanyCpf: Map<string, RenovacaoLite>,
): { ren: RenovacaoLite | null; matchType: string | null } {
  if (cpf.length < 11 || phone.length < 10) return { ren: null, matchType: null };
  const hit = byCompanyCpf.get(`${companyId}|${cpf}`);
  if (hit && hit.phone_digits === phone) return { ren: hit, matchType: "cpf e telefone" };
  return { ren: null, matchType: null };
}

function findOtherStoreRenovacao(
  companyId: string | null,
  cpf: string,
  phone: string,
  all: RenovacaoLite[],
): { ren: RenovacaoLite | null; matchType: string | null } {
  if (cpf.length < 11 || phone.length < 10) return { ren: null, matchType: null };
  let best: RenovacaoLite | null = null;

  for (const ren of all) {
    if (companyId && ren.ssotica_company_id === companyId) continue;
    if (ren.cpf_digits !== cpf || ren.phone_digits !== phone) continue;
    if (!best || ren.updated_at > best.updated_at) best = ren;
  }

  return { ren: best, matchType: best ? "cpf e telefone" : null };
}

function buildRenovacaoIndexes(renovacoes: RenovacaoLite[]) {
  const byCompanyCpf = new Map<string, RenovacaoLite>();

  for (const ren of renovacoes) {
    if (ren.cpf_digits.length >= 11) {
      const key = `${ren.ssotica_company_id}|${ren.cpf_digits}`;
      const cur = byCompanyCpf.get(key);
      if (!cur || ren.updated_at > cur.updated_at) byCompanyCpf.set(key, ren);
    }
  }

  return { byCompanyCpf };
}

/**
 * Reduz a 1 linha por CPF — quando a mesma pessoa participou de várias
 * campanhas/jogos, ela conta só uma vez. Mantém a inscrição mais RECENTE de
 * cada CPF (reflete o estado mais atual de renovação/conversão da pessoa).
 * Linhas sem CPF não são agrupadas entre si (cada uma conta como única).
 */
export function dedupeRowsByCpf(rows: CampanhaCopaRelatorioRow[]): CampanhaCopaRelatorioRow[] {
  const byCpf = new Map<string, CampanhaCopaRelatorioRow>();
  const withoutCpf: CampanhaCopaRelatorioRow[] = [];

  for (const row of rows) {
    const cpf = cpfDigits(row.cpf);
    if (cpf.length < 11) {
      withoutCpf.push(row);
      continue;
    }
    const current = byCpf.get(cpf);
    if (!current || row.created_at > current.created_at) {
      byCpf.set(cpf, row);
    }
  }

  return [...byCpf.values(), ...withoutCpf];
}

/**
 * Classifica uma inscrição em 1 dos 3 buckets MUTUAMENTE EXCLUSIVOS do
 * relatório — usado tanto pelas métricas quanto pelo filtro "Leads".
 * Prioridade:
 * 1) Em Renovação (própria loja OU outra loja) — MAS só quem JÁ estava em
 *    Renovação ANTES de participar. Quem só está em Renovação porque
 *    comprou DEPOIS de se inscrever (cliente_novo_pos_campanha &&
 *    converteu_apos_campanha) é um resultado da campanha, não alguém que
 *    "já estava" — cai no bucket de Prospect.
 * 2) Em Leads (só quem NÃO está em Renovação, senão dobraria).
 * 3) Prospect — resíduo: todo mundo que não caiu em (1) ou (2), incluindo
 *    quem converteu para Renovação ou para Leads através da própria campanha.
 */
export function classifyLeadsStatus(row: CampanhaCopaRelatorioRow): LeadsStatusFilter {
  const convertedViaCampanha = row.cliente_novo_pos_campanha && row.converteu_apos_campanha;
  const emRenovacao =
    (row.renovacao_match === "sim" || row.renovacao_match === "outra_loja") && !convertedViaCampanha;
  if (emRenovacao) return "em_renovacao";
  if (row.renovacao_match === "nao" && row.em_leads_externo) return "em_leads";
  return "prospect";
}

export function buildMetrics(rows: CampanhaCopaRelatorioRow[]): CampanhaCopaRelatorioMetrics {
  const total = rows.length;
  // Quem participou de mais de uma campanha/jogo com o mesmo CPF não pode
  // ser contado mais de uma vez nesses cards — mesma regra de "Leads
  // únicos (CPF)". Mantém a inscrição mais recente de cada pessoa.
  const uniquePeople = dedupeRowsByCpf(rows);
  // Os 3 buckets abaixo são mutuamente exclusivos e cobrem todo mundo — a
  // soma dos três sempre bate com "Leads únicos (CPF)" (ver classifyLeadsStatus).
  const em_renovacao = uniquePeople.filter((r) => classifyLeadsStatus(r) === "em_renovacao").length;
  const em_leads_externo = uniquePeople.filter((r) => classifyLeadsStatus(r) === "em_leads").length;
  const prospect = uniquePeople.length - em_renovacao - em_leads_externo;
  const em_leads_via_copa = prospect;
  const outra_loja = 0;
  const consentimento_marketing = rows.filter((r) => r.consentimento_marketing).length;
  // Comprou APÓS a data da inscrição na campanha (última compra >= data do
  // formulário), independente de já ser cliente (em renovação) ou não no
  // momento da inscrição.
  const convertidos = rows.filter((r) => r.converteu_apos_campanha).length;
  // Apenas quem NÃO tinha nenhum registro de compra antes de se inscrever
  // (o registro de renovação só passou a existir DEPOIS da inscrição) e
  // comprou após a campanha. Não usa o status atual de renovação, pois esse
  // muda para "sim" assim que a primeira compra é sincronizada — o que faria
  // o próprio prospect convertido "desaparecer" da contagem.
  const prospect_convertidos = rows.filter(
    (r) => r.cliente_novo_pos_campanha && r.converteu_apos_campanha,
  ).length;

  // Distribuição por empresa/exame e os percentuais dos buckets usam "Leads
  // únicos (CPF)" como base (100%), não o total bruto de inscrições — senão
  // quem participou de várias campanhas contava mais de uma vez na distribuição.
  const uniqueTotal = uniquePeople.length;
  const empresaMap = new Map<string, number>();
  const exameMap = new Map<string, number>();
  for (const row of uniquePeople) {
    const empresa = row.company_name?.trim() || "Sem empresa mapeada";
    const exame = row.ultimo_exame_vista?.trim() || "Não informado";
    empresaMap.set(empresa, (empresaMap.get(empresa) ?? 0) + 1);
    exameMap.set(exame, (exameMap.get(exame) ?? 0) + 1);
  }

  const por_empresa = Array.from(empresaMap.entries())
    .map(([empresa, n]) => ({ empresa, total: n }))
    .sort((a, b) => b.total - a.total || a.empresa.localeCompare(b.empresa, "pt-BR"));

  const por_exame = Array.from(exameMap.entries())
    .map(([exame, n]) => ({ exame, total: n }))
    .sort((a, b) => b.total - a.total || a.exame.localeCompare(b.exame, "pt-BR"));

  return {
    total,
    em_renovacao,
    em_leads_externo,
    em_leads_via_copa,
    prospect,
    outra_loja,
    pct_renovacao: uniqueTotal > 0 ? Math.round((em_renovacao / uniqueTotal) * 1000) / 10 : 0,
    pct_leads_externo: uniqueTotal > 0 ? Math.round((em_leads_externo / uniqueTotal) * 1000) / 10 : 0,
    pct_leads_via_copa: uniqueTotal > 0 ? Math.round((em_leads_via_copa / uniqueTotal) * 1000) / 10 : 0,
    pct_prospect: uniqueTotal > 0 ? Math.round((prospect / uniqueTotal) * 1000) / 10 : 0,
    pct_outra_loja: uniqueTotal > 0 ? Math.round((outra_loja / uniqueTotal) * 1000) / 10 : 0,
    consentimento_marketing,
    convertidos,
    prospect_convertidos,
    por_empresa,
    por_exame,
  };
}

async function fetchSubmissions(filters: CampanhaCopaRelatorioFilters): Promise<SubmissionRaw[]> {
  let query = supabase
    .from("campanha_copa_submissions")
    .select(
      "id, lead_id, nome, cpf, idade, cidade, telefone, usa_oculos, ultimo_exame_vista, jogo, jogo_label, palpite_brasil, palpite_marrocos, palpite_texto, consentimento_marketing, assigned_to, created_at, tracking_slug",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_SUBMISSIONS);

  if (filters.ultimo_exame) query = query.eq("ultimo_exame_vista", filters.ultimo_exame);
  if (filters.cidade?.trim()) query = query.ilike("cidade", `%${filters.cidade.trim()}%`);
  if (filters.jogo) query = query.eq("jogo", filters.jogo);
  if (filters.data_inicio) query = query.gte("created_at", toIsoStart(filters.data_inicio)!);
  if (filters.data_fim) query = query.lte("created_at", toIsoEnd(filters.data_fim)!);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
  if (filters.tracking_slug) query = query.eq("tracking_slug", filters.tracking_slug);

  const placarScores = parsePlacarScores(filters.placar);
  if (placarScores) {
    query = query
      .eq("palpite_brasil", placarScores.home)
      .eq("palpite_marrocos", placarScores.away);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as SubmissionRaw[];
}

async function lookupRenovacoes(cpfs: string[], phones: string[]): Promise<RenovacaoLite[]> {
  if (cpfs.length === 0 && phones.length === 0) return [];

  const { data, error } = await supabase.rpc("campanha_copa_lookup_renovacoes" as never, {
    p_cpfs: cpfs,
    p_phones: phones,
  } as never);

  if (error) throw new Error(error.message);

  return ((data ?? []) as RenovacaoLite[]).filter((r) => r.ssotica_company_id);
}

/**
 * Telefones (já normalizados) que existem como card na tela de Leads,
 * separados por origem: leadsExternos = lead que já existia independente da
 * Campanha Copa (origem_campanha != 'copa' ou nulo); leadsViaCopa = lead que
 * só existe porque a própria inscrição da Campanha Copa o criou
 * automaticamente (origem_campanha = 'copa').
 */
async function lookupLeadsPhones(
  phones: string[],
): Promise<{ leadsExternos: Set<string>; leadsViaCopa: Set<string> }> {
  if (phones.length === 0) return { leadsExternos: new Set(), leadsViaCopa: new Set() };

  const { data, error } = await supabase.rpc("campanha_copa_lookup_leads" as never, {
    p_phones: phones,
  } as never);

  if (error) throw new Error(error.message);

  const leadsExternos = new Set<string>();
  const leadsViaCopa = new Set<string>();
  for (const row of (data ?? []) as Array<{ phone_digits: string; origem_campanha: string | null }>) {
    if (row.origem_campanha === "copa") {
      leadsViaCopa.add(row.phone_digits);
    } else {
      leadsExternos.add(row.phone_digits);
    }
  }
  return { leadsExternos, leadsViaCopa };
}

export type LeadMatch = { lead_id: string; phone_digits: string; origem_campanha: string | null };

/** Leads (id, telefone normalizado, origem) que batem com uma lista de telefones. */
export async function lookupLeadsByPhones(phones: string[]): Promise<LeadMatch[]> {
  if (phones.length === 0) return [];

  const { data, error } = await supabase.rpc("campanha_copa_lookup_leads" as never, {
    p_phones: phones,
  } as never);

  if (error) throw new Error(error.message);

  return (data ?? []) as LeadMatch[];
}

export async function fetchCampanhaCopaRelatorio(
  filters: CampanhaCopaRelatorioFilters,
): Promise<CampanhaCopaRelatorioResult> {
  const [submissions, routesRes, statusesRes] = await Promise.all([
    fetchSubmissions(filters),
    supabase.from("campanha_copa_cidade_lojas" as never).select("id, cidade_label, company_id"),
    supabase.from("crm_renovacao_statuses").select("key, label"),
  ]);

  if (routesRes.error) throw new Error(routesRes.error.message);

  const routes = (routesRes.data ?? []) as CidadeLojaRoute[];
  const statusLabelByKey = new Map<string, string>(
    (statusesRes.data ?? []).map((s) => [s.key as string, s.label as string]),
  );

  const cpfSet = new Set<string>();
  const phoneSet = new Set<string>();
  for (const sub of submissions) {
    const cpf = cpfDigits(sub.cpf);
    const phone = normalizePhoneDigits(sub.telefone);
    if (cpf.length >= 11) cpfSet.add(cpf);
    if (phone.length >= 10) phoneSet.add(phone);
  }

  const [renovacoes, { leadsExternos, leadsViaCopa }] = await Promise.all([
    lookupRenovacoes([...cpfSet], [...phoneSet]),
    lookupLeadsPhones([...phoneSet]),
  ]);
  const { byCompanyCpf } = buildRenovacaoIndexes(renovacoes);

  const companyIds = new Set<string>();
  for (const route of routes) companyIds.add(route.company_id);
  for (const ren of renovacoes) companyIds.add(ren.ssotica_company_id);

  const { data: companiesData, error: companiesErr } = companyIds.size
    ? await supabase.from("companies").select("id, name").in("id", [...companyIds])
    : { data: [], error: null };
  if (companiesErr) throw new Error(companiesErr.message);

  const companyNameById = new Map<string, string>(
    (companiesData ?? []).map((c) => [c.id as string, c.name as string]),
  );

  let rows: CampanhaCopaRelatorioRow[] = submissions.map((sub) => {
    const route = resolveCompanyForCity(sub.cidade, routes);
    const companyId = route?.company_id ?? null;
    const cpf = cpfDigits(sub.cpf);
    const phone = normalizePhoneDigits(sub.telefone);

    let renovacao_match: RenovacaoMatch = "nao";
    let renovacao_match_type: string | null = null;
    let matched: RenovacaoLite | null = null;

    if (companyId) {
      const same = findSameStoreRenovacao(companyId, cpf, phone, byCompanyCpf);
      if (same.ren) {
        renovacao_match = "sim";
        renovacao_match_type = same.matchType;
        matched = same.ren;
      }
    }

    if (!matched) {
      const other = findOtherStoreRenovacao(companyId, cpf, phone, renovacoes);
      if (other.ren) {
        renovacao_match = "outra_loja";
        renovacao_match_type = other.matchType;
        matched = other.ren;
      }
    }

    const renovacaoCompanyId = matched?.ssotica_company_id ?? null;
    const converteuAposCampanha = !!(
      matched &&
      ultimaCompraReal(matched) &&
      dateOnOrAfterTimestamp(ultimaCompraReal(matched)!, sub.created_at)
    );

    return {
      id: sub.id,
      lead_id: sub.lead_id,
      nome: sub.nome,
      cpf: sub.cpf,
      idade: sub.idade,
      cidade: sub.cidade,
      telefone: sub.telefone,
      usa_oculos: sub.usa_oculos,
      ultimo_exame_vista: sub.ultimo_exame_vista,
      jogo: sub.jogo,
      jogo_label: sub.jogo_label,
      palpite_brasil: sub.palpite_brasil,
      palpite_marrocos: sub.palpite_marrocos,
      palpite_texto: sub.palpite_texto,
      consentimento_marketing: sub.consentimento_marketing,
      assigned_to: sub.assigned_to,
      created_at: sub.created_at,
      tracking_slug: sub.tracking_slug ?? null,
      company_id: companyId,
      company_name: companyId ? companyNameById.get(companyId) ?? null : null,
      renovacao_match,
      renovacao_match_type,
      renovacao_match_id: matched?.id ?? null,
      renovacao_match_status: matched?.status ?? null,
      renovacao_status_label: matched?.status
        ? statusLabelByKey.get(matched.status) ?? matched.status
        : null,
      renovacao_match_data_compra: matched ? ultimaCompraReal(matched) : null,
      renovacao_match_company_id: renovacaoCompanyId,
      renovacao_company_name: renovacaoCompanyId
        ? companyNameById.get(renovacaoCompanyId) ?? null
        : null,
      converteu_apos_campanha: converteuAposCampanha,
      // O registro de renovação só existe a partir da primeira compra conhecida.
      // Se ele foi criado no MESMO DIA ou DEPOIS da inscrição na campanha, o
      // cliente ainda não existia como comprador no momento em que participou
      // — ou seja, era um prospect que converteu. Se já existia em um dia
      // anterior à inscrição, já era cliente.
      cliente_novo_pos_campanha: !!(
        matched?.created_at && !timestampBefore(matched.created_at, sub.created_at)
      ),
      // valor é da venda mais RECENTE do cliente — só é a venda "qualificada"
      // (a que aconteceu depois da inscrição) quando converteu_apos_campanha
      // é true; senão o valor seria de uma venda antiga, sem relação com a campanha.
      valor_venda: converteuAposCampanha ? matched?.valor ?? null : null,
      em_leads_externo: phone.length >= 10 && leadsExternos.has(phone),
      em_leads_via_copa: phone.length >= 10 && leadsViaCopa.has(phone),
    };
  });

  if (filters.leads_status_filtro) {
    rows = rows.filter((r) => classifyLeadsStatus(r) === filters.leads_status_filtro);
  }

  if (filters.company_id === NO_COMPANY_FILTER) {
    rows = rows.filter((r) => !r.company_id);
  } else if (filters.company_id) {
    rows = rows.filter((r) => r.company_id === filters.company_id);
  }

  if (filters.converteu != null) {
    rows = rows.filter((r) => r.converteu_apos_campanha === filters.converteu);
  }

  return {
    metrics: buildMetrics(rows),
    rows,
  };
}

export async function fetchCampanhaCopaRelatorioMeta(): Promise<{
  cities: string[];
  jogos: string[];
  companies: Array<{ id: string; name: string }>;
  trackingLinks: Array<{ slug: string; name: string }>;
}> {
  const [subRes, routesRes, trackingRes] = await Promise.all([
    supabase
      .from("campanha_copa_submissions")
      .select("cidade, jogo, jogo_label")
      .order("created_at", { ascending: false })
      .limit(MAX_SUBMISSIONS),
    supabase
      .from("campanha_copa_cidade_lojas" as never)
      .select("company_id"),
    supabase
      .from("campanha_copa_tracking_links" as never)
      .select("slug, name")
      .order("name"),
  ]);

  if (subRes.error) throw new Error(subRes.error.message);

  const cities = new Set<string>();
  const jogos = new Map<string, string>();
  for (const row of subRes.data || []) {
    const r = row as { cidade?: string; jogo?: string; jogo_label?: string };
    if (r.cidade?.trim()) cities.add(r.cidade.trim());
    if (r.jogo) jogos.set(r.jogo, r.jogo_label || r.jogo);
  }

  const companyIds = new Set<string>(
    ((routesRes.data ?? []) as { company_id: string }[]).map((r) => r.company_id).filter(Boolean),
  );

  let companies: Array<{ id: string; name: string }> = [];
  if (companyIds.size > 0) {
    const { data: companiesData } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", [...companyIds])
      .order("name");
    companies = (companiesData ?? []) as Array<{ id: string; name: string }>;
  }

  const trackingLinks = ((trackingRes.data ?? []) as Array<{ slug: string; name: string }>);

  return {
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b, "pt-BR")),
    jogos: Array.from(jogos.keys()).sort(),
    companies,
    trackingLinks,
  };
}

const CSV_DELIMITER = ",";

function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n|\r|\n/g, " ")
    .trim();
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = sanitizeCsvCell(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** CPF/telefone como texto no Google Planilhas e Excel (evita notação científica). */
function csvTextCell(value: string | number | boolean | null | undefined): string {
  const text = sanitizeCsvCell(value);
  if (!text) return '""';
  return `"'\t${text.replace(/"/g, '""')}"`;
}

function formatCsvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sanitizeCsvFilename(part: string): string {
  return part.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "export";
}

export function exportCampanhaCopaPlacarCsv(
  rows: CampanhaCopaRelatorioRow[],
  placar: string,
  profileName: (id: string | null) => string,
) {
  const headers = [
    "Nome",
    "CPF",
    "Telefone",
    "Cidade",
    "Idade",
    "Palpite",
    "Jogo",
    "Ultimo exame",
    "Em Renovacao",
    "Loja",
    "Responsavel",
    "Data inscricao",
  ];

  const lines = [
    headers.join(CSV_DELIMITER),
    ...rows.map((row) =>
      [
        csvEscape(row.nome),
        csvTextCell(row.cpf),
        csvTextCell(row.telefone),
        csvEscape(row.cidade),
        csvEscape(row.idade),
        csvEscape(row.palpite_texto || `${row.palpite_brasil ?? "?"} x ${row.palpite_marrocos ?? "?"}`),
        csvEscape(row.jogo_label || row.jogo),
        csvEscape(row.ultimo_exame_vista),
        csvEscape(renovacaoMatchLabel(row.renovacao_match)),
        csvEscape(
          row.renovacao_match === "sim"
            ? row.company_name
            : row.renovacao_match === "outra_loja"
              ? row.renovacao_company_name
              : row.company_name,
        ),
        csvEscape(profileName(row.assigned_to)),
        csvEscape(formatCsvDate(row.created_at)),
      ].join(CSV_DELIMITER),
    ),
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\r\n") + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `campanha-copa-placar-${sanitizeCsvFilename(placar.replace(/\s+/g, "-"))}.csv`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCampanhaCopaUnmappedCsv(
  rows: CampanhaCopaRelatorioRow[],
  profileName: (id: string | null) => string,
) {
  const headers = [
    "Nome",
    "CPF",
    "Telefone",
    "Cidade",
    "Idade",
    "Ultimo exame",
    "Em Renovacao",
    "Responsavel",
    "Data inscricao",
  ];

  const lines = [
    headers.join(CSV_DELIMITER),
    ...rows.map((row) =>
      [
        csvEscape(row.nome),
        csvTextCell(row.cpf),
        csvTextCell(row.telefone),
        csvEscape(row.cidade),
        csvEscape(row.idade),
        csvEscape(row.ultimo_exame_vista),
        csvEscape(renovacaoMatchLabel(row.renovacao_match)),
        csvEscape(profileName(row.assigned_to)),
        csvEscape(formatCsvDate(row.created_at)),
      ].join(CSV_DELIMITER),
    ),
  ];

  const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `campanha-copa-sem-empresa-mapeada-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renovacaoMatchLabel(match: RenovacaoMatch): string {
  switch (match) {
    case "sim":
      return "Em Renovação";
    case "outra_loja":
      return "Outra loja";
    default:
      return "Não está em Renovação";
  }
}

// ============================================================
// Seção "Geral" — despesas/investimento da campanha e métricas
// financeiras derivadas (faturamento, CAC, CPL, ticket médio).
// ============================================================

export type CampanhaCopaDespesa = {
  id: string;
  valor: number;
  descricao: string | null;
  created_at: string;
};

export async function fetchCampanhaCopaDespesas(): Promise<CampanhaCopaDespesa[]> {
  const { data, error } = await supabase
    .from("campanha_copa_despesas" as never)
    .select("id, valor, descricao, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CampanhaCopaDespesa[];
}

export async function addCampanhaCopaDespesa(valor: number, descricao: string): Promise<void> {
  const { error } = await supabase
    .from("campanha_copa_despesas" as never)
    .insert({ valor, descricao: descricao.trim() || null } as never);
  if (error) throw new Error(error.message);
}

export async function deleteCampanhaCopaDespesa(id: string): Promise<void> {
  const { error } = await supabase.from("campanha_copa_despesas" as never).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type CampanhaCopaGeralMetrics = {
  faturamento: number;
  vendas: number;
  novosClientes: number;
  despesas: number;
  ticketMedio: number;
  cac: number;
  cplLeadsTotais: number;
  cplLeadsNovos: number;
};

/**
 * Vendas/Novos Clientes/Faturamento usam o MESMO grupo: pessoas cuja
 * PRIMEIRA compra conhecida aconteceu depois da inscrição na campanha
 * (cliente_novo_pos_campanha && converteu_apos_campanha) — quem já era
 * cliente antes e comprou de novo não entra aqui. Deduplicado por CPF
 * (mesma pessoa em mais de uma campanha conta uma vez).
 */
export function buildGeralMetrics(
  rows: CampanhaCopaRelatorioRow[],
  despesasTotal: number,
  leadsTotais: number,
  leadsNovos: number,
): CampanhaCopaGeralMetrics {
  // cliente_novo_pos_campanha/converteu_apos_campanha são relativos à
  // inscrição (comparam com a data DAQUELA submissão) — uma pessoa que se
  // inscreveu mais de uma vez pode ter isso true numa inscrição antiga e
  // false na mais recente. dedupeRowsByCpf só mantém a mais recente, então
  // filtrar DEPOIS de deduplicar podia perder uma venda real (a inscrição
  // que efetivamente qualificava ficava descartada). Por isso aqui agrupa
  // por CPF e conta a pessoa se QUALQUER inscrição dela qualificar.
  const bestPerCpf = new Map<string, CampanhaCopaRelatorioRow>();
  const withoutCpfQualifying: CampanhaCopaRelatorioRow[] = [];
  for (const row of rows) {
    if (!(row.cliente_novo_pos_campanha && row.converteu_apos_campanha)) continue;
    const cpf = cpfDigits(row.cpf);
    if (cpf.length < 11) {
      withoutCpfQualifying.push(row);
      continue;
    }
    if (!bestPerCpf.has(cpf)) bestPerCpf.set(cpf, row);
  }
  const novosClientesRows = [...bestPerCpf.values(), ...withoutCpfQualifying];
  const vendas = novosClientesRows.length;
  const faturamento = novosClientesRows.reduce((acc, r) => acc + (r.valor_venda ?? 0), 0);

  return {
    faturamento,
    vendas,
    novosClientes: vendas,
    despesas: despesasTotal,
    ticketMedio: vendas > 0 ? faturamento / vendas : 0,
    cac: vendas > 0 ? despesasTotal / vendas : 0,
    cplLeadsTotais: leadsTotais > 0 ? despesasTotal / leadsTotais : 0,
    cplLeadsNovos: leadsNovos > 0 ? despesasTotal / leadsNovos : 0,
  };
}
