// Edge function: ssotica-cliente-vendas
// Busca o histórico completo de vendas (com itens/produtos) de um cliente SSótica
// em UMA OU MAIS lojas (integrações).
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

// Executa promessas em paralelo com limite de concorrência
async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await worker(items[idx]);
      } catch (e) {
        // @ts-ignore
        results[idx] = undefined;
      }
    }
  });
  await Promise.all(runners);
  return results;
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

    // Descobre outras lojas via CPF — usando filtro JSONB direto no banco
    // (em vez de baixar tabelas inteiras para JS).
    const cpfDigits = onlyDigits(cpf || "");
    const targetSet = new Map<string, { ssoticaClienteId: number; ssoticaCompanyId: string }>();
    const mainKey = `${ssoticaCompanyId}:${ssoticaClienteId}`;
    targetSet.set(mainKey, {
      ssoticaClienteId: Number(ssoticaClienteId),
      ssoticaCompanyId: String(ssoticaCompanyId),
    });

    if (cpfDigits.length >= 11) {
      const orFilter = `data->>documento.eq.${cpfDigits},data->>cpf.eq.${cpfDigits}`;
      const tables = ["crm_cobrancas", "crm_renovacoes"];
      const results = await Promise.all(
        tables.map((t) =>
          supabase
            .from(t)
            .select("ssotica_cliente_id, ssotica_company_id")
            .not("ssotica_cliente_id", "is", null)
            .not("ssotica_company_id", "is", null)
            .or(orFilter)
            .limit(500),
        ),
      );
      for (const { data } of results) {
        for (const r of (data ?? []) as any[]) {
          if (!r.ssotica_cliente_id || !r.ssotica_company_id) continue;
          const key = `${r.ssotica_company_id}:${r.ssotica_cliente_id}`;
          if (!targetSet.has(key)) {
            targetSet.set(key, {
              ssoticaClienteId: Number(r.ssotica_cliente_id),
              ssoticaCompanyId: String(r.ssotica_company_id),
            });
          }
        }
      }
    }

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
      if (i.bearer_token && String(i.bearer_token).startsWith("enc:")) {
        const { data: dec } = await supabase.rpc("decrypt_secret", { _ciphertext: i.bearer_token });
        if (typeof dec === "string") i.bearer_token = dec;
      }
      integByCompany.set(String(i.company_id), i);
    }

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

    const months = Math.min(Math.max(Number(monthsBack) || 24, 1), 96);
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    const windows = buildWindows(start, today, 30);

    // Constrói todas as tarefas (target × janela) e executa em paralelo
    type Task = { tgt: Target; w: { start: string; end: string } };
    const tasks: Task[] = [];
    for (const tgt of targets) for (const w of windows) tasks.push({ tgt, w });

    const vendasCliente: any[] = [];
    const counts = new Map<string, number>();
    const diag = {
      windows: windows.length,
      tasks: tasks.length,
      raw_vendas_total: 0,
      raw_vendas_por_loja: {} as Record<string, number>,
      cliente_ids_encontrados: {} as Record<string, number>,
      erros: [] as { loja: string; janela: string; erro: string }[],
    };

    await runPool(tasks, 8, async ({ tgt, w }) => {
      const targetClienteId = Number(tgt.ssoticaClienteId);
      const url = `${SSOTICA_BASE}/vendas/periodo?cnpj=${encodeURIComponent(tgt.cnpj)}&inicio_periodo=${w.start}&fim_periodo=${w.end}`;
      try {
        const vendas = await fetchSSotica(url, tgt.bearer_token);
        if (!Array.isArray(vendas)) return;
        diag.raw_vendas_total += vendas.length;
        diag.raw_vendas_por_loja[tgt.ssoticaCompanyId] =
          (diag.raw_vendas_por_loja[tgt.ssoticaCompanyId] || 0) + vendas.length;
        for (const venda of vendas) {
          const cid = venda?.cliente?.id;
          if (cid != null) {
            const k = String(cid);
            diag.cliente_ids_encontrados[k] = (diag.cliente_ids_encontrados[k] || 0) + 1;
          }
          if (cid !== targetClienteId) continue;
          counts.set(tgt.ssoticaCompanyId, (counts.get(tgt.ssoticaCompanyId) || 0) + 1);
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
            itens: Array.isArray(venda.itens)
              ? venda.itens.map((it: any) => {
                  const os = it.ordem_servico;
                  const osNome =
                    os?.funcionario?.nome ??
                    os?.vendedor?.nome ??
                    os?.responsavel?.nome ??
                    os?.usuario?.nome ??
                    (typeof os?.funcionario === "string" ? os.funcionario : null) ??
                    (typeof os?.vendedor === "string" ? os.vendedor : null) ??
                    null;
                  return {
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
                    ordem_servico: os
                      ? {
                          numero: os.numero,
                          status_detalhado: os.status_detalhado,
                          entrega: os.entrega,
                          responsavel_nome: osNome,
                        }
                      : null,
                  };
                })
              : [],
          });
        }
      } catch (err) {
        const msg = (err as Error).message || String(err);
        diag.erros.push({ loja: tgt.ssoticaCompanyId, janela: `${w.start}→${w.end}`, erro: msg.slice(0, 200) });
        console.error(`[ssotica-cliente-vendas] loja=${tgt.ssoticaCompanyId} janela ${w.start}→${w.end}`, err);
      }
    });


    vendasCliente.sort((a, b) => (b.data || "").localeCompare(a.data || ""));

    const lojasConsultadas = targets.map((t) => ({
      company_id: t.ssoticaCompanyId,
      loja_nome: t.loja_nome,
      ssotica_cliente_id: t.ssoticaClienteId,
      vendas_count: counts.get(t.ssoticaCompanyId) || 0,
    }));

    return new Response(
      JSON.stringify({
        cliente_id: Number(ssoticaClienteId),
        cpf: cpfDigits || null,
        months_back: months,
        total_vendas: vendasCliente.length,
        lojas_consultadas: lojasConsultadas,
        diagnostico: {
          ...diag,
          // só os 10 cliente_ids mais frequentes pra não estourar payload
          cliente_ids_top: Object.entries(diag.cliente_ids_encontrados)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
          cliente_ids_encontrados: undefined,
        },
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
