import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalCorsHeaders } from "../_shared/internalAuth.ts";

const corsHeaders = internalCorsHeaders;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const [{ data: links }, { data: settingsRows }] = await Promise.all([
    supabase
      .from("company_links")
      .select("id, label, url, icon, color, link_type")
      .eq("active", true)
      .order("position", { ascending: true }),
    supabase
      .from("system_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["system_name", "logo_url", "links_logo_url", "links_bg_color", "links_card_color", "links_meta_pixel_id", "links_whatsapp_channel_url"]),
  ]);

  const settingsMap = new Map((settingsRows || []).map((r) => [r.setting_key, r.setting_value || ""]));

  return jsonResponse({
    system_name: settingsMap.get("system_name") || "Óticas Joonker",
    logo_url: settingsMap.get("links_logo_url") || settingsMap.get("logo_url") || "",
    bg_color: settingsMap.get("links_bg_color") || "",
    card_color: settingsMap.get("links_card_color") || "",
    meta_pixel_id: settingsMap.get("links_meta_pixel_id") || "",
    whatsapp_channel_url: settingsMap.get("links_whatsapp_channel_url") || "",
    links: links || [],
  });
});
