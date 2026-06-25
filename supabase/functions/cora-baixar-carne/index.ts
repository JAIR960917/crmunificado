// Edge Function: cora-baixar-carne
// Recebe uma lista de pdf_urls (boletos individuais da Cora) e retorna
// um único PDF (carnê) com todos mesclados, no layout/modelo original da Cora.

import { PDFDocument } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const pdfUrls: string[] = Array.isArray(body?.pdf_urls) ? body.pdf_urls.filter(Boolean) : [];
    const filename: string = typeof body?.filename === "string" && body.filename ? body.filename : "carne.pdf";

    if (pdfUrls.length === 0) {
      return json({ ok: false, error: "Nenhum pdf_url informado" }, 400);
    }

    const merged = await PDFDocument.create();
    const failed: { url: string; error: string }[] = [];

    for (const url of pdfUrls) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          failed.push({ url, error: `HTTP ${resp.status}` });
          continue;
        }
        const buf = await resp.arrayBuffer();
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } catch (e) {
        failed.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (merged.getPageCount() === 0) {
      return json({
        ok: false,
        error: "Não foi possível baixar nenhum PDF da Cora. Os links podem ter expirado.",
        failed,
      }, 502);
    }

    const bytes = await merged.save();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Failed-Count": String(failed.length),
      },
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
