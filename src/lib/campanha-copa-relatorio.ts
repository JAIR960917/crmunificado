import { supabase } from "@/integrations/supabase/client";
import {
  resolveCompanyForCity,
  type CidadeLojaRoute,
} from "@/lib/campanha-copa-cidade";

export const EXAME_VISTA_OPTIONS = [
  "Menos de 6 meses",
  "6 meses a 1 ano",
  "1 a 2 anos",
  "Mais de 2 anos",
  "Nunca fiz",
] as const;

export type RenovacaoMatch = "sim" | "nao" | "outra_loja";

export type CampanhaCopaRelatorioFilters = {
  ultimo_exame?: string | null;
  cidade?: string | null;
  jogo?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  renovacao_filtro?: RenovacaoMatch | null;
  assigned_to?: string | null;
};

export type CampanhaCopaRelatorioMetrics = {
  total: number;
  em_renovacao: number;
  prospect: number;
  outra_loja: number;
  pct_renovacao: number;
  pct_prospect: number;
  pct_outra_loja: number;
  consentimento_marketing: number;
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
  consentimento_marketing: boolean;
  assigned_to: string | null;
  created_at: string;
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
  consentimento_marketing: boolean;
  assigned_to: string | null;
  created_at: string;
};

type RenovacaoRaw = {
  id: string;
  status: string;
  data_ultima_compra: string | null;
  ssotica_company_id: string | null;
  data: Record<string, unknown> | null;
  updated_at: string;
};

type RenovacaoLite = {
  id: string;
  status: string;
  data_ultima_compra: string | null;
  ssotica_company_id: string;
  cpf_digits: string;
  phone_digits: string;
  updated_at: string;
};

const MAX_SUBMISSIONS = 5000;
const RENOVACAO_PAGE = 1000;

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

/** Espelha normalize_br_mobile_digits do Postgres (match exato com Renovação). */
function normalizePhoneDigits(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 && d[2] !== "9") d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d;
}

function renovacaoCpfFromData(data: Record<string, unknown> | null): string {
  if (!data) return "";
  return cpfDigits(String(data.documento ?? data.cpf ?? ""));
}

function renovacaoPhoneFromData(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const tel = String(
    data.telefone ?? data.celular ?? data.whatsapp ?? data.telefone_principal ?? "",
  );
  return normalizePhoneDigits(tel);
}

function toRenovacaoLite(row: RenovacaoRaw): RenovacaoLite | null {
  const companyId = row.ssotica_company_id;
  if (!companyId) return null;
  return {
    id: row.id,
    status: row.status,
    data_ultima_compra: row.data_ultima_compra,
    ssotica_company_id: companyId,
    cpf_digits: renovacaoCpfFromData(row.data),
    phone_digits: renovacaoPhoneFromData(row.data),
    updated_at: row.updated_at,
  };
}

function isBetterRenovacao(a: RenovacaoLite, b: RenovacaoLite, preferCpf: boolean): boolean {
  const aCpf = preferCpf && a.cpf_digits.length >= 11;
  const bCpf = preferCpf && b.cpf_digits.length >= 11;
  if (aCpf !== bCpf) return bCpf;
  return b.updated_at > a.updated_at;
}

function findSameStoreRenovacao(
  companyId: string,
  cpf: string,
  phone: string,
  byCompanyCpf: Map<string, RenovacaoLite>,
  byCompanyPhone: Map<string, RenovacaoLite>,
): { ren: RenovacaoLite | null; matchType: string | null } {
  if (cpf.length >= 11) {
    const hit = byCompanyCpf.get(`${companyId}|${cpf}`);
    if (hit) return { ren: hit, matchType: "cpf" };
  }
  if (phone.length >= 10) {
    const hit = byCompanyPhone.get(`${companyId}|${phone}`);
    if (hit) return { ren: hit, matchType: "telefone" };
  }
  return { ren: null, matchType: null };
}

function findOtherStoreRenovacao(
  companyId: string | null,
  cpf: string,
  phone: string,
  all: RenovacaoLite[],
): { ren: RenovacaoLite | null; matchType: string | null } {
  let best: RenovacaoLite | null = null;
  let matchType: string | null = null;

  for (const ren of all) {
    if (companyId && ren.ssotica_company_id === companyId) continue;

    const cpfHit = cpf.length >= 11 && ren.cpf_digits === cpf;
    const phoneHit = phone.length >= 10 && ren.phone_digits === phone && ren.phone_digits.length >= 10;
    if (!cpfHit && !phoneHit) continue;

    const type = cpfHit ? "cpf" : "telefone";
    if (!best) {
      best = ren;
      matchType = type;
      continue;
    }
    const preferCpf = type === "cpf";
    if (isBetterRenovacao(best, ren, preferCpf) || (type === "cpf" && matchType !== "cpf")) {
      best = ren;
      matchType = type;
    }
  }

  return { ren: best, matchType };
}

