// Edge function: ssotica-estoque-busca
// Busca o estoque de produtos de UMA empresa SSótica (endpoint
// /api/v1/produto/estoque/busca, fora do base /api/v1/integracoes usado
// pelas demais funções ssotica-*).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getUserFromRequest, assertAdminOrGerente } from "../_shared/staffAuth.ts";

const ESTOQUE_URL = "https://app.ssotica.com.br/api/v1/produto/estoque/busca";
const MAX_PER_PAGE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function normalizeIdentifier(s: string) {
  return (s || "").replace(/[^0-9]/g, "");
}

async function fetchSSotica(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SSótica ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function mapProduto(p: any) {
  const estoqueAtual = Number(p.estoque_atual ?? 0);
  const reservadoOs = Number(p.reservado_os ?? 0);
  return {
    id: p.id,
    referencia: p.referencia,
    descricao: p.descricao,
    unidade: p.unidade,
    grife: p.grife,
    grupo: p.grupo,
    subgrupo: p.subgrupo,
    cor: p.cor,
    tamanho: p.tamanho,
    estoque_atual: estoqueAtual,
    reservado_os: reservadoOs,
    disponivel: estoqueAtual - reservadoOs,
    preco_venda: Number(p.preco_venda ?? 0),
    preco_custo: Number(p.preco_custo ?? 0),
    ativo: p.ativo,
    codigo_ean: p.codigo_ean,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const companyId: string | null = body.companyId || null;
    const referencia: string | null = body.referencia || null;
    const page: number = Number(body.page ?? 1) || 1;
    const perPage: number = Math.min(Number(body.perPage ?? MAX_PER_PAGE) || MAX_PER_PAGE, MAX_PER_PAGE);

    if (!companyId) {
      return new Response(
        JSON.stringify({ error: "companyId é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { user, response: authResponse } = await getUserFromRequest(
      req,
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (authResponse) return authResponse;

    const forbidden = await assertAdminOrGerente(supabase, user!.id, corsHeaders);
    if (forbidden) return forbidden;

    if (companyId) {
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);
      const isAdmin = (userRoles || []).some((r: any) => r.role === "admin");
      if (!isAdmin) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("user_id", user!.id)
          .single();
        if (!profile?.company_id || profile.company_id !== companyId) {
          return new Response(JSON.stringify({ error: "Acesso negado: empresa não autorizada" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Busca integração da empresa solicitada
    const { data: integ, error: integErr } = await supabase
      .from("ssotica_integrations")
      .select("id, company_id, cnpj, bearer_token, license_code, is_active")
      .eq("company_id", companyId)
      .maybeSingle();

    const { data: comp } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    const companyName = (comp as any)?.name || "—";

    if (integErr || !integ) {
      return new Response(
        JSON.stringify({
          companyId,
          companyName,
          data: [],
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          perPage,
          warning: "Integração SSótica não encontrada para esta empresa",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!integ.is_active) {
      return new Response(
        JSON.stringify({
          companyId,
          companyName,
          data: [],
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          perPage,
          warning: "Integração SSótica inativa",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let token = integ.bearer_token;
    if (token && token.startsWith("enc:")) {
      const { data: dec } = await supabase.rpc("decrypt_secret", { _ciphertext: token });
      if (typeof dec === "string") token = dec;
    }

    let licenseCode = integ.license_code;
    if (licenseCode && licenseCode.startsWith("enc:")) {
      const { data: dec } = await supabase.rpc("decrypt_secret", { _ciphertext: licenseCode });
      if (typeof dec === "string") licenseCode = dec;
    }
    const empresa = (licenseCode || normalizeIdentifier(integ.cnpj)).trim();

    const params = new URLSearchParams({ empresa });
    if (referencia) {
      params.set("referencia", referencia);
    } else {
      params.set("page", String(page));
      params.set("perPage", String(perPage));
    }

    const result = await fetchSSotica(`${ESTOQUE_URL}?${params.toString()}`, token);
    const items = Array.isArray(result?.data) ? result.data : [];

    return new Response(
      JSON.stringify({
        companyId,
        companyName,
        currentPage: Number(result?.currentPage ?? page),
        totalPages: Number(result?.totalPages ?? (items.length > 0 ? 1 : 0)),
        totalItems: Number(result?.totalItems ?? items.length),
        perPage: Number(result?.perPage ?? perPage),
        data: items.map(mapProduto),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ssotica-estoque-busca] erro", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
