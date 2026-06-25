// Edge Function: consulta-cpf
// Integração real com a Serasa Experian — Relatório Básico PF.
// Doc: https://developer.serasaexperian.com.br/api/relatorio-basico-pf
//
// Fluxo:
//   1. POST /security/iam/v1/client-identities/login com Basic Auth (client_id:client_secret)
//      → access_token (cache em memória)
//   2. GET  /credit-services/person-information-report/v1/creditreport
//        ?reportName=PERFIL_DE_CREDITO_BASICO_PF
//      Em UAT, também envia optionalFeatures=SCORE_POSITIVO para homologação.
//      headers: Authorization: Bearer, X-Document-Id (CPF), X-Retailer-Document-Id (CNPJ)
//   3. Extrai nome, score e pendências, persiste e devolve
//
// Secrets necessários (Lovable Cloud):
//   - SERASA_CLIENT_ID
//   - SERASA_CLIENT_SECRET
//   - SERASA_RETAILER_CNPJ   (CNPJ da empresa consultante, somente dígitos ou formatado)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ambiente: "uat" (homologação) ou "prod" (produção). Default: uat.
const SERASA_ENV = (Deno.env.get("SERASA_ENV") ?? "uat").toLowerCase();
const SERASA_BASE = SERASA_ENV === "prod"
  ? "https://api.serasaexperian.com.br"
  : "https://uat-api.serasaexperian.com.br";
const TOKEN_URL = `${SERASA_BASE}/security/iam/v1/client-identities/login`;
const REPORT_URL = `${SERASA_BASE}/credit-services/person-information-report/v1/creditreport`;

// ===== Cache de token em memória =====
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getSerasaToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const clientId = Deno.env.get("SERASA_CLIENT_ID");
  const clientSecret = Deno.env.get("SERASA_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Credenciais Serasa não configuradas no servidor");
  }

  // Doc oficial Serasa Experian:
  // POST /security/iam/v1/client-identities/login
  // Header: Authorization: Basic base64(client_id:client_secret)
  // Header: Content-Type: application/json
  // Body: vazio
  const basic = btoa(`${clientId}:${clientSecret}`);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error("Serasa token error", {
      status: resp.status,
      env: SERASA_ENV,
      url: TOKEN_URL,
      clientIdPrefix: clientId.substring(0, 6),
      clientIdLen: clientId.length,
      body: text.substring(0, 500),
    });
    throw new Error(`Falha ao obter token Serasa [${resp.status}]: ${text}`);
  }
  let data: {
    accessToken?: string;
    access_token?: string;
    token?: string;
    expires_in?: number;
    expiresIn?: number;
    expiresInSeconds?: number;
  };
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Serasa token: resposta não-JSON", { status: resp.status, body: text.substring(0, 500) });
    throw new Error(`Resposta Serasa inválida (não-JSON): ${text.substring(0, 200)}`);
  }
  const token = data.accessToken ?? data.access_token ?? data.token;
  if (!token) {
    console.error("Serasa token: sem access_token", {
      status: resp.status,
      env: SERASA_ENV,
      keys: Object.keys(data),
      body: text.substring(0, 500),
    });
    throw new Error(`Resposta Serasa sem access_token. Body: ${text.substring(0, 200)}`);
  }

  const ttlSec = Math.min(data.expiresInSeconds ?? data.expiresIn ?? data.expires_in ?? 3300, 3300);
  const ttlMs = ttlSec * 1000;
  cachedToken = { value: token, expiresAt: now + ttlMs };
  console.log(`[Serasa] Novo token gerado. TTL=${ttlSec}s. Expira em ${new Date(cachedToken.expiresAt).toISOString()}`);
  return token;
}

// ===== Tipos de retorno =====
export interface Pendencia {
  credor: string;
  valor: number;
  data: string | null;
  tipo: string;
  contrato?: string | null;
}

interface SerasaResult {
  nome: string;
  score: number;
  pendencias: Pendencia[];
  totalPendencias: number;
  somaPendencias: number;
  raw: unknown;
  dataNascimento: string | null;
}

