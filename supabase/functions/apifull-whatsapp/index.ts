import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFULL_BASE = "https://api.apifull.com.br/whatsapp";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const APIFULL_API_KEY = Deno.env.get("APIFULL_API_KEY");
    if (!APIFULL_API_KEY) throw new Error("APIFULL_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user is authenticated and is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check admin role
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isAdmin = (roleRows || []).some((row) => row.role === "admin");

    if (roleError || !isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas administradores podem gerenciar instâncias" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, session, name, webhook } = await req.json();

    const headers = {
      "Authorization": `Bearer ${APIFULL_API_KEY}`,
      "Content-Type": "application/json",
    };

    let endpoint = "";
    let method = "POST";
    let body: any = undefined;

    switch (action) {
      case "create-instance":
        endpoint = "/create-instance";
        body = JSON.stringify({ name, webhook: webhook || "" });
        break;

      case "reset-instance":
        endpoint = "/reset-instance";
        body = JSON.stringify({ session });
        break;

      case "restart-session":
        endpoint = "/restart-session";
        body = JSON.stringify({ session });
        break;

      case "qrcode":
        endpoint = "/qrcode-instance";
        body = JSON.stringify({ session });
        break;

      case "status":
        endpoint = "/status-session";
        body = JSON.stringify({ session });
        break;

      case "list-instances":
        endpoint = "/list-instances";
        method = "GET";
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Ação desconhecida: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const fetchOpts: RequestInit = { method, headers };
    if (method === "POST" && body) fetchOpts.body = body;

    const url = `${APIFULL_BASE}${endpoint}`;
    console.log(`[apifull] -> ${method} ${url}`, body ? `body=${body}` : "");

    const controller = new AbortController();
    const timeoutMs = 25000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetchOpts.signal = controller.signal;

    const t0 = Date.now();
    let response: Response;
    try {
      response = await fetch(url, fetchOpts);
    } catch (e: any) {
      clearTimeout(timeoutId);
      const ms = Date.now() - t0;
      const aborted = e?.name === "AbortError";
      console.error(`[apifull] FAIL ${action} after ${ms}ms (aborted=${aborted}):`, e?.message || e);
      return new Response(
        JSON.stringify({
          error: aborted
            ? `Timeout: API Full não respondeu em ${timeoutMs}ms`
            : `Falha de rede ao chamar API Full: ${e?.message || e}`,
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    clearTimeout(timeoutId);
    const ms = Date.now() - t0;

    const responseText = await response.text();
    console.log(`[apifull] <- ${response.status} ${action} (${ms}ms) bytes=${responseText.length}`);

    let result: any;
    try {
      result = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        console.error(`[apifull] non-JSON error body:`, responseText.slice(0, 500));
        return new Response(
          JSON.stringify({ error: responseText || `HTTP ${response.status}` }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      result = { message: responseText };
    }

    if (!response.ok) {
      console.error(`[apifull] error ${response.status} ${action}:`, result);
      return new Response(
        JSON.stringify({ error: result.message || result.error || `HTTP ${response.status}`, details: result }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("apifull-whatsapp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