function buildMetrics(rows: CampanhaCopaRelatorioRow[]): CampanhaCopaRelatorioMetrics {
  const total = rows.length;
  const em_renovacao = rows.filter((r) => r.renovacao_match === "sim").length;
  const prospect = rows.filter((r) => r.renovacao_match === "nao").length;
  const outra_loja = rows.filter((r) => r.renovacao_match === "outra_loja").length;
  const consentimento_marketing = rows.filter((r) => r.consentimento_marketing).length;

  const empresaMap = new Map<string, number>();
  const exameMap = new Map<string, number>();
  for (const row of rows) {
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
    prospect,
    outra_loja,
    pct_renovacao: total > 0 ? Math.round((em_renovacao / total) * 1000) / 10 : 0,
    pct_prospect: total > 0 ? Math.round((prospect / total) * 1000) / 10 : 0,
    pct_outra_loja: total > 0 ? Math.round((outra_loja / total) * 1000) / 10 : 0,
    consentimento_marketing,
    por_empresa,
    por_exame,
  };
}

async function fetchSubmissions(filters: CampanhaCopaRelatorioFilters): Promise<SubmissionRaw[]> {
  let query = supabase
    .from("campanha_copa_submissions")
    .select(
      "id, lead_id, nome, cpf, idade, cidade, telefone, usa_oculos, ultimo_exame_vista, jogo, jogo_label, consentimento_marketing, assigned_to, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_SUBMISSIONS);

  if (filters.ultimo_exame) query = query.eq("ultimo_exame_vista", filters.ultimo_exame);
  if (filters.cidade?.trim()) query = query.ilike("cidade", `%${filters.cidade.trim()}%`);
  if (filters.jogo) query = query.eq("jogo", filters.jogo);
  if (filters.data_inicio) query = query.gte("created_at", toIsoStart(filters.data_inicio)!);
  if (filters.data_fim) query = query.lte("created_at", toIsoEnd(filters.data_fim)!);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as SubmissionRaw[];
}

async function fetchRenovacoesForCompanies(companyIds: string[]): Promise<RenovacaoLite[]> {
  if (companyIds.length === 0) return [];

  const all: RenovacaoLite[] = [];
  for (let offset = 0; ; offset += RENOVACAO_PAGE) {
    const { data, error } = await supabase
      .from("crm_renovacoes")
      .select("id, status, data_ultima_compra, ssotica_company_id, data, updated_at")
      .in("ssotica_company_id", companyIds)
      .neq("status", "excluidos")
      .order("updated_at", { ascending: false })
      .range(offset, offset + RENOVACAO_PAGE - 1);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as RenovacaoRaw[];
    for (const row of batch) {
      const lite = toRenovacaoLite(row);
      if (lite) all.push(lite);
    }
    if (batch.length < RENOVACAO_PAGE) break;
  }
  return all;
}

function buildRenovacaoIndexes(renovacoes: RenovacaoLite[]) {
  const byCompanyCpf = new Map<string, RenovacaoLite>();
  const byCompanyPhone = new Map<string, RenovacaoLite>();

  for (const ren of renovacoes) {
    if (ren.cpf_digits.length >= 11) {
      const key = `${ren.ssotica_company_id}|${ren.cpf_digits}`;
      const cur = byCompanyCpf.get(key);
      if (!cur || ren.updated_at > cur.updated_at) byCompanyCpf.set(key, ren);
    }
    if (ren.phone_digits.length >= 10) {
      const key = `${ren.ssotica_company_id}|${ren.phone_digits}`;
      const cur = byCompanyPhone.get(key);
      if (!cur || ren.updated_at > cur.updated_at) byCompanyPhone.set(key, ren);
    }
  }

  return { byCompanyCpf, byCompanyPhone };
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

  const companyIds = [...new Set(routes.map((r) => r.company_id))];
  const renovacoes = await fetchRenovacoesForCompanies(companyIds);
  const { byCompanyCpf, byCompanyPhone } = buildRenovacaoIndexes(renovacoes);

  const { data: companiesData, error: companiesErr } = companyIds.length
    ? await supabase.from("companies").select("id, name").in("id", companyIds)
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
      const same = findSameStoreRenovacao(companyId, cpf, phone, byCompanyCpf, byCompanyPhone);
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
      consentimento_marketing: sub.consentimento_marketing,
      assigned_to: sub.assigned_to,
      created_at: sub.created_at,
      company_id: companyId,
      company_name: companyId ? companyNameById.get(companyId) ?? null : null,
      renovacao_match,
      renovacao_match_type,
      renovacao_match_id: matched?.id ?? null,
      renovacao_match_status: matched?.status ?? null,
      renovacao_status_label: matched?.status
        ? statusLabelByKey.get(matched.status) ?? matched.status
        : null,
      renovacao_match_data_compra: matched?.data_ultima_compra ?? null,
      renovacao_match_company_id: renovacaoCompanyId,
      renovacao_company_name: renovacaoCompanyId
        ? companyNameById.get(renovacaoCompanyId) ?? null
        : null,
    };
  });

  if (filters.renovacao_filtro) {
    rows = rows.filter((r) => r.renovacao_match === filters.renovacao_filtro);
  }

  return {
    metrics: buildMetrics(rows),
    rows,
  };
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
