import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
}

interface ContratoExistente {
  envelope_id: string;
}

interface ArquivoImportado {
  name: string;
  path: string;
  mimeType: string;
  kind: "pdf" | "image" | "other";
}

function extractFolderId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  const m1 = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

function nomeDoArquivo(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim() || filename;
}

function parseFolderName(name: string): { cpf: string | null; nome: string | null } {
  const parts = name.split("_");
  if (parts.length < 2) return { cpf: null, nome: name.replace(/_/g, " ") };

  let cpf: string | null = null;
  let startIdx = 0;
  const first = parts[0].replace(/\D/g, "");
  if (/^\d{11}$/.test(first)) {
    cpf = first;
    startIdx = 1;
  }

  let endIdx = parts.length;
  const last = parts[parts.length - 1];
  if (/^\d{10,}$/.test(last)) endIdx = parts.length - 1;

  const nomeParts = parts.slice(startIdx, endIdx);
  const nome = nomeParts.length ? nomeParts.join(" ").replace(/\s+/g, " ").trim() : null;
  return { cpf, nome };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, "_") || "arquivo";
}

function fileKind(mimeType: string | undefined, name: string): ArquivoImportado["kind"] {
  if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mimeType?.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(name)) return "image";
  return "other";
}

function contentTypeFor(mimeType: string | undefined, name: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "application/octet-stream";
}

function maxSizeFor(kind: ArquivoImportado["kind"]): number {
  if (kind === "pdf") return 15 * 1024 * 1024;
  if (kind === "image") return 10 * 1024 * 1024;
  return 5 * 1024 * 1024;
}

// ============ Service Account JWT auth ============
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let cachedToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60_000) return cachedToken.token;
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurado");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OAuth token error: ${JSON.stringify(j)}`);
  cachedToken = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function driveFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  return fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function listDriveItems(query: string, pageToken?: string, pageSize = 25) {
  const q = encodeURIComponent(query);
  const fields = encodeURIComponent("nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime)");
  const url = `/files?q=${q}&fields=${fields}&pageSize=${pageSize}&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`;
  const r = await driveFetch(url);
  const txt = await r.text();
  if (!r.ok) throw new Error(`Drive list ${r.status}: ${txt.substring(0, 300)}`);
  const data = JSON.parse(txt);
  return { files: (data.files ?? []) as DriveFile[], nextPageToken: data.nextPageToken as string | undefined };
}

async function downloadDriveFile(fileId: string): Promise<Uint8Array> {
  const dl = await driveFetch(`/files/${fileId}?alt=media&supportsAllDrives=true`);
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  return new Uint8Array(await dl.arrayBuffer());
}

async function importarArquivo(
  supa: ReturnType<typeof createClient>,
  folderId: string,
  file: DriveFile,
): Promise<ArquivoImportado> {
  const name = file.name ?? file.id;
  const kind = fileKind(file.mimeType, name);
  const maxSize = maxSizeFor(kind);
  if (Number(file.size ?? 0) > maxSize) throw new Error(`${name} maior que ${Math.round(maxSize / 1024 / 1024)}MB`);

  const buf = await downloadDriveFile(file.id);
  const safeName = sanitizeFilename(name);
  const path = `gdrive/${folderId}/${safeName}`;
  const contentType = contentTypeFor(file.mimeType, name);
  const up = await supa.storage
    .from("contratos-assertiva")
    .upload(path, buf, { contentType, upsert: true });
  if (up.error) throw new Error(up.error.message);

  return { name, path, mimeType: contentType, kind };
}

