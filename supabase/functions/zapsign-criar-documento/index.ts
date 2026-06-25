// Edge Function: zapsign-criar-documento
// Cria um documento na ZapSign a partir do contrato (gera PDF e envia em base64).
// Body: { contrato_id; comprovante_storage_path? (recomendado no celular); comprovante_base64? (legado) }
//
// Salva em contracts:
//   signature_provider = "zapsign"
//   signature_external_id = doc.token
//   signature_url = signers[0].sign_url
//   signature_data = { doc_token, open_id, signer_token, original_file, signed_file?, ... }
//   status = "aguardando_assinatura"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

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

const COMPROVANTE_BUCKET = "comprovantes-assinatura";

interface BodyInput {
  contrato_id: string;
  comprovante_storage_path?: string | null;
  comprovante_base64?: string | null;
  comprovante_filename?: string | null;
  comprovante_mime?: string | null;
  signer_phone_country?: string | null;
  signer_phone_number?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = (await req.json().catch(() => ({}))) as Partial<BodyInput>;
    if (!body.contrato_id) return json({ ok: false, error: "contrato_id obrigatório" }, 400);

    const apiToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!apiToken) return json({ ok: false, error: "ZAPSIGN_API_TOKEN não configurado" }, 500);

    // ---------- Carrega contrato ----------
    const { data: contrato, error: contratoErr } = await admin
      .from("crediario_contracts")
      .select("id, user_id, nome, cpf, content, company_id, venda_id, status")
      .eq("id", body.contrato_id)
      .maybeSingle();
    if (contratoErr || !contrato) return json({ ok: false, error: "Contrato não encontrado" }, 404);

    if (contrato.user_id !== userId) {
      const { data: roleRow } = await admin
        .from("user_roles").select("role")
        .eq("user_id", userId).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ ok: false, error: "Sem permissão" }, 403);
    }

    // ---------- Carrega venda + empresa + template ----------
    let vendaInfo: {
      valor_total: number;
      valor_entrada: number;
      valor_financiado: number;
      valor_parcela: number;
      parcelas: number;
      taxa_juros: number;
      primeiro_vencimento: string | null;
    } | null = null;
    if (contrato.venda_id) {
      const { data: v } = await admin
        .from("crediario_vendas")
        .select("valor_total, valor_entrada, valor_financiado, valor_parcela, parcelas, taxa_juros, primeiro_vencimento, aprovacao_admin")
        .eq("id", contrato.venda_id)
        .maybeSingle();
      if (v) {
        if (v.aprovacao_admin === "pendente") {
          return json({ ok: false, error: "Venda aguardando autorização do administrador (entrada abaixo do mínimo)" }, 403);
        }
        if (v.aprovacao_admin === "rejeitada") {
          return json({ ok: false, error: "Venda rejeitada pelo administrador" }, 403);
        }
        vendaInfo = {
          valor_total: Number(v.valor_total),
          valor_entrada: Number(v.valor_entrada),
          valor_financiado: Number(v.valor_financiado),
          valor_parcela: Number(v.valor_parcela),
          parcelas: Number(v.parcelas),
          taxa_juros: Number(v.taxa_juros),
          primeiro_vencimento: v.primeiro_vencimento,
        };
      }
    }
    let empresaInfo: { nome: string; cnpj: string; endereco: string } | null = null;
    if (contrato.company_id) {
      const { data: e } = await admin
        .from("companies").select("name, cnpj, address")
        .eq("id", contrato.company_id).maybeSingle();
      if (e) empresaInfo = { nome: e.name, cnpj: e.cnpj ?? "", endereco: e.address ?? "" };
    }
    const { data: tpl } = await admin
      .from("crediario_contract_template")
      .select("title")
      .limit(1).maybeSingle();
    const tplTitle = tpl?.title || "Nota Promissória";

    let comprovante_base64 = body.comprovante_base64 ?? null;
    let comprovante_filename = body.comprovante_filename ?? null;
    let comprovante_mime = body.comprovante_mime ?? null;

    if (body.comprovante_storage_path) {
      const loaded = await loadComprovanteFromStorage(admin, body.comprovante_storage_path);
      if (!loaded) {
        return json({ ok: false, error: "Comprovante não encontrado. Envie o arquivo novamente." }, 400);
      }
      comprovante_base64 = loaded.base64;
      comprovante_filename = loaded.filename;
      comprovante_mime = loaded.mime;
      await admin.storage.from(COMPROVANTE_BUCKET).remove([body.comprovante_storage_path]).catch(() => {});
    }

    const comprovanteMerged = !!comprovante_base64;

    // ---------- Gera PDF dinâmico ----------
    const vencimentoFmt = vendaInfo?.primeiro_vencimento ? formatDateBR(vendaInfo.primeiro_vencimento) : null;
    const valorFmt = vendaInfo?.valor_total != null ? formatBRL(vendaInfo.valor_total) : null;
    const pdfDoc = buildPdf({
      title: tplTitle,
      content: contrato.content,
      vencimento: vencimentoFmt,
      valorTotal: valorFmt,
      numero: "Nº 1 DE 1",
    });

    // ---------- Anexa comprovante de residência (imagem) como página final ----------
    if (comprovante_base64 && comprovante_filename) {
      try {
        const mime = (comprovante_mime || "").toLowerCase();
        if (mime.startsWith("image/")) {
          const imgFmt = mime.includes("png") ? "PNG" : "JPEG";
          pdfDoc.addPage();
          const pageW = pdfDoc.internal.pageSize.getWidth();
          const pageH = pdfDoc.internal.pageSize.getHeight();
          const margin = 30;
          const maxW = pageW - margin * 2;
          const maxH = pageH - margin * 2 - 30;
          pdfDoc.setFont("helvetica", "bold");
          pdfDoc.setFontSize(12);
          pdfDoc.text("Comprovante de residência", pageW / 2, margin, { align: "center" });
          const dataUri = `data:${mime};base64,${comprovante_base64}`;
          const props = pdfDoc.getImageProperties(dataUri);
          const ratio = Math.min(maxW / props.width, maxH / props.height);
          const drawW = props.width * ratio;
          const drawH = props.height * ratio;
          const drawX = (pageW - drawW) / 2;
          const drawY = margin + 20 + (maxH - drawH) / 2;
          pdfDoc.addImage(dataUri, imgFmt, drawX, drawY, drawW, drawH, undefined, "FAST");
        } else if (mime !== "application/pdf") {
          console.warn("Comprovante com mime não suportado:", mime);
        }
      } catch (e) {
        console.error("Erro ao mesclar comprovante (imagem) no PDF:", e);
      }
    }

    let pdfBytes = new Uint8Array(pdfDoc.output("arraybuffer"));

    // Se o comprovante for PDF, mescla via pdf-lib
    if (comprovante_base64 && (comprovante_mime || "").toLowerCase() === "application/pdf") {
      try {
        const mainPdf = await PDFDocument.load(pdfBytes);
        const compBytes = base64ToBytes(comprovante_base64);
        const compPdf = await PDFDocument.load(compBytes);
        const copiedPages = await mainPdf.copyPages(compPdf, compPdf.getPageIndices());
        copiedPages.forEach((p) => mainPdf.addPage(p));
        pdfBytes = await mainPdf.save();
        console.info("Comprovante PDF mesclado com sucesso, páginas:", copiedPages.length);
      } catch (e) {
        console.error("Erro ao mesclar comprovante PDF via pdf-lib:", e);
      }
    }

    const pdfBase64 = bytesToBase64(pdfBytes);

    // ---------- Cria documento na ZapSign ----------
    const phoneCountry = onlyDigits(body.signer_phone_country) || "55";
    const phoneNumber = onlyDigits(body.signer_phone_number);
    if (!phoneNumber) {
      return json({ ok: false, error: "Telefone do signatário é obrigatório" }, 400);
    }

    const signerPayload = {
      name: contrato.nome,
      email: "",
      phone_country: phoneCountry,
      phone_number: phoneNumber,
      auth_mode: "assinaturaTela",
      signature_placement: "<<assinatura_emitente>>",
      send_automatic_email: false,
      send_automatic_whatsapp: false,
      send_automatic_whatsapp_signed_file: false,
      lock_name: true,
      lock_email: false,
      hide_email: true,
      blank_email: true,
      lock_phone: true,
      hide_phone: false,
      blank_phone: false,
      require_selfie_photo: true,
      require_document_photo: true,
      selfie_validation_type: "none",
      require_cpf: false,
      validate_cpf: false,
      cpf: "",
      qualification: "Emitente",
      external_id: contrato.id,
    };

    const docPayload: Record<string, unknown> = {
      name: `${tplTitle} - ${contrato.nome}`.slice(0, 250),
      base64_pdf: pdfBase64,
      external_id: contrato.id,
      lang: "pt-br",
      disable_signer_emails: true,
      allow_refuse_signature: false,
      has_simplified_signature: false,
      brand_logo: "",
      signers: [signerPayload],
    };

    const base = zapsignBase();
    const docResp = await fetch(`${base}/api/v1/docs/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(docPayload),
    });

    const docText = await docResp.text();
    const docJson = safeJson(docText);
    console.info("zapsign create doc status", docResp.status, "body", docText.slice(0, 1500));

    if (!docResp.ok) {
      const errMsg = docJson?.detail || docJson?.message ||
        (Array.isArray(docJson?.errors) ? JSON.stringify(docJson.errors) : null) ||
        `HTTP ${docResp.status}: ${docText.slice(0, 300)}`;
      return json({ ok: false, error: `ZapSign: ${errMsg}`, detail: docJson ?? docText.slice(0, 500) }, 502);
    }

    const docToken: string | null = docJson?.token ?? null;
    const openId: number | null = docJson?.open_id ?? null;
    const signer = Array.isArray(docJson?.signers) ? docJson.signers[0] : null;
    const signerToken: string | null = signer?.token ?? null;
    const signUrl: string | null = signer?.sign_url ?? null;

    if (!docToken || !signUrl) {
      return json({ ok: false, error: "ZapSign não retornou token/sign_url", detail: docJson }, 502);
    }

    await admin.from("crediario_contracts").update({
      signature_provider: "zapsign",
      signature_external_id: docToken,
      signature_url: signUrl,
      signature_data: {
        mode: "dynamic",
        doc_token: docToken,
        open_id: openId,
        signer_token: signerToken,
        original_file: docJson?.original_file ?? null,
        signed_file: docJson?.signed_file ?? null,
        env: (Deno.env.get("ZAPSIGN_ENV") || "sandbox"),
        raw: docJson,
        comprovante_merged: comprovanteMerged,
      },
      status: "aguardando_assinatura",
    }).eq("id", contrato.id);

    return json({
      ok: true,
      message: "Documento criado na ZapSign com sucesso",
      doc_token: docToken,
      open_id: openId,
      signer_token: signerToken,
      signature_url: signUrl,
      comprovante_merged: comprovanteMerged,
    });
  } catch (err) {
    console.error("zapsign-criar-documento error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function safeJson(text: string): any { try { return JSON.parse(text); } catch { return null; } }

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function onlyDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

async function loadComprovanteFromStorage(
  admin: ReturnType<typeof createClient>,
  path: string,
): Promise<{ base64: string; filename: string; mime: string } | null> {
  const { data, error } = await admin.storage.from(COMPROVANTE_BUCKET).download(path);
  if (error || !data) {
    console.error("comprovante storage download", path, error);
    return null;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const filename = path.split("/").pop() || "comprovante";
  const mime = data.type || guessMimeFromName(filename);
  return { base64: bytesToBase64(bytes), filename, mime };
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface PdfArgs {
  title: string;
  content: string;
  vencimento: string | null;
  valorTotal: string | null;
  numero: string;
}

function buildPdf(d: PdfArgs): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usableWidth = pageWidth - margin * 2;

  doc.setTextColor(0, 0, 0);
  const titleText = d.title.toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  const titleWidth = doc.getTextWidth(titleText);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const numWidth = doc.getTextWidth(d.numero);
  const gap = 8;
  const groupWidth = titleWidth + gap + numWidth;
  const groupStart = (pageWidth - groupWidth) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(titleText, groupStart, margin + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(d.numero, groupStart + titleWidth + gap, margin + 2);

  if (d.vencimento || d.valorTotal) {
    doc.setFontSize(9);
    const rightX = pageWidth - margin;
    let ry = margin - 4;
    if (d.vencimento) {
      doc.setFont("helvetica", "normal");
      doc.text(`Vencimento: `, rightX - doc.getTextWidth(d.vencimento) - 4, ry, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(d.vencimento, rightX, ry, { align: "right" });
      ry += 12;
    }
    if (d.valorTotal) {
      doc.setFont("helvetica", "normal");
      doc.text(`Valor: `, rightX - doc.getTextWidth(d.valorTotal) - 4, ry, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(d.valorTotal, rightX, ry, { align: "right" });
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  let y = margin + 50;
  const lineHeight = 16;

  for (const rawLine of d.content.split("\n")) {
    const paragraph = rawLine.trim();
    if (!paragraph) { y += 8; continue; }
    const lines = doc.splitTextToSize(paragraph, usableWidth);
    for (const line of lines) {
      if (y > pageHeight - margin - 120) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 6;
  }

  if (y > pageHeight - 140) { doc.addPage(); y = margin; }
  y += 50;
  const sigWidth = 280;
  const sigX = (pageWidth - sigWidth) / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.line(sigX, y, sigX + sigWidth, y);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(1);
  doc.text("<<assinatura_emitente>>", sigX, y - 2);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Assinatura do emitente", pageWidth / 2, y + 14, { align: "center" });

  return doc;
}
