// Edge Function: gerar-relatorio-diario
// Gera relatórios de boletos pagos POR EMPRESA.
// Modo padrão (manual/cron): inclui parcelas pagas que ainda não apareceram em nenhum relatório.
// Modo intervalo (data_inicio/data_fim): mantém filtro por data, mas também exclui já reportadas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PagamentoJson {
  parcela_id?: string;
  nome: string;
  cpf: string;
  numero_parcela: number;
  total_parcelas: number;
  valor: number;
  pago_em: string;
  venda_id?: string | null;
  contrato_id?: string | null;
}

function legacyKey(p: { venda_id?: string | null; contrato_id?: string | null; numero_parcela?: number; pago_em?: string }) {
  return `${p.venda_id ?? ""}:${p.contrato_id ?? ""}:${p.numero_parcela ?? ""}:${p.pago_em ?? ""}`;
}

function dataSP(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(dt);
}

async function coletarJaReportados(admin: ReturnType<typeof createClient>) {
  const parcelaIds = new Set<string>();
  const legacyKeys = new Set<string>();

  const { data: rels, error } = await admin.from("crediario_relatorios_diarios").select("pagamentos");
  if (error) throw error;

  for (const r of rels ?? []) {
    const pagamentos = Array.isArray(r.pagamentos) ? r.pagamentos as PagamentoJson[] : [];
    for (const p of pagamentos) {
      if (p.parcela_id) parcelaIds.add(p.parcela_id);
      legacyKeys.add(legacyKey(p));
    }
  }

  return { parcelaIds, legacyKeys };
}

function jaFoiReportada(
  parcela: { id: string; venda_id: string; contrato_id: string | null; numero_parcela: number; pago_em: string | null },
  parcelaIds: Set<string>,
  legacyKeys: Set<string>,
) {
  if (parcelaIds.has(parcela.id)) return true;
  return legacyKeys.has(legacyKey(parcela));
}

async function montarPagamento(
  admin: ReturnType<typeof createClient>,
  p: {
    id: string;
    numero_parcela: number;
    total_parcelas: number;
    valor: number;
    valor_pago: number | null;
    pago_em: string;
    venda_id: string;
    contrato_id: string | null;
  },
): Promise<PagamentoJson> {
  let nome = "—";
  let cpf = "—";
  if (p.contrato_id) {
    const { data: c } = await admin
      .from("crediario_contracts").select("nome, cpf").eq("id", p.contrato_id).maybeSingle();
    if (c) { nome = c.nome; cpf = c.cpf; }
  } else if (p.venda_id) {
    const { data: v } = await admin
      .from("crediario_vendas").select("nome, cpf").eq("id", p.venda_id).maybeSingle();
    if (v) { nome = v.nome ?? "—"; cpf = v.cpf; }
  }

  return {
    parcela_id: p.id,
    nome, cpf,
    numero_parcela: p.numero_parcela,
    total_parcelas: p.total_parcelas,
    valor: Number(p.valor_pago ?? p.valor),
    pago_em: p.pago_em,
    venda_id: p.venda_id,
    contrato_id: p.contrato_id,
  };
}

