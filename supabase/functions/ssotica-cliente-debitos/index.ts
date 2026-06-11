// Busca parcelas em aberto de um cliente no SSótica (consulta ao vivo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  companyAllowed,
  getAllowedCompanyIds,
  getUserFromRequest,
} from "../_shared/staffAuth.ts";
import { parseParcelaCobrancaAtiva } from "../_shared/ssoticaCobrancaParcela.ts";

const SSOTICA_BASE = "https://app.ssotica.com.br/api/v1/integracoes";
const COBRANCAS_LOOKBACK_DAYS = 730;
const COBRANCAS_FUTURE_DAYS = 60;
const MAX_WINDOW_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + n);
  return nd;
};

function buildWindows(start: Date, end: Date) {
  const windows: { start: string; end: string }[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    const wEnd = addDays(cur, MAX_WINDOW_DAYS - 1);
    const finalEnd = wEnd > end ? end : wEnd;
    windows.push({ start: ymd(cur), end: ymd(finalEnd) });
    cur = addDays(finalEnd, 1);
  }
  return windows;
}

function normalizeIdentifier(value: string): string {
  const raw = (value ?? "").trim();
  const onlyDigits = raw.replace(/\D/g, "");
  const isCnpj = !/[a-zA-Z]/.test(raw) && onlyDigits.length === 14;
  return isCnpj ? onlyDigits : raw;
}

async function fetchSSotica(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SSótica ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ssoticaClienteId, ssoticaCompanyId } = await req.json();
    if (!ssoticaClienteId || !ssoticaCompanyId) {
      return new Response(
        JSON.stringify({ error: "ssoticaClienteId e ssoticaCompanyId são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user, response: authResp } = await getUserFromRequest(req, supabaseUrl, serviceKey);
    if (authResp) return authResp;

    const allowedCompanies = await getAllowedCompanyIds(admin, user!.id);
    if (!companyAllowed(allowedCompanies, String(ssoticaCompanyId))) {
      return new Response(JSON.stringify({ error: "Sem permissão para esta empresa" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: integ, error: integErr } = await admin
      .from("ssotica_integrations")
      .select("cnpj, bearer_token, is_active")
      .eq("company_id", ssoticaCompanyId)
      .maybeSingle();

    if (integErr || !integ?.is_active) {
      return new Response(JSON.stringify({ error: "Integração SSótica indisponível" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let token = integ.bearer_token as string;
    if (token.startsWith("enc:")) {
      const { data: dec } = await admin.rpc("decrypt_secret", { _ciphertext: token });
      if (typeof dec === "string") token = dec;
    }

    const nowBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const today = new Date(Date.UTC(nowBR.getUTCFullYear(), nowBR.getUTCMonth(), nowBR.getUTCDate()));
    const overallStart = addDays(today, -COBRANCAS_LOOKBACK_DAYS);
    const overallEnd = addDays(today, COBRANCAS_FUTURE_DAYS);
    const cnpjParam = normalizeIdentifier(integ.cnpj as string);
    const clienteId = Number(ssoticaClienteId);

    const parcelasMap = new Map<string, ReturnType<typeof parseParcelaCobrancaAtiva>>();
    const windows = buildWindows(overallStart, overallEnd);

    for (const w of windows) {
      let page = 1;
      while (true) {
        const url =
          `${SSOTICA_BASE}/financeiro/contas-a-receber/periodo?cnpj=${encodeURIComponent(cnpjParam)}&inicio_periodo=${w.start}&fim_periodo=${w.end}&page=${page}&perPage=100`;
        const json = await fetchSSotica(url, token) as { totalPages?: number; data?: any[] };
        const items = json.data ?? [];
        if (items.length === 0) break;

        for (const parcela of items) {
          const parsed = parseParcelaCobrancaAtiva(parcela, today, clienteId);
          if (!parsed) continue;
          const key = parsed.parcela_id != null
            ? `pid:${parsed.parcela_id}`
            : `tit:${parsed.titulo_id ?? ""}-num:${parsed.numero_parcela ?? ""}-venc:${parsed.vencimento}`;
          if (!parcelasMap.has(key)) {
            parcelasMap.set(key, { ...parsed, ssotica_company_id: String(ssoticaCompanyId) } as any);
          }
        }

        const totalPages = json.totalPages ?? 1;
        if (page >= totalPages) break;
        page++;
      }
    }

    const parcelas = Array.from(parcelasMap.values())
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ ...p, ssotica_company_id: String(ssoticaCompanyId) }))
      .sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));

    const totalAtraso = parcelas.reduce((s, p) => s + Number(p.valor ?? 0), 0);

    return new Response(
      JSON.stringify({
        parcelas,
        qtd_parcelas_atrasadas: parcelas.length,
        total_atraso: totalAtraso,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ssotica-cliente-debitos]", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Erro ao buscar débitos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
