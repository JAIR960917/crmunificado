// Edge Function: zapsign-baixar-assinado
// Baixa o PDF assinado da ZapSign (signed_file). Se não existir em signature_data,
// faz GET no doc para obter. Retorna em base64 para download direto pelo front.
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
      .select("id, user_id, nome, signature_external_id, signature_data")
      .eq("id", contratoId).maybeSingle();
    if (!contrato) return json({ ok: false, error: "Contrato não encontrado" }, 404);

    if (contrato.user_id !== userId) {
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "financeiro", "gerente"]);
      if (!roleRows || roleRows.length === 0) return json({ ok: false, error: "Sem permissão" }, 403);
    }

    const sigData: any = contrato.signature_data ?? {};

    // URLs assinadas da S3/ZapSign expiram (parâmetro Expires). Sempre buscamos
    // uma URL fresca via GET /docs/{token}/ para evitar HTTP 403.
    async function fetchFreshSignedFile(): Promise<string | null> {
      if (!contrato.signature_external_id) return null;
      const resp = await fetch(`${zapsignBase()}/api/v1/docs/${contrato.signature_external_id}/`, {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
      });
      const docJson = await resp.json().catch(() => null);
      const fresh = docJson?.signed_file ?? null;
      if (fresh) {
        await admin.from("crediario_contracts").update({
          signature_data: { ...sigData, signed_file: fresh, raw: docJson },
        }).eq("id", contrato.id);
      }
      return fresh;
    }

    let signedFile: string | null = await fetchFreshSignedFile();

    // Fallback para o cache, caso a chamada externa falhe
    if (!signedFile) {
      signedFile = sigData?.signed_file ?? sigData?.raw?.signed_file ?? null;
    }

    if (!signedFile) {
      return json({ ok: false, error: "PDF assinado ainda não disponível na ZapSign" }, 404);
    }

    // Baixa o PDF — se 403 (URL expirada), tenta uma vez mais com URL fresca
    let pdfResp = await fetch(signedFile);
    if (pdfResp.status === 403) {
      const refreshed = await fetchFreshSignedFile();
      if (refreshed && refreshed !== signedFile) {
        signedFile = refreshed;
        pdfResp = await fetch(signedFile);
      }
    }
    if (!pdfResp.ok) {
      return json({ ok: false, error: `Falha ao baixar PDF (HTTP ${pdfResp.status})`, pdf_url: signedFile }, 502);
    }
    const ab = await pdfResp.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(bin);

    const safeName = (contrato.nome || "contrato").replace(/[^a-zA-Z0-9]+/g, "_");
    return json({
      ok: true,
      pdf_base64: base64,
      pdf_url: signedFile,
      filename: `${safeName}-assinado.pdf`,
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