class SerasaBusinessError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SerasaBusinessError";
    this.code = code;
  }
}

// ===== Chamada ao Relatório Básico PF =====
async function consultarSerasa(cpf: string, federalUnit = "SP"): Promise<SerasaResult> {
  const token = await getSerasaToken();

  const retailerCnpj = onlyDigits(Deno.env.get("SERASA_RETAILER_CNPJ") ?? "");
  if (!retailerCnpj) {
    throw new Error("SERASA_RETAILER_CNPJ não configurado no servidor");
  }
  if (retailerCnpj.length !== 14) {
    throw new Error("SERASA_RETAILER_CNPJ inválido: informe o CNPJ do Distribuidor Indireto com 14 dígitos");
  }

  const url = new URL(REPORT_URL);
  url.searchParams.set("reportName", "RELATORIO_BASICO_PF_PME");
  // RELATORIO_BASICO_PF_PME não aceita SCORE_POSITIVO nem federalUnit


  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Em produção, a Serasa valida estes headers exatamente como documentados.
      "X-Document-Id": cpf,
      "X-Retailer-Document-Id": retailerCnpj,
    },
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error("Serasa report error", {
      status: resp.status,
      env: SERASA_ENV,
      url: url.toString(),
      retailerCnpjDigits: retailerCnpj.length,
      retailerCnpjSuffix: retailerCnpj.slice(-4),
      body: text.substring(0, 500),
    });
    if (resp.status === 404) throw new SerasaBusinessError("CPF não encontrado na base da Serasa", "DOCUMENT_NOT_FOUND");
    if (resp.status === 412 && /USER-NOT-AUTHORIZED|Transações negadas/i.test(text)) {
      throw new SerasaBusinessError(
        "A credencial Serasa de produção autenticou, mas não está autorizada para o relatório solicitado. Peça à Serasa a liberação das transações REHP e X2PF para este client_id/CNPJ, ou use credenciais de homologação com SERASA_ENV=uat.",
        "SERASA_USER_NOT_AUTHORIZED",
      );
    }
    throw new Error(`Serasa [${resp.status}]: ${text}`);
  }
  const json = JSON.parse(text);

  const reportRoot = getPrimaryReport(json);

  // Nome — prioriza o formato real do Relatório Básico PF e mantém fallback legado
  const nome =
    pickPath(reportRoot, ["registration", "consumerName"]) ??
    pickPath(reportRoot, ["registrationData", "name"]) ??
    pickPath(reportRoot, ["registration", "name"]) ??
    pickPath(reportRoot, ["consumer", "name"]) ??
    pickPath(reportRoot, ["consumer", "fullName"]) ??
    pickPath(reportRoot, ["personRegistrationData", "name"]) ??
    pickPath(json, ["data", "name"]) ??
    "Cliente";

  // Data de nascimento — tenta vários caminhos
  const dataNascRaw =
    pickPath(reportRoot, ["registration", "birthDate"]) ??
    pickPath(reportRoot, ["registrationData", "birthDate"]) ??
    pickPath(reportRoot, ["consumer", "birthDate"]) ??
    pickPath(reportRoot, ["personRegistrationData", "birthDate"]) ??
    pickPath(json, ["data", "birthDate"]) ??
    null;

  const scoreFeature =
    pickPath(json, ["optionalFeatures", "score"]) ??
    pickPath(reportRoot, ["optionalFeatures", "score"]);

  // Score — Básico PF normalmente devolve em scoreCH/scoreModels com modelo HLRD
  const scoreRaw =
    pickPath(scoreFeature, ["score"]) ??
    pickPath(scoreFeature, ["value"]) ??
    pickPath(scoreFeature, ["points"]) ??
    pickPath(scoreFeature, ["scoreValue"]) ??
    pickPath(reportRoot, ["scoreCH", "score"]) ??
    pickPath(reportRoot, ["scoreCH", "value"]) ??
    pickFromArrayByKey(reportRoot, ["scoreModels"], "modelCode", "HLRD", ["score"]) ??
    pickFromArrayByKey(reportRoot, ["scoreModels"], "modelCode", "HLRD", ["value"]) ??
    pickPath(reportRoot, ["score", "value"]) ??
    pickPath(reportRoot, ["score", "score"]) ??
    pickPath(reportRoot, ["positiveScore", "score"]) ??
    pickPath(reportRoot, ["positiveScore", "value"]) ??
    pickPath(reportRoot, ["serasaScore", "value"]) ??
    pickPath(json, ["data", "score"]) ??
    deepFindScore(json);

  let score = typeof scoreRaw === "number"
    ? scoreRaw
    : Number.parseInt(String(scoreRaw ?? "0"), 10);

  if (!Number.isFinite(score) || score <= 0) {
    const scoreInfo = scoreFeature && typeof scoreFeature === "object"
      ? scoreFeature as Record<string, unknown>
      : null;
    const scoreMessage = scoreInfo
      ? pickFirstString(scoreInfo, [["message"], ["description"], ["status"]])
      : null;
    const scoreCode = scoreInfo
      ? pickFirstNumber(scoreInfo, [["codeMessage"], ["code"]])
      : null;

    if (scoreMessage || scoreCode !== null) {
      console.warn("Score Serasa indisponível, usando 0 como fallback", {
        cpf,
        scoreCode,
        scoreMessage,
      });
      score = 0;
    } else {
      console.error("Score não encontrado. JSON Serasa:", JSON.stringify(json).substring(0, 2000));
      throw new Error("Resposta Serasa sem score válido (verifique os caminhos do JSON na doc do produto)");
    }
  }

  const pendencias = extrairPendencias(json);
  const somaPendencias = pendencias.reduce((acc, p) => acc + (p.valor || 0), 0);

  // Normaliza data de nascimento para formato YYYY-MM-DD
  let dataNascimento: string | null = null;
  if (dataNascRaw && typeof dataNascRaw === "string") {
    const s = dataNascRaw.trim();
    // Aceita formatos: YYYY-MM-DD, DD/MM/YYYY, ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      dataNascimento = s.substring(0, 10);
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split("/");
      dataNascimento = `${y}-${m}-${d}`;
    }
  }

  return {
    nome: String(nome),
    score,
    pendencias,
    totalPendencias: pendencias.length,
    somaPendencias,
    raw: json,
    dataNascimento,
  };
}

