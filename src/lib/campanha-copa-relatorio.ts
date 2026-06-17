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
  placar?: string | null;
  company_id?: string | null;
  converteu?: boolean | null;
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

function normalizePhoneDigits(raw: string | null | undefined): string {
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
    const phoneHit = phone.length >= 10 && ren.phone_digits === phone;
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

function buildMetrics(rows: CampanhaCopaRelatorioRow[]): CampanhaCopaRelatorioMetrics {
  const total = rows.length;
  const em_renovacao = rows.filter((r) => r.renovacao_match === "sim").length;
  // outra_loja é fundido no prospect — não é exibido separadamente
  const prospect = rows.filter((r) => r.renovacao_match === "nao" || r.renovacao_match === "outra_loja").length;
  const outra_loja = 0;
  const consentimento_marketing = rows.filter((r) => r.consentimento_marketing).length;
  // Comprou APÓS a data da inscrição na campanha (última compra > data do formulário)
  const convertidos = rows.filter((r) => r.converteu_apos_campanha).length;
  // "Nunca tinha comprado" que depois comprou: aproximação pelo mesmo critério,
  // pois data_ultima_compra > created_at indica que no momento da inscrição a
  // pessoa ainda não tinha compra registrada. Requer step-2 (sync SSótica) para
  // precisão total.
  const prospect_convertidos = convertidos;

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
      "id, lead_id, nome, cpf, idade, cidade, telefone, usa_oculos, ultimo_exame_vista, jogo, jogo_label, palpite_brasil, palpite_marrocos, palpite_texto, consentimento_marketing, assigned_to, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_SUBMISSIONS);

  if (filters.ultimo_exame) query = query.eq("ultimo_exame_vista", filters.ultimo_exame);
  if (filters.cidade?.trim()) query = query.ilike("cidade", `%${filters.cidade.trim()}%`);
  if (filters.jogo) query = query.eq("jogo", filters.jogo);
  if (filters.data_inicio) query = query.gte("created_at", toIsoStart(filters.data_inicio)!);
  if (filters.data_fim) query = query.lte("created_at", toIsoEnd(filters.data_fim)!);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);

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

  const renovacoes = await lookupRenovacoes([...cpfSet], [...phoneSet]);
  const { byCompanyCpf, byCompanyPhone } = buildRenovacaoIndexes(renovacoes);

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
      palpite_brasil: sub.palpite_brasil,
      palpite_marrocos: sub.palpite_marrocos,
      palpite_texto: sub.palpite_texto,
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
      converteu_apos_campanha: !!(
        matched?.data_ultima_compra &&
        matched.data_ultima_compra > sub.created_at
      ),
    };
  });

  if (filters.renovacao_filtro) {
    rows = rows.filter((r) => r.renovacao_match === filters.renovacao_filtro);
  }

  if (filters.company_id) {
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
}> {
  const [subRes, routesRes] = await Promise.all([
    supabase
      .from("campanha_copa_submissions")
      .select("cidade, jogo, jogo_label")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("campanha_copa_cidade_lojas" as never)
      .select("company_id"),
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

  return {
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b, "pt-BR")),
    jogos: Array.from(jogos.keys()).sort(),
    companies,
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
