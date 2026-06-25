// Edge Function: zapsign-sincronizar-status
// Consulta GET /docs/{token}/ na ZapSign e atualiza o contrato local.
// Body: { contrato_id: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function zapsignBase() {
  const env = (Deno.env.get("ZAPSIGN_ENV") || "sandbox").toLowerCase();
  return env.startsWith("prod")
    ? "https://api.zapsign.com.br"
    : "https://sandbox.api.zapsign.com.br";
}

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
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!apiToken) return json({ ok: false, error: "ZAPSIGN_API_TOKEN não configurado" }, 500);

    const body = await req.json().catch(() => ({}));
    const contratoId = body?.contrato_id;
    if (!contratoId) return json({ ok: false, error: "contrato_id obrigatório" }, 400);

    const { data: contrato } = await admin
      .from("crediario_contracts")
      .select("id, user_id, status, signature_external_id, signature_data")
      .eq("id", contratoId).maybeSingle();
    if (!contrato) return json({ ok: false, error: "Contrato não encontrado" }, 404);

    if (contrato.user_id !== userId) {
      const { data: roleRow } = await admin
        .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ ok: false, error: "Sem permissão" }, 403);
    }

    const docToken = contrato.signature_external_id;
    if (!docToken) return json({ ok: false, error: "Contrato sem doc_token ZapSign" }, 400);

    const resp = await fetch(`${zapsignBase()}/api/v1/docs/${docToken}/`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    });
    const text = await resp.text();
    const docJson = (() => { try { return JSON.parse(text); } catch { return null; } })();

    if (!resp.ok) {
      return json({
        ok: false,
        error: `ZapSign HTTP ${resp.status}: ${text.slice(0, 200)}`,
        detail: docJson,
      }, 502);
    }

    const status: string = String(docJson?.status ?? "").toLowerCase();
    const signedFile: string | null = docJson?.signed_file ?? null;
    const sigDataAtual: any = contrato.signature_data ?? {};

    let novoStatus = contrato.status;
    if (status === "signed") novoStatus = "assinado";
    else if (status === "refused") novoStatus = "recusado";

    const update: Record<string, unknown> = {
      signature_data: { ...sigDataAtual, raw: docJson, signed_file: signedFile, last_status: status },
    };
    if (novoStatus !== contrato.status) update.status = novoStatus;
    if (novoStatus === "assinado") update.signed_at = new Date().toISOString();

    await admin.from("crediario_contracts").update(update).eq("id", contrato.id);

    return json({
      ok: true,
      status: novoStatus,
      zapsign_status: status,
      signed_file: signedFile,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