function deduplicarPagamentos(lista: PagamentoJson[]): PagamentoJson[] {
  const seen = new Set<string>();
  const out: PagamentoJson[] = [];
  for (const p of lista) {
    const key = p.parcela_id ?? legacyKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => (a.pago_em ?? "").localeCompare(b.pago_em ?? ""));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as {
      data_referencia?: string;
      data_inicio?: string;
      data_fim?: string;
      company_id?: string;
      modo?: "pendentes" | "intervalo";
    };

    const modoIntervalo = !!(body.data_inicio && body.data_fim) || !!body.data_referencia;
    const { parcelaIds, legacyKeys } = await coletarJaReportados(admin);

    let q = admin
      .from("crediario_parcelas")
      .select("id, numero_parcela, total_parcelas, valor, valor_pago, pago_em, venda_id, contrato_id, company_id")
      .eq("status", "pago")
      .not("pago_em", "is", null);

    if (body.company_id) q = q.eq("company_id", body.company_id);

    if (modoIntervalo) {
      let dataInicio: string;
      let dataFim: string;
      if (body.data_inicio && body.data_fim) {
        dataInicio = body.data_inicio;
        dataFim = body.data_fim;
      } else {
        dataInicio = body.data_referencia!;
        dataFim = body.data_referencia!;
      }
      const inicioISO = `${dataInicio}T00:00:00-03:00`;
      const fimISO = `${dataFim}T23:59:59-03:00`;
      q = q.gte("pago_em", inicioISO).lte("pago_em", fimISO);
    }

    const { data: parcelas, error } = await q.order("pago_em", { ascending: true });
    if (error) throw error;

    const pendentes = (parcelas ?? []).filter(
      (p) => !jaFoiReportada(p, parcelaIds, legacyKeys),
    );

    if (!pendentes.length) {
      return json({
        ok: true,
        novos_pagamentos: 0,
        relatorios: [],
        mensagem: "Nenhum boleto pago pendente de inclusão em relatório.",
      });
    }

    const vendaIdsSemEmpresa = Array.from(new Set(
      pendentes.filter((p) => !p.company_id && p.venda_id).map((p) => p.venda_id),
    ));
    const vendaEmpresaMap = new Map<string, string | null>();
    if (vendaIdsSemEmpresa.length) {
      const { data: vendasEmp } = await admin
        .from("crediario_vendas")
        .select("id, company_id")
        .in("id", vendaIdsSemEmpresa);
      for (const v of vendasEmp ?? []) vendaEmpresaMap.set(v.id, v.company_id);
    }

    const empresaIdDe = (p: { company_id: string | null; venda_id: string }) =>
      p.company_id ?? vendaEmpresaMap.get(p.venda_id) ?? null;

    // Agrupa por (data_referencia SP, company_id)
    const grupos = new Map<string, typeof pendentes>();
    for (const p of pendentes) {
      const dataRef = dataSP(p.pago_em!);
      const empKey = empresaIdDe(p) ?? "__null__";
      const key = `${dataRef}|${empKey}`;
      const arr = grupos.get(key) ?? [];
      arr.push(p);
      grupos.set(key, arr);
    }

    const relatoriosGerados: { empresa: string; relatorio: unknown; novos: number }[] = [];

    for (const [key, grupoParcelas] of grupos) {
      const [dataRef, empKey] = key.split("|");
      const empresaIdReal = empKey === "__null__" ? null : empKey;

      let empresaNome = "(sem empresa)";
      if (empresaIdReal) {
        const { data: emp } = await admin.from("companies").select("name").eq("id", empresaIdReal).maybeSingle();
        empresaNome = emp?.name ?? empresaIdReal;
      }

      const novosPagamentos: PagamentoJson[] = [];
      for (const p of grupoParcelas) {
        novosPagamentos.push(await montarPagamento(admin, p));
      }

      let existingQuery = admin
        .from("crediario_relatorios_diarios")
        .select("*")
        .eq("data_referencia", dataRef);
      existingQuery = empresaIdReal
        ? existingQuery.eq("company_id", empresaIdReal)
        : existingQuery.is("company_id", null);
      const { data: existing } = await existingQuery.maybeSingle();

      const existentes = Array.isArray(existing?.pagamentos)
        ? existing.pagamentos as PagamentoJson[]
        : [];
      const merged = deduplicarPagamentos([...existentes, ...novosPagamentos]);
      const valorTotal = merged.reduce((s, x) => s + Number(x.valor || 0), 0);
      const tinhaConcluido = existing?.status === "concluido";

      const { data: rel, error: upErr } = await admin
        .from("crediario_relatorios_diarios")
        .upsert({
          data_referencia: dataRef,
          company_id: empresaIdReal,
          status: tinhaConcluido ? "pendente" : (existing?.status ?? "pendente"),
          total_pagamentos: merged.length,
          valor_total: valorTotal,
          pagamentos: merged,
          concluido_em: tinhaConcluido ? null : (existing?.concluido_em ?? null),
          concluido_por: tinhaConcluido ? null : (existing?.concluido_por ?? null),
        }, { onConflict: "data_referencia,company_id" })
        .select()
        .single();
      if (upErr) throw upErr;

      relatoriosGerados.push({
        empresa: empresaNome,
        relatorio: rel,
        novos: novosPagamentos.length,
      });
    }

    const totalNovos = relatoriosGerados.reduce((s, r) => s + r.novos, 0);

    return json({
      ok: true,
      novos_pagamentos: totalNovos,
      relatorios: relatoriosGerados,
      mensagem: totalNovos
        ? `${totalNovos} pagamento(s) incluído(s) em ${relatoriosGerados.length} relatório(s).`
        : "Nenhum boleto pago pendente de inclusão em relatório.",
    });
  } catch (err) {
    console.error("gerar-relatorio-diario error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
