// Watchdog para sincronizações SSÓtica travadas.
// Detecta integrações com sync_status='running' há mais de 2h,
// destrava (idle), marca log órfão como erro e notifica todos os admins.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STUCK_THRESHOLD_MINUTES = 120; // 2 horas

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(
      Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000,
    ).toISOString();

    // Busca integrações em running há mais de 2h (updated_at antigo)
    const { data: stuck, error: stuckErr } = await supabase
      .from("ssotica_integrations")
      .select("id, company_id, updated_at")
      .eq("sync_status", "running")
      .lt("updated_at", cutoff);

    if (stuckErr) throw stuckErr;

    if (!stuck || stuck.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, stuck: 0, message: "Nenhuma sync travada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Carrega nomes das empresas
    const companyIds = [...new Set(stuck.map((s) => s.company_id))];
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    const companyName = (id: string) =>
      companies?.find((c) => c.id === id)?.name || "Empresa desconhecida";

    // Busca admins para notificar
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (admins || []).map((a) => a.user_id);

    const results: Array<{ id: string; company: string; minutes: number }> = [];

    for (const integ of stuck) {
      const minutesStuck = Math.round(
        (Date.now() - new Date(integ.updated_at).getTime()) / 60000,
      );
      const cName = companyName(integ.company_id);

      // 1) Destrava o status da integração
      await supabase
        .from("ssotica_integrations")
        .update({ sync_status: "idle", updated_at: new Date().toISOString() })
        .eq("id", integ.id)
        .eq("sync_status", "running");

      // 2) Encerra logs órfãos
      await supabase
        .from("ssotica_sync_logs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: `Watchdog: execução travada há ${minutesStuck} min — destravada automaticamente`,
        })
        .eq("integration_id", integ.id)
        .eq("status", "running")
        .is("finished_at", null);

      // 3) Cria notificação in-app para cada admin
      if (adminIds.length > 0) {
        const notifications = adminIds.map((uid) => ({
          user_id: uid,
          title: "Sincronização SSÓtica destravada",
          message: `A loja "${cName}" estava travada há ${minutesStuck} min e foi destravada automaticamente.`,
        }));
        await supabase.from("notifications").insert(notifications);
      }

      results.push({
        id: integ.id,
        company: cName,
        minutes: minutesStuck,
      });
    }

    return new Response(
      JSON.stringify({ ok: true, stuck: results.length, details: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("watchdog error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
