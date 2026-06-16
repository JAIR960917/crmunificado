/**
 * ssotica-financeiro
 * Proxy unificado para os endpoints financeiros do SSótica:
 *   - contas_receber  → /financeiro/contas-a-receber/periodo
 *   - contas_pagar    → /financeiro/contas-a-pagar/periodo
 *
 * Fluxo caixa e recebimentos cartão não existem como endpoint SSótica.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SSOTICA_BASE = "https://app.ssotica.com.br/api/v1/integracoes";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIPO_ENDPOINT: Record<string, string> = {
  contas_receber: "financeiro/contas-a-receber/periodo",
  contas_pagar: "financeiro/contas-a-pagar/periodo",
};

async function decryptToken(supabase: ReturnType<typeof createClient>, raw: string): Promise<string> {
  if (!raw.startsWith("enc:")) return raw;
  const { data } = await supabase.rpc("decrypt_secret", { _ciphertext: raw });
  return typeof data === "string" ? data : raw;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function calcDiasAtraso(vencimento: string | null): number | null {
  if (!vencimento) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const venc = new Date(vencimento + "T00:00:00");
  return Math.floor((today.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
}

function normalizeContasReceber(row: any): Record<string, unknown> {
  const cliente = row.titulo?.cliente ?? row.cliente ?? {};
  const vencimento: string | null = row.vencimento ?? null;
  return {
    parcela_id: row.id,
    titulo_id: row.titulo?.id ?? null,
    numero_parcela: row.numero_parcela ?? null,
    vencimento,
    valor: Number(row.valor_reajustado ?? row.valor_original ?? row.valor ?? 0),
    situacao: row.situacao ?? row["situação"] ?? null,
    cliente_nome: cliente.nome ?? null,
    cliente_id: cliente.id ?? null,
    dias_atraso: calcDiasAtraso(vencimento),
    forma_pagamento: row.forma_pagamento ?? null,
    numero_documento: row.titulo?.numero_documento ?? null,
  };
}

function normalizeContasPagar(row: any): Record<string, unknown> {
  // SSótica contas a pagar: tenta múltiplas variações de campo de fornecedor/descrição
  const fornecedor = row.fornecedor ?? row.credor ?? row.pessoa ?? {};
  const fornecedor_nome =
    fornecedor?.nome ??
    row.descricao ??
    row.titulo ??
    row.nome_fornecedor ??
    row.fornecedor_nome ??
    null;

  const vencimento: string | null =
    row.vencimento ?? row.data_vencimento ?? row.dt_vencimento ?? null;

  return {
    parcela_id: row.id ?? null,
    numero_parcela: row.numero_parcela ?? row.parcela ?? null,
    vencimento,
    valor: Number(row.valor_original ?? row.valor ?? row.valor_total ?? 0),
    situacao: row.situacao ?? row["situação"] ?? row.status ?? null,
    fornecedor_nome,
    dias_atraso: calcDiasAtraso(vencimento),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Não autenticado" }, 401);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isAdmin = (roles || []).some((r: any) => r.role === "admin");
    const isGerente = (roles || []).some((r: any) => r.role === "gerente");
    if (!isAdmin && !isGerente) return json({ error: "Acesso negado" }, 403);

    const body = await req.json();
    const { tipo, companyId, startDate, endDate, page = 1, perPage = 100 } = body as {
      tipo: string;
      companyId: string;
      startDate: string;
      endDate: string;
      page?: number;
      perPage?: number;
    };

    if (!isAdmin && companyId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .single();
      if (!profile?.company_id || profile.company_id !== companyId) {
        return json({ error: "Acesso negado: empresa não autorizada" }, 403);
      }
    }

    if (!tipo || !companyId || !startDate || !endDate) {
      return json({ error: "tipo, companyId, startDate e endDate são obrigatórios" }, 400);
    }

    const endpoint = TIPO_ENDPOINT[tipo];
    if (!endpoint) {
      return json({
        data: [],
        total: 0,
        totalPages: 1,
        warning: `O tipo "${tipo}" não possui endpoint disponível no SSótica. Apenas contas_receber e contas_pagar são suportados.`,
      });
    }

    const { data: integ, error: integErr } = await supabase
      .from("ssotica_integrations")
      .select("company_id, cnpj, bearer_token, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .maybeSingle();

    if (integErr || !integ) {
      return json({ data: [], total: 0, warning: "Integração SSótica não encontrada para esta empresa" });
    }

    const token = await decryptToken(supabase, integ.bearer_token);
    const cnpj = (integ.cnpj || "").replace(/\D/g, "");

    const url = `${SSOTICA_BASE}/${endpoint}?cnpj=${encodeURIComponent(cnpj)}&inicio_periodo=${startDate}&fim_periodo=${endDate}&page=${page}&perPage=${perPage}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      // Retorna 200 para o cliente Supabase não engolir o erro, mas com mensagem útil
      return json({
        data: [],
        total: 0,
        totalPages: 1,
        error: `SSótica retornou erro ${res.status}. Detalhes: ${txt.slice(0, 200) || "(sem detalhes)"}`,
      });
    }

    const ssoticaData = await res.json().catch(() => ({}));

    const rawRows: any[] = Array.isArray(ssoticaData)
      ? ssoticaData
      : Array.isArray(ssoticaData?.data)
      ? ssoticaData.data
      : [];

    const total: number = typeof ssoticaData?.total === "number"
      ? ssoticaData.total
      : rawRows.length;

    const totalPages: number = typeof ssoticaData?.last_page === "number"
      ? ssoticaData.last_page
      : typeof ssoticaData?.totalPages === "number"
      ? ssoticaData.totalPages
      : Math.ceil(total / perPage) || 1;

    // Normaliza campos para que o frontend use nomes consistentes
    const normalizedRows = rawRows.map(
      tipo === "contas_receber" ? normalizeContasReceber : normalizeContasPagar,
    );

    return json({ data: normalizedRows, total, totalPages, currentPage: page });
  } catch (err) {
    console.error("[ssotica-financeiro]", err);
    return json({ error: (err as Error).message || "Erro interno" }, 500);
  }
});
