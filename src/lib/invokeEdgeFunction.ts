import type { FunctionInvokeOptions } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Margem antes de expirar para renovar o JWT (segundos). */
const REFRESH_MARGIN_SEC = 120;

export async function getFreshAccessToken(): Promise<string> {
  let { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData?.session?.access_token;
  const expiresAt = sessionData?.session?.expires_at;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!token || (expiresAt != null && expiresAt - nowSec < REFRESH_MARGIN_SEC)) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error && !token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    token = refreshed?.session?.access_token ?? token;
  }
  if (!token) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  return token;
}

export async function parseInvokeError(
  data: unknown,
  error: { message?: string; context?: { json?: () => Promise<unknown> } } | null,
): Promise<string> {
  const fromData = (data as { error?: string; detail?: string; msg?: string } | null);
  if (fromData?.error) return fromData.error;
  if (fromData?.detail) return fromData.detail;
  if (fromData?.msg) return fromData.msg;
  if (error?.context?.json) {
    try {
      const body = (await error.context.json()) as {
        error?: string;
        detail?: string;
        msg?: string;
        message?: string;
      };
      if (body?.error) return body.error;
      if (body?.detail) return body.detail;
      if (body?.msg) return body.msg;
      if (body?.message) return body.message;
    } catch {
      /* ignore */
    }
  }
  const msg = error?.message || "Erro desconhecido";
  if (msg.includes("non-2xx")) {
    return "Sessão expirada ou sem permissão. Atualize a página e tente de novo.";
  }
  return msg;
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options?: FunctionInvokeOptions,
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const token = await getFreshAccessToken();
    const { data, error } = await supabase.functions.invoke(functionName, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (error) {
      const message = await parseInvokeError(data, error);
      return { data: data as T | null, error: new Error(message) };
    }
    return { data: data as T | null, error: null };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { data: null, error: err };
  }
}