function extrairPendencias(json: unknown): Pendencia[] {
  const reportRoot = getPrimaryReport(json);
  const candidatos: unknown[] = [
    pickPath(reportRoot, ["negativeData", "pefin", "pefinResponse"]),
    pickPath(reportRoot, ["negativeData", "refin", "refinResponse"]),
    pickPath(reportRoot, ["negativeData", "notary", "notaryResponse"]),
    pickPath(reportRoot, ["negativeData", "check", "checkResponse"]),
    pickPath(reportRoot, ["negativeData", "collectionRecords", "collectionRecordsResponse"]),
    pickPath(json, ["pendencies"]),
    pickPath(json, ["pendingDebts"]),
    pickPath(json, ["pendingDebts", "debts"]),
    pickPath(json, ["debts"]),
    pickPath(json, ["negativeData", "pendencies"]),
    pickPath(json, ["negativeData", "debts"]),
    pickPath(json, ["pefin", "items"]),
    pickPath(json, ["refin", "items"]),
  ].filter(Array.isArray);

  const itens: Record<string, unknown>[] = [];
  for (const arr of candidatos) {
    for (const it of arr as unknown[]) {
      if (it && typeof it === "object") itens.push(it as Record<string, unknown>);
    }
  }

  return itens.map((it) => {
    const valor = pickFirstNumber(it, [
      ["value"], ["amount"], ["debtValue"], ["originalValue"], ["currentValue"],
    ]);
    const data = pickFirstString(it, [
      ["date"], ["occurrenceDate"], ["registerDate"], ["includeDate"], ["referenceDate"],
    ]);
    const credor = pickFirstString(it, [
      ["creditor"], ["creditorName"], ["companyName"], ["informant"], ["informantName"],
    ]) ?? "—";
    const tipo = pickFirstString(it, [
      ["type"], ["modality"], ["debtType"], ["nature"],
    ]) ?? "PENDÊNCIA";
    const contrato = pickFirstString(it, [
      ["contract"], ["contractNumber"], ["operationNumber"], ["reference"],
    ]);

    return { credor, valor: valor ?? 0, data, tipo: String(tipo).toUpperCase(), contrato };
  });
}