async function importarPasta(
  supa: ReturnType<typeof createClient>,
  folder: DriveFile,
): Promise<{ status: "ok" | "erro" | "ignorado"; error?: string }> {
  const folderId = folder.id;
  const folderName = folder.name ?? folderId;
  const envelopeId = `gdrive:folder:${folderId}`;

  const { data: existing } = await supa
    .from("crediario_contratos_assertiva")
    .select("envelope_id")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (existing) return { status: "ignorado" };

  const childQuery = `'${folderId}' in parents and trashed=false and (mimeType='application/pdf' or mimeType contains 'image/')`;
  const childItems: DriveFile[] = [];
  let childToken: string | undefined;
  do {
    const { files, nextPageToken } = await listDriveItems(childQuery, childToken, 50);
    childItems.push(...files);
    childToken = nextPageToken;
  } while (childToken);

  if (!childItems.length) throw new Error("pasta vazia (sem PDF ou imagens)");

  const arquivos: ArquivoImportado[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < childItems.length; i += CONCURRENCY) {
    const chunk = childItems.slice(i, i + CONCURRENCY);
    const batch = await Promise.all(chunk.map((file) => importarArquivo(supa, folderId, file)));
    arquivos.push(...batch);
  }

  const pdf = arquivos.find((a) => a.kind === "pdf");
  const parsed = parseFolderName(folderName);
  let cpf = parsed.cpf;
  let nome = parsed.nome;

  if (!cpf && pdf) {
    const m = pdf.name.match(/(\d{11})/);
    if (m) cpf = m[1];
  }
  if (!nome && pdf) nome = nomeDoArquivo(pdf.name);

  const { error: insertError } = await supa.from("crediario_contratos_assertiva").insert({
    envelope_id: envelopeId,
    nome,
    cpf,
    status: "gdrive_pasta",
    data_assinatura: folder.modifiedTime ?? folder.createdTime ?? null,
    pdf_path: pdf?.path ?? null,
    raw: {
      source: "gdrive_folder",
      folder_id: folderId,
      folder_name: folderName,
      arquivos,
    },
  });
  if (insertError) throw new Error(`Banco insert: ${insertError.message}`);

  return { status: "ok" };
}

