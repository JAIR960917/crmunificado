// Edge function: ssotica-test-connection
// Faz uma chamada simples na API SSótica para validar token + CNPJ/Código
// e retorna a URL exata + resposta crua para debug.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  assertAdminOrGerente,
  assertCanAccessIntegration,
  getUserFromRequest,
} from "../_shared/staffAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SSOTICA_BASE = "https://app.ssotica.com.br/api/v1/integracoes";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const integrationId: string | undefined = body.integration_id;
    if (!integrationId) {
      return new Response(JSON.stringify({ ok: false, error: "integration_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user, response: authResp } = await getUserFromRequest(req, supabaseUrl, serviceKey);
    if (authResp) return authResp;
    const staffBlock = await assertAdminOrGerente(admin, user!.id, corsHeaders);
    if (staffBlock) return staffBlock;
    const { response: integBlock } = await assertCanAccessIntegration(
      admin,
      user!.id,
      integrationId,
      corsHeaders,
    );
    if (integBlock) return integBlock;

    const { data: integ, error } = await admin
      .from("ssotica_integrations")
      .select("id, cnpj, license_code, bearer_token")
      .eq("id", integrationId)
      .maybeSingle();

    if (error) throw error;
    if (!integ) {
      return new Response(JSON.stringify({ ok: false, error: "Integração não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Descriptografa tokens criptografados em repouso
    if (integ.bearer_token && integ.bearer_token.startsWith("enc:")) {
      const { data: dec } = await admin.rpc("decrypt_secret", { _ciphertext: integ.bearer_token });
      if (typeof dec === "string") integ.bearer_token = dec;
    }
    if (integ.license_code && integ.license_code.startsWith("enc:")) {
      const { data: dec } = await admin.rpc("decrypt_secret", { _ciphertext: integ.license_code });
      if (typeof dec === "string") integ.license_code = dec;
    }

    function normalize(v: string | null): string {
      const raw = (v ?? "").trim();
      const onlyDigits = raw.replace(/\D/g, "");
      const isCnpj = !/[a-zA-Z]/.test(raw) && onlyDigits.length === 14;
      return isCnpj ? onlyDigits : raw;
    }

    // Receber: usa código de licença se disponível, senão CNPJ
    const empresaReceber = normalize(integ.license_code || integ.cnpj);
    // Vendas: sempre CNPJ
    const cnpjVendas = normalize(integ.cnpj);

    // Janela curta: últimos 7 dias
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 7);

    const results: any[] = [];

    // Teste 1: Contas a Receber
    const urlReceber = `${SSOTICA_BASE}/financeiro/contas-a-receber/periodo?empresa=${encodeURIComponent(empresaReceber)}&inicio_periodo=${ymd(start)}&fim_periodo=${ymd(today)}&page=1&perPage=1`;
    try {
      const res = await fetch(urlReceber, {
        headers: { Authorization: `Bearer ${integ.bearer_token}`, Accept: "application/json" },
      });
      results.push({
        endpoint: "contas-a-receber",
        status: res.status,
        ok: res.ok,
      });
    } catch (e) {
      console.error("[ssotica-test-connection] contas-a-receber:", e);
      results.push({ endpoint: "contas-a-receber", status: 0, ok: false });
    }

    // Teste 2: Vendas (usa cnpj= e exige CNPJ puro)
    const urlVendas = `${SSOTICA_BASE}/vendas/periodo?cnpj=${encodeURIComponent(cnpjVendas)}&inicio_periodo=${ymd(start)}&fim_periodo=${ymd(today)}`;
    try {
      const res = await fetch(urlVendas, {
        headers: { Authorization: `Bearer ${integ.bearer_token}`, Accept: "application/json" },
      });
      results.push({
        endpoint: "vendas",
        status: res.status,
        ok: res.ok,
      });
    } catch (e) {
      console.error("[ssotica-test-connection] vendas:", e);
      results.push({ endpoint: "vendas", status: 0, ok: false });
    }

    const allOk = results.every((r) => r.ok);
    return new Response(
      JSON.stringify({ ok: allOk, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[ssotica-test-connection] erro interno:", e);
    return new Response(JSON.stringify({ ok: false, error: "Erro ao testar conexão" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