function getPrimaryReport(json: unknown): Record<string, unknown> | unknown {
  const reports = pickPath(json, ["reports"]);
  if (Array.isArray(reports)) {
    const firstReport = reports.find((item) => item && typeof item === "object");
    if (firstReport) return firstReport;
  }
  return json;
}

function pickPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else return undefined;
  }
  return cur;
}

// Busca recursiva por qualquer chave "score" / "value" plausível (0-1000)
function deepFindScore(obj: unknown, depth = 0): number | null {
  if (depth > 8 || obj == null) return null;
  if (typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if ((lk === "score" || lk === "value" || lk === "scorevalue") &&
        (typeof v === "number" || typeof v === "string")) {
      const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
      if (Number.isFinite(n) && n > 0 && n <= 1000) return n;
    }
    if (v && typeof v === "object") {
      const found = deepFindScore(v, depth + 1);
      if (found != null) return found;
    }
  }
  return null;
}

// Busca em arrays do tipo [{ modelCode: "HLRD", score: 700 }, ...]
function pickFromArrayByKey(
  obj: unknown,
  arrPath: string[],
  matchKey: string,
  matchVal: string,
  valuePath: string[],
): unknown {
  const arr = pickPath(obj, arrPath);
  if (!Array.isArray(arr)) return undefined;
  const found = arr.find(
    (it) => it && typeof it === "object" && (it as Record<string, unknown>)[matchKey] === matchVal,
  );
  if (!found) return undefined;
  return pickPath(found, valuePath);
}

