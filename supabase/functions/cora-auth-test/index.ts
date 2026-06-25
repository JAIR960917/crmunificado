// Edge Function: cora-auth-test
// Testa autenticação mTLS + OAuth2 (client_credentials) com a API da Cora.
// Retorna sucesso/erro e metadados do token (sem expor o access_token completo).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CORA_TOKEN_URL = "https://matls-clients.api.cora.com.br/token";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth do usuário (apenas usuários logados podem testar)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Carrega secrets
    const clientId = Deno.env.get("CORA_CLIENT_ID");
    const certPem = Deno.env.get("CORA_CERTIFICATE");
    const keyPem = Deno.env.get("CORA_PRIVATE_KEY");

    const missing: string[] = [];
    if (!clientId) missing.push("CORA_CLIENT_ID");
    if (!certPem) missing.push("CORA_CERTIFICATE");
    if (!keyPem) missing.push("CORA_PRIVATE_KEY");
    if (missing.length) {
      return json(
        { ok: false, error: `Secrets ausentes: ${missing.join(", ")}` },
        400,
      );
    }

    // Tenta aceitar PEM em vários formatos comuns:
    // - com quebras reais
    // - com "\\n" literal
    // - string JSON escapada
    // - conteúdo base64 do arquivo PEM
    const buildPemCandidates = (raw: string, kind: "cert" | "key") => {
      const out = new Set<string>();

      const add = (value: string | null | undefined) => {
        if (!value) return;
        let s = value.trim();
        if (!s) return;
        s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        s = s.replace(/\n{3,}/g, "\n\n");
        if (!s.endsWith("\n")) s += "\n";
        out.add(s);
      };

      add(raw);
      add(raw.replace(/\\n/g, "\n").replace(/\\r/g, ""));

      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") add(parsed);
      } catch {
        // ignore
      }

      const unquoted = raw.replace(/^['"]|['"]$/g, "");
      if (unquoted !== raw) add(unquoted);

      const normalizedLiteral = unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "");
      if (normalizedLiteral !== raw) add(normalizedLiteral);

      if (!/BEGIN [A-Z ]+/.test(raw)) {
        try {
          const decoded = atob(raw.replace(/\s+/g, ""));
          if (/BEGIN [A-Z ]+/.test(decoded)) add(decoded);
        } catch {
          // ignore
        }
      }

      const label = kind === "cert" ? "CERTIFICATE" : "(?:RSA |EC |)PRIVATE KEY";
      const inlineMatch = normalizedLiteral.match(
        new RegExp(`-----BEGIN ${label}-----\\s*([A-Za-z0-9+/=\\s]+?)\\s*-----END ${label}-----`, "m"),
      );
      if (inlineMatch) {
        const body = inlineMatch[1].replace(/\s+/g, "\n");
        const begin = kind === "cert" ? "-----BEGIN CERTIFICATE-----" : normalizedLiteral.match(/-----BEGIN ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----BEGIN PRIVATE KEY-----";
        const end = kind === "cert" ? "-----END CERTIFICATE-----" : normalizedLiteral.match(/-----END ([A-Z ]+PRIVATE KEY)-----/)?.[0] ?? "-----END PRIVATE KEY-----";
        add(`${begin}\n${body}\n${end}\n`);
      }

      return [...out];
    };

    const certCandidates = buildPemCandidates(certPem!, "cert");
    const keyCandidates = buildPemCandidates(keyPem!, "key");

    const certLooksLikeKey = /BEGIN [A-Z ]*PRIVATE KEY/.test(certPem!);
    const keyLooksLikeCert = /BEGIN CERTIFICATE/.test(keyPem!);

    let client: Deno.HttpClient | null = null;
    let lastError = "";

    const tryCreateClient = (cert: string, key: string) => {
      try {
        return Deno.createHttpClient({ cert, key });
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        return null;
      }
    };

    for (const cert of certCandidates) {
      for (const key of keyCandidates) {
        client = tryCreateClient(cert, key);
        if (client) break;
      }
      if (client) break;
    }

    if (!client && certLooksLikeKey && keyLooksLikeCert) {
      for (const cert of keyCandidates) {
        for (const key of certCandidates) {
          client = tryCreateClient(cert, key);
          if (client) break;
        }
        if (client) break;
      }
    }

    if (!client) {
      return json(
        {
          ok: false,
          error: `Falha ao carregar certificado/chave: ${lastError || "Unable to decode certificate"}`,
          hint: certLooksLikeKey && keyLooksLikeCert
            ? "Os secrets parecem invertidos: CORA_CERTIFICATE contém uma private key e CORA_PRIVATE_KEY contém um certificate."
            : "Os secrets não estão em PEM válido. Cole o conteúdo exato dos arquivos certificate.pem e private-key.key, incluindo BEGIN/END.",
          cert_candidates: certCandidates.length,
          key_candidates: keyCandidates.length,
          cert_first_line: certCandidates[0]?.split("\n")[0] ?? null,
          key_first_line: keyCandidates[0]?.split("\n")[0] ?? null,
        },
        200,
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId!,
    });

    const started = Date.now();
    const resp = await fetch(CORA_TOKEN_URL, {
      method: "POST",
      // @ts-ignore - client é suportado pelo Deno runtime
      client,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const elapsedMs = Date.now() - started;

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      // resposta não-JSON
    }

    if (!resp.ok) {
      console.error("Cora auth failed", {
        status: resp.status,
        body: text.slice(0, 500),
      });
      return json(
        {
          ok: false,
          status: resp.status,
          elapsed_ms: elapsedMs,
          error:
            parsed?.error_description ||
            parsed?.error ||
            text.slice(0, 300) ||
            "Falha na autenticação com a Cora",
          raw: parsed,
        },
        200,
      );
    }

    const accessToken: string | undefined = parsed?.access_token;
    const expiresIn: number | undefined = parsed?.expires_in;
    const tokenType: string | undefined = parsed?.token_type;
    const scope: string | undefined = parsed?.scope;

    // Mascarar token
    const masked = accessToken
      ? `${accessToken.slice(0, 6)}...${accessToken.slice(-6)} (${accessToken.length} chars)`
      : null;

    return json({
      ok: true,
      message: "Autenticação com a Cora bem-sucedida! ✅",
      elapsed_ms: elapsedMs,
      token_type: tokenType,
      expires_in: expiresIn,
      scope,
      access_token_preview: masked,
    });
  } catch (err) {
    console.error("cora-auth-test error", err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
