import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { path, filename: requested, mode } = await req.json();
    if (!path) throw new Error("path obrigatório");
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const fallback = path.split("/").pop() ?? "contrato.pdf";
    const filename = String(requested || fallback).replace(/[^\w.-]/g, "_");
    const normalizeSignedUrl = (signedUrl: string) => {
      const publicBase = Deno.env.get("SUPABASE_URL");
      if (!publicBase) return signedUrl;
      try {
        const publicOrigin = new URL(publicBase).origin;
        const url = new URL(signedUrl, publicOrigin);
        return `${publicOrigin}${url.pathname}${url.search}${url.hash}`;
      } catch {
        return signedUrl;
      }
    };

    if (mode === "view") {
      const { data, error } = await supa.storage
        .from("contratos-assertiva")
        .createSignedUrl(path, 60 * 10);
      if (error) throw error;
      return new Response(
        JSON.stringify({ ok: true, signed_url: normalizeSignedUrl(data.signedUrl), filename, mode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // mode === "download": signed URL com download forçado e nome correto
    const { data, error } = await supa.storage
      .from("contratos-assertiva")
      .createSignedUrl(path, 60 * 10, { download: filename });
    if (error) throw error;
    return new Response(
      JSON.stringify({ ok: true, signed_url: normalizeSignedUrl(data.signedUrl), filename, mode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