function pickFirstNumber(obj: Record<string, unknown>, paths: string[][]): number | null {
  for (const p of paths) {
    const v = pickPath(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number.parseFloat(v.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickFirstString(obj: Record<string, unknown>, paths: string[][]): string | null {
  for (const p of paths) {
    const v = pickPath(obj, p);
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

// ===== Validação de CPF =====
function onlyDigits(s: string) { return (s || "").replace(/\D/g, ""); }
function isValidCPF(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResp({ error: "Não autenticado" }, 401);

    const token = authHeader.replace(/^Bearer\s+/i, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("Auth error:", userErr);
      return jsonResp({ error: "Sessão inválida" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const cpf = onlyDigits(body?.cpf ?? "");
    if (!isValidCPF(cpf)) return jsonResp({ error: "CPF inválido" }, 400);

    const simulacao = body?.simulacao === true;

    let serasa: SerasaResult;
    let fromCache = false;

    if (simulacao) {
      const nomeSim = typeof body?.nome === "string" && body.nome.trim().length > 0
        ? body.nome.trim()
        : "Cliente Simulado";
      const scoreSim = Number.isFinite(body?.score) ? Math.max(0, Math.min(1000, Number(body.score))) : 850;
      serasa = {
        nome: nomeSim,
        score: scoreSim,
        pendencias: [],
        totalPendencias: 0,
        somaPendencias: 0,
        raw: { simulacao: true, dataNascimento: body?.dataNascimento ?? null },
        dataNascimento: body?.dataNascimento ?? null,
      } as SerasaResult;

      // Salva também simulações no cache para aparecerem em "Consultas Salvas"
      const { error: cacheSimErr } = await supabase
        .from("crediario_consultas_cache")
        .upsert({
          cpf,
          nome: serasa.nome,
          data_nascimento: serasa.dataNascimento,
          score: serasa.score,
          raw: serasa.raw as never,
          pendencias: serasa.pendencias as never,
          total_pendencias: serasa.totalPendencias,
          soma_pendencias: serasa.somaPendencias,
          consultado_em: new Date().toISOString(),
          expira_em: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "cpf" });
      if (cacheSimErr) console.error("Erro ao salvar cache (simulação):", cacheSimErr);
    } else {
      // 1) Tenta buscar do cache (válido por 3 meses)
      const { data: cached } = await supabase
        .from("crediario_consultas_cache")
        .select("*")
        .eq("cpf", cpf)
        .gt("expira_em", new Date().toISOString())
        .maybeSingle();

      if (cached) {
        fromCache = true;
        // Se o cache foi salvo com nome placeholder ("Cliente") mas o raw tem o nome real,
        // re-extrai do raw para corrigir caches antigos sem precisar reconsultar a Serasa.
        let nomeFinal = cached.nome ?? "Cliente";
        if ((!nomeFinal || nomeFinal === "Cliente") && cached.raw) {
          const reportRoot = getPrimaryReport(cached.raw);
          const nomeFromRaw =
            pickPath(reportRoot, ["registration", "consumerName"]) ??
            pickPath(reportRoot, ["registrationData", "name"]) ??
            pickPath(reportRoot, ["registration", "name"]) ??
            pickPath(reportRoot, ["consumer", "name"]) ??
            pickPath(reportRoot, ["consumer", "fullName"]) ??
            pickPath(reportRoot, ["personRegistrationData", "name"]) ??
            pickPath(cached.raw, ["data", "name"]);
          if (nomeFromRaw && typeof nomeFromRaw === "string" && nomeFromRaw.trim().length > 0) {
            nomeFinal = nomeFromRaw.trim();
            // Atualiza o cache em background para próximas consultas
            await supabase
              .from("crediario_consultas_cache")
              .update({ nome: nomeFinal })
              .eq("cpf", cpf);
          }
        }
        serasa = {
          nome: nomeFinal,
          score: cached.score ?? 0,
          pendencias: (cached.pendencias as Pendencia[]) ?? [],
          totalPendencias: cached.total_pendencias ?? 0,
          somaPendencias: Number(cached.soma_pendencias ?? 0),
          raw: cached.raw,
          dataNascimento: cached.data_nascimento,
        };
      } else {
        // 2) Cache miss → consulta Serasa
        const ufReq = typeof body?.uf === "string" ? body.uf.trim().toUpperCase() : "";
        const uf = /^[A-Z]{2}$/.test(ufReq) ? ufReq : "SP";
        serasa = await consultarSerasa(cpf, uf);

        // 3) Salva/atualiza cache (upsert por CPF)
        const { error: cacheErr } = await supabase
          .from("crediario_consultas_cache")
          .upsert({
            cpf,
            nome: serasa.nome,
            data_nascimento: serasa.dataNascimento,
            score: serasa.score,
            raw: serasa.raw as never,
            pendencias: serasa.pendencias as never,
            total_pendencias: serasa.totalPendencias,
            soma_pendencias: serasa.somaPendencias,
            consultado_em: new Date().toISOString(),
            expira_em: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: "cpf" });
        if (cacheErr) console.error("Erro ao salvar cache:", cacheErr);
      }
    }

    const { error: insertErr } = await supabase.from("crediario_consultas").insert({
      user_id: userData.user.id,
      cpf,
      nome: serasa.nome,
      score: serasa.score,
      status: simulacao ? "simulacao" : (fromCache ? "cache" : "sucesso"),
      raw: serasa.raw as never,
    });
    if (insertErr) console.error("Erro ao gravar consulta:", insertErr);

    return jsonResp({
      cpf,
      nome: serasa.nome,
      score: serasa.score,
      dataNascimento: serasa.dataNascimento,
      pendencias: serasa.pendencias,
      totalPendencias: serasa.totalPendencias,
      somaPendencias: serasa.somaPendencias,
      provider: simulacao ? "simulacao" : (fromCache ? "cache" : "serasa"),
      fromCache,
      simulacao,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as Error & { code?: string })?.code;
    console.error("consulta-cpf error:", msg);
    if (code === "DOCUMENT_NOT_FOUND") {
      return jsonResp({ error: msg, notFound: true }, 200);
    }
    if (code === "SERASA_USER_NOT_AUTHORIZED") {
      return jsonResp({ error: msg, serasaUnauthorized: true }, 200);
    }
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