async function importarPdfFlat(
  supa: ReturnType<typeof createClient>,
  file: DriveFile,
): Promise<{ status: "ok" | "erro" | "ignorado"; error?: string }> {
  const envelopeId = `gdrive:${file.id}`;
  const { data: existing } = await supa
    .from("crediario_contratos_assertiva")
    .select("envelope_id")
    .eq("envelope_id", envelopeId)
    .maybeSingle();
  if (existing) return { status: "ignorado" };

  const nome = nomeDoArquivo(file.name ?? "");
  if (Number(file.size ?? 0) > 15 * 1024 * 1024) throw new Error("PDF maior que 15MB");

  const buf = await downloadDriveFile(file.id);
  const path = `gdrive/${file.id}.pdf`;
  const up = await supa.storage
    .from("contratos-assertiva")
    .upload(path, buf, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);

  const { error: insertError } = await supa.from("crediario_contratos_assertiva").insert({
    envelope_id: envelopeId,
    nome,
    cpf: null,
    status: "gdrive",
    data_assinatura: file.modifiedTime ?? file.createdTime ?? null,
    pdf_path: path,
    raw: { source: "gdrive", file },
  });
  if (insertError) throw new Error(`Banco insert: ${insertError.message}`);

  return { status: "ok" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const folderId = extractFolderId(String(body.folder ?? ""));
    if (!folderId) throw new Error("Informe a URL ou ID da pasta do Google Drive");
    const pageToken: string | undefined = body.pageToken || undefined;
    const maxFiles: number = Math.min(Math.max(Number(body.maxFiles) || 5, 1), 10);
    const mode: "pastas" | "pdfs" = body.mode === "pdfs" ? "pdfs" : "pastas";

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let importados = 0, ignorados = 0;
    const arquivos: { name: string; status: "ok" | "erro" | "ignorado"; error?: string }[] = [];
    const erros: string[] = [];
    const startedAt = Date.now();
    const TIME_BUDGET_MS = Number(Deno.env.get("GDRIVE_IMPORT_TIME_BUDGET_MS")) || 28_000;
    const MAX_PAGES_PER_REQUEST = 20;

    let fetchToken: string | undefined = pageToken;
    let returnToken: string | null = pageToken ?? null;
    let processed = 0;
    let pagesScanned = 0;
    let done = false;
    let itensEncontrados = 0;

    const listQuery = mode === "pastas"
      ? `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;

    outer: while (true) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const pageFetchToken = fetchToken;
      const { files, nextPageToken: afterPageToken } = await listDriveItems(listQuery, pageFetchToken, 50);
      pagesScanned++;
      itensEncontrados += files.length;

      if (mode === "pastas") {
        const envelopeIds = files.map((f) => `gdrive:folder:${f.id}`);
        const { data: existentes, error: existentesError } = envelopeIds.length
          ? await supa.from("crediario_contratos_assertiva").select("envelope_id").in("envelope_id", envelopeIds)
          : { data: [], error: null };
        if (existentesError) throw new Error(`Banco select: ${existentesError.message}`);
        const jaTem = new Set(((existentes ?? []) as ContratoExistente[]).map((e) => e.envelope_id));

        for (const folder of files) {
          if (Date.now() - startedAt > TIME_BUDGET_MS || processed >= maxFiles) {
            returnToken = pageFetchToken ?? null;
            break outer;
          }
          const label = folder.name ?? folder.id;
          const envelopeId = `gdrive:folder:${folder.id}`;
          if (jaTem.has(envelopeId)) {
            ignorados++;
            arquivos.push({ name: label, status: "ignorado" });
            continue;
          }
          try {
            const result = await importarPasta(supa, folder);
            if (result.status === "ok") { importados++; processed++; }
            else if (result.status === "ignorado") ignorados++;
            arquivos.push({ name: label, status: result.status, error: result.error });
          } catch (e) {
            const msg = (e as Error).message;
            console.warn("gdrive-importar-contratos folder error", label, msg);
            erros.push(`${label}: ${msg}`);
            arquivos.push({ name: label, status: "erro", error: msg });
          }
        }
      } else {
        const ids = files.map((f) => `gdrive:${f.id}`);
        const { data: existentes, error: existentesError } = ids.length
          ? await supa.from("crediario_contratos_assertiva").select("envelope_id").in("envelope_id", ids)
          : { data: [], error: null };
        if (existentesError) throw new Error(`Banco select: ${existentesError.message}`);
        const jaTem = new Set(((existentes ?? []) as ContratoExistente[]).map((e) => e.envelope_id));

        const pendentes = files.filter((f) => {
          if (jaTem.has(`gdrive:${f.id}`)) {
            ignorados++;
            arquivos.push({ name: f.name ?? f.id, status: "ignorado" });
            return false;
          }
          return true;
        });

        const CONCURRENCY = 3;
        for (let i = 0; i < pendentes.length; i += CONCURRENCY) {
          if (processed >= maxFiles || Date.now() - startedAt > TIME_BUDGET_MS) {
            returnToken = pageFetchToken ?? null;
            break outer;
          }
          const chunk = pendentes.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map(async (f) => {
            try {
              const result = await importarPdfFlat(supa, f);
              if (result.status === "ok") { importados++; processed++; }
              arquivos.push({ name: f.name ?? f.id, status: result.status, error: result.error });
            } catch (e) {
              const msg = (e as Error).message;
              erros.push(`${f.name}: ${msg}`);
              arquivos.push({ name: f.name ?? f.id, status: "erro", error: msg });
            }
          }));
        }
      }

      if (!afterPageToken) {
        done = true;
        returnToken = null;
        break;
      }

      fetchToken = afterPageToken;
      returnToken = afterPageToken;

      if (processed >= maxFiles) break;
      if (pagesScanned >= MAX_PAGES_PER_REQUEST && processed === 0) break;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        importados,
        ignorados,
        arquivos,
        erros: erros.slice(0, 20),
        nextPageToken: done ? null : returnToken,
        done,
        mode,
        itensEncontrados,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("gdrive-importar-contratos error", (e as Error).message, (e as Error).stack);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
