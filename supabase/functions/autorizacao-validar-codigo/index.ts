// Edge Function: autorizacao-validar-codigo
// Valida um código de autorização de uso único e, se válido, aprova a venda
// (aprovacao_admin = 'aprovada'), liberando assinatura e emissão de boletos.
// Qualquer usuário autenticado pode chamar (ex.: gerente sem papel admin) —
// a escrita privilegiada em "vendas" é feita com a service role abaixo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as { venda_id?: string; codigo?: string };
    const vendaId = (body.venda_id ?? "").trim();
    const codigo = (body.codigo ?? "").trim();
    if (!vendaId || !codigo) return json({ ok: false, error: "venda_id e código são obrigatórios" }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: venda, error: vendaErr } = await admin
      .from("crediario_vendas")
      .select("id, nome, cpf, aprovacao_admin, aprovacao_motivo, companies(name)")
      .eq("id", vendaId)
      .maybeSingle();
    if (vendaErr) return json({ ok: false, error: vendaErr.message }, 500);
    if (!venda) return json({ ok: false, error: "Venda não encontrada" }, 404);
    if (venda.aprovacao_admin !== "pendente" && venda.aprovacao_admin !== "rejeitada") {
      return json({ ok: false, error: "Esta venda não está aguardando autorização" }, 400);
    }
    const empresasField = venda.companies as { name: string | null } | { name: string | null }[] | null;
    const empresaNome = Array.isArray(empresasField) ? empresasField[0]?.name ?? null : empresasField?.name ?? null;

    const { data: codigoRow, error: codigoErr } = await admin
      .from("crediario_codigos_autorizacao")
      .select("id, criado_por")
      .eq("codigo", codigo)
      .is("usado_em", null)
      .maybeSingle();
    if (codigoErr) return json({ ok: false, error: codigoErr.message }, 500);
    if (!codigoRow) return json({ ok: false, error: "Código inválido ou já utilizado" }, 400);

    const nowIso = new Date().toISOString();

    // Update condicional (usado_em IS NULL) + select para garantir uso único
    // mesmo em caso de duas requisições concorrentes com o mesmo código.
    const { data: updatedCodigo, error: updCodigoErr } = await admin
      .from("crediario_codigos_autorizacao")
      .update({
        usado_em: nowIso,
        usado_por: userData.user.id,
        venda_id: vendaId,
        venda_nome: venda.nome,
        venda_cpf: venda.cpf,
        empresa_nome: empresaNome,
      })
      .eq("id", codigoRow.id)
      .is("usado_em", null)
      .select("id");
    if (updCodigoErr) return json({ ok: false, error: updCodigoErr.message }, 500);
    if (!updatedCodigo || updatedCodigo.length === 0) {
      return json({ ok: false, error: "Código já foi utilizado" }, 409);
    }

    const motivo = venda.aprovacao_motivo
      ? `${venda.aprovacao_motivo} — aprovada usando o código de autorização ${codigo}`
      : `Aprovada usando o código de autorização ${codigo}`;
    const { error: updVendaErr } = await admin
      .from("crediario_vendas")
      .update({
        aprovacao_admin: "aprovada",
        aprovacao_em: nowIso,
        aprovacao_por: codigoRow.criado_por,
        aprovacao_motivo: motivo,
      })
      .eq("id", vendaId);
    if (updVendaErr) return json({ ok: false, error: updVendaErr.message }, 500);

    return json({ ok: true });
  } catch (err) {
    console.error("autorizacao-validar-codigo error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
