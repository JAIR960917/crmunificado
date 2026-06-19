// Edge function: ssotica-vendas-periodo
// Busca vendas (com itens/produtos) de UMA empresa SSótica em um período.
// O frontend chama uma vez por empresa (em paralelo) para evitar timeout.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const startDate: string = body.startDate;
    const endDate: string = body.endDate;
    const companyId: string | null = body.companyId || null;

    if (!startDate || !endDate || !companyId) {
      return new Response(
        JSON.stringify({ error: "startDate, endDate e companyId são obrigatórios" }),
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

    // Verifica papel (admin ou gerente)
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin");
    const isGerente = (roles || []).some((r: any) => r.role === "gerente");
    if (!isAdmin && !isGerente) {
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isAdmin && companyId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .single();
      if (!profile?.company_id || profile.company_id !== companyId) {
        return new Response(JSON.stringify({ error: "Acesso negado: empresa não autorizada" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Busca integração da empresa solicitada
    const { data: integ, error: integErr } = await supabase
      .from("ssotica_integrations")
      .select("id, company_id, cnpj, bearer_token, is_active")
      .eq("company_id", companyId)
      .maybeSingle();

    if (integErr || !integ) {
      return new Response(
        JSON.stringify({
          companyId,
          vendas: [],
          total_vendas: 0,
          total_itens: 0,
          warning: "Integração SSótica não encontrada para esta empresa",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!integ.is_active) {
      return new Response(
        JSON.stringify({
          companyId,
          vendas: [],
          total_vendas: 0,
          total_itens: 0,
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
    const cnpj = normalizeIdentifier(integ.cnpj);

    // Nome da empresa
    const { data: comp } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    const companyName = (comp as any)?.name || "—";

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    // A API da SSótica tem limite de 30 dias por janela — usar mais que isso
    // faz a chamada retornar vazio/falhar silenciosamente para o período.
    const windows = buildWindows(start, end, 30);

    // Executa janelas em paralelo (limitado) para acelerar
    const results = await Promise.all(
      windows.map(async (w) => {
        const url = `${SSOTICA_BASE}/vendas/periodo?cnpj=${encodeURIComponent(cnpj)}&inicio_periodo=${w.start}&fim_periodo=${w.end}`;
        try {
          const vendas = await fetchSSotica(url, token);
          return Array.isArray(vendas) ? vendas : [];
        } catch (err) {
          console.error(`[ssotica-vendas-periodo] ${cnpj} ${w.start}→${w.end}`, err);
          return [];
        }
      }),
    );

    const vendasOut: any[] = [];
    for (const vendas of results) {
      for (const venda of vendas) {
        const vData = String(venda.data || "");
        if (vData < startDate || vData > endDate) continue;

        vendasOut.push({
          id: venda.id,
          data: venda.data,
          hora: venda.hora,
          numero: venda.numero,
          status: venda.status,
          valor_bruto: Number(venda.valor_bruto ?? 0),
          valor_liquido: Number(venda.valor_liquido ?? 0),
          desconto: Number(venda.desconto ?? 0),
          company_id: companyId,
          company_name: companyName,
          cliente: venda.cliente
            ? { id: venda.cliente.id, nome: venda.cliente.nome }
            : null,
          funcionario: venda.funcionario
            ? {
                id: venda.funcionario.id,
                nome: venda.funcionario.nome,
                funcao: venda.funcionario.funcao,
              }
            : null,
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
              }))
            : [],
        });
      }
    }

    // Sobrescreve a "funcao" do funcionario com o cargo (role) do nosso sistema,
    // quando houver mapeamento ssotica_user_mappings -> user_roles.
    // O SSótica retorna "Vendedor" para todo mundo; o nosso sistema é a fonte da verdade.
    const funcIds = Array.from(
      new Set(
        vendasOut
          .map((v) => v.funcionario?.id)
          .filter((x): x is number => typeof x === "number"),
      ),
    );

    const roleLabel: Record<string, string> = {
      admin: "Administrador",
      gerente: "Gerente",
      financeiro: "Financeiro",
      vendedor: "Vendedor",
    };

    if (funcIds.length > 0) {
      const { data: mappings } = await supabase
        .from("ssotica_user_mappings")
        .select("ssotica_funcionario_id, user_id")
        .eq("company_id", companyId)
        .in("ssotica_funcionario_id", funcIds);

      const userIds = Array.from(
        new Set((mappings || []).map((m: any) => m.user_id)),
      );
      let rolesByUser = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: rolesRows } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", userIds);
        // Prioridade: admin > gerente > financeiro > vendedor
        const priority: Record<string, number> = {
          admin: 4,
          gerente: 3,
          financeiro: 2,
          vendedor: 1,
        };
        for (const r of rolesRows || []) {
          const cur = rolesByUser.get(r.user_id);
          if (!cur || (priority[r.role] || 0) > (priority[cur] || 0)) {
            rolesByUser.set(r.user_id, r.role);
          }
        }
      }
      const funcToRole = new Map<number, string>();
      for (const m of mappings || []) {
        const role = rolesByUser.get(m.user_id);
        if (role) funcToRole.set(m.ssotica_funcionario_id, role);
      }

      for (const v of vendasOut) {
        const fid = v.funcionario?.id;
        if (fid && funcToRole.has(fid)) {
          const role = funcToRole.get(fid)!;
          v.funcionario.funcao = roleLabel[role] || v.funcionario.funcao;
        }
      }
    }

    vendasOut.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const totalItens = vendasOut.reduce((acc, v) => acc + v.itens.length, 0);

    return new Response(
      JSON.stringify({
        companyId,
        companyName,
        start: startDate,
        end: endDate,
        total_vendas: vendasOut.length,
        total_itens: totalItens,
        vendas: vendasOut,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ssotica-vendas-periodo] erro", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
