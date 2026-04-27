// Edge function: ssotica-cliente-vendas
// Busca o histórico completo de vendas (com itens/produtos) de um cliente SSótica
// em UMA OU MAIS lojas (integrações). Quando o cliente compra em duas lojas
// diferentes (mesmo CPF), agrupa as vendas das duas lojas, marcando em cada
// venda/item a qual loja pertence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SSOTICA_BASE = "https://app.ssotica.com.br/api/v1/integracoes";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

function buildWindows(start: Date, end: Date, sizeDays = 30) {
  const windows: { start: string; end: string }[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    const w_end = addDays(cur, sizeDays - 1);
    const finalEnd = w_end > end ? end : w_end;
    windows.push({ start: ymd(cur), end: ymd(finalEnd) });
    cur = addDays(finalEnd, 1);
  }
  return windows;
}

const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

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

type Target = {
  ssoticaClienteId: number;
  ssoticaCompanyId: string;
  cnpj: string;
  bearer_token: string;
  loja_nome: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ssoticaClienteId, ssoticaCompanyId, monthsBack, cpf } = await req.json();
    if (!ssoticaClienteId || !ssoticaCompanyId) {
      return new Response(
        JSON.stringify({ error: "ssoticaClienteId e ssoticaCompanyId são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Valida usuário autenticado
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // Descobre TODAS as integrações onde este mesmo cliente (CPF) está cadastrado.
    // Estratégia:
    //  - Sempre inclui o par (ssoticaClienteId, ssoticaCompanyId) recebido.
    //  - Se temos CPF, procura em crm_cobrancas e crm_renovacoes outros pares
    //    com mesmo CPF/documento mas company_id diferente — isso nos dá os
    //    ssotica_cliente_id correspondentes em outras lojas.
    // ============================================================
    const cpfDigits = onlyDigits(cpf || "");
    const targetSet = new Map<string, { ssoticaClienteId: number; ssoticaCompanyId: string }>();
    const mainKey = `${ssoticaCompanyId}:${ssoticaClienteId}`;
    targetSet.set(mainKey, {
      ssoticaClienteId: Number(ssoticaClienteId),
      ssoticaCompanyId: String(ssoticaCompanyId),
    });

    if (cpfDigits.length >= 11) {
      const findInTable = async (table: string) => {
        const { data } = await supabase
          .from(table)
          .select("ssotica_cliente_id, ssotica_company_id, data")
          .not("ssotica_cliente_id", "is", null)
          .not("ssotica_company_id", "is", null);
        for (const r of (data ?? []) as any[]) {
          const docDigits = onlyDigits(r?.data?.documento ?? r?.data?.cpf ?? "");
          if (docDigits === cpfDigits && r.ssotica_cliente_id && r.ssotica_company_id) {
            const key = `${r.ssotica_company_id}:${r.ssotica_cliente_id}`;
            if (!targetSet.has(key)) {
              targetSet.set(key, {
                ssoticaClienteId: Number(r.ssotica_cliente_id),
                ssoticaCompanyId: String(r.ssotica_company_id),
              });
            }
          }
        }
      };
      await findInTable("crm_cobrancas");
      await findInTable("crm_renovacoes");
    }

    // Carrega integrações + nome das empresas para todos os targets identificados
    const companyIds = Array.from(new Set(Array.from(targetSet.values()).map((t) => t.ssoticaCompanyId)));
    const [{ data: integs }, { data: companiesRows }] = await Promise.all([
      supabase
        .from("ssotica_integrations")
        .select("company_id, cnpj, bearer_token, is_active")
        .in("company_id", companyIds),
      supabase.from("companies").select("id, name").in("id", companyIds),
    ]);
    const companyName = new Map<string, string>(
      ((companiesRows ?? []) as any[]).map((c) => [String(c.id), String(c.name)]),
    );
    const integByCompany = new Map<string, any>();
    for (const i of (integs ?? []) as any[]) {
      if (!i.is_active) continue;
      // descriptografa token se necessário
      if (i.bearer_token && String(i.bearer_token).startsWith("enc:")) {
        const { data: dec } = await supabase.rpc("decrypt_secret", { _ciphertext: i.bearer_token });
        if (typeof dec === "string") i.bearer_token = dec;
      }
      integByCompany.set(String(i.company_id), i);
    }

    // Constrói lista final de "alvos" a varrer
    const targets: Target[] = [];
    for (const t of targetSet.values()) {
      const integ = integByCompany.get(t.ssoticaCompanyId);
      if (!integ) continue;
      targets.push({
        ssoticaClienteId: t.ssoticaClienteId,
        ssoticaCompanyId: t.ssoticaCompanyId,
        cnpj: onlyDigits(integ.cnpj),
        bearer_token: integ.bearer_token,
        loja_nome: companyName.get(t.ssoticaCompanyId) ?? null,
      });
    }

    if (targets.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhuma integração SSótica ativa encontrada para este cliente" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Janela: padrão 24 meses, máximo 96
    const months = Math.min(Math.max(Number(monthsBack) || 24, 1), 96);
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    const windows = buildWindows(start, today, 30);

    const vendasCliente: any[] = [];
    const lojasConsultadas: { company_id: string; loja_nome: string | null; ssotica_cliente_id: number; vendas_count: number }[] = [];

    for (const tgt of targets) {
      const targetClienteId = Number(tgt.ssoticaClienteId);
      let vendasNesseAlvo = 0;

      for (const w of windows) {
        const url = `${SSOTICA_BASE}/vendas/periodo?cnpj=${encodeURIComponent(tgt.cnpj)}&inicio_periodo=${w.start}&fim_periodo=${w.end}`;
        try {
          const vendas = await fetchSSotica(url, tgt.bearer_token);
          if (!Array.isArray(vendas)) continue;
          for (const venda of vendas) {
            if (venda?.cliente?.id === targetClienteId) {
              vendasNesseAlvo++;
              vendasCliente.push({
                id: venda.id,
                ssotica_company_id: tgt.ssoticaCompanyId,
                loja_nome: tgt.loja_nome,
                data: venda.data,
                hora: venda.hora,
                numero: venda.numero,
                status: venda.status,
                valor_bruto: Number(venda.valor_bruto ?? 0),
                valor_liquido: Number(venda.valor_liquido ?? 0),
                desconto: Number(venda.desconto ?? 0),
                funcionario: venda.funcionario
                  ? { id: venda.funcionario.id, nome: venda.funcionario.nome, funcao: venda.funcionario.funcao }
                  : null,
                formas_pagamento: Array.isArray(venda.formas_pagamento)
                  ? venda.formas_pagamento.map((fp: any) => ({
                      forma_pagamento: fp.forma_pagamento,
                      valor: Number(fp.valor ?? 0),
                      qtd_parcelas: fp.qtd_parcelas,
                      data: fp.data,
                    }))
                  : [],
                itens: Array.isArray(venda.itens)
                  ? venda.itens.map((it: any) => ({
                      id: it.id,
                      quantidade: Number(it.quantidade ?? 0),
                      valor_unitario_liquido: Number(it.valor_unitario_liquido ?? 0),
                      valor_total_liquido: Number(it.valor_total_liquido ?? 0),
                      produto: it.produto
                        ? {
                            id: it.produto.id,
                            referencia: it.produto.referencia,
                            descricao: it.produto.descricao,
                            grupo: it.produto.grupo,
                            grife: it.produto.grife,
                          }
                        : null,
                      ordem_servico: it.ordem_servico
                        ? {
                            numero: it.ordem_servico.numero,
                            status_detalhado: it.ordem_servico.status_detalhado,
                            entrega: it.ordem_servico.entrega,
                          }
                        : null,
                    }))
                  : [],
              });
            }
          }
        } catch (err) {
          console.error(`[ssotica-cliente-vendas] loja=${tgt.ssoticaCompanyId} janela ${w.start}→${w.end}`, err);
        }
      }

      lojasConsultadas.push({
        company_id: tgt.ssoticaCompanyId,
        loja_nome: tgt.loja_nome,
        ssotica_cliente_id: targetClienteId,
        vendas_count: vendasNesseAlvo,
      });
    }

    // Ordena: venda mais recente primeiro
    vendasCliente.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

    return new Response(
      JSON.stringify({
        cliente_id: Number(ssoticaClienteId),
        cpf: cpfDigits || null,
        months_back: months,
        total_vendas: vendasCliente.length,
        lojas_consultadas: lojasConsultadas,
        vendas: vendasCliente,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ssotica-cliente-vendas] erro", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
