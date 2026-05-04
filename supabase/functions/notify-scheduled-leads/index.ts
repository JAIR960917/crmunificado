import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Protege o endpoint: só aceita chamadas do cron (via Authorization header com service role)
  // ou chamadas internas com o header x-cron-secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

  if (!isServiceRole && (!cronSecret || providedSecret !== cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey
  );
