/**
 * Tool do agente de IA (n8n): consulta agendamentos existentes no CRM
 * (tabela crm_appointments) pelo telefone e/ou nome do cliente — usado
 * quando o cliente pergunta "qual a data do meu agendamento?".
 *
 * Autenticação: mesmo esquema das outras tools — header `x-ai-agent-secret`
 * deve bater com whatsapp_instances.ai_webhook_secret da instância da
 * conversa.
 *
 * Body esperado:
 *   { conversation_id, telefone?: string, nome?: string }
 * Se `telefone` não vier, usa o próprio número da conversa do WhatsApp.
 *
 * Sempre responde HTTP 200 com { ok: boolean, message: string, appointments }
 * para o agente conseguir reformular a resposta pro cliente.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ai-agent-secret",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

/**
 * Formata em horário de Brasília explicitamente — o runtime do Deno roda em
 * UTC, então usar d.getHours()/d.getDate() direto retornaria o horário UTC
 * (3h adiantado), não o horário real da loja.
 */
function formatDateTimeBR(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const { conversation_id, telefone, nome } = body as {
      conversation_id?: string;
      telefone?: string;
      nome?: string;
    };

    if (!conversation_id?.trim()) return jsonResponse({ ok: false, message: "conversation_id é obrigatório" }, 400);

    const { data: conv, error: convErr } = await admin
      .from("whatsapp_conversations")
      .select("id, instance_id, wa_id")
      .eq("id", conversation_id.trim())
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) return jsonResponse({ ok: false, message: "Conversa não encontrada" }, 404);

    const { data: instance, error: instErr } = await admin
      .from("whatsapp_instances")
      .select("id, ai_enabled, ai_webhook_secret")
      .eq("id", conv.instance_id)
      .maybeSingle();
    if (instErr) throw instErr;

    const secretHeader = req.headers.get("x-ai-agent-secret") || "";
    if (!instance?.ai_webhook_secret || secretHeader !== instance.ai_webhook_secret) {
      return jsonResponse({ ok: false, message: "Não autorizado" }, 401);
    }
    if (!instance.ai_enabled) {
      return jsonResponse({ ok: false, message: "IA desabilitada para este número" }, 409);
    }

    const digits = onlyDigits(telefone) || onlyDigits(conv.wa_id);
    if (digits.length < 8) {
      return jsonResponse({
        ok: false,
        message: "Não consegui identificar o telefone do cliente. Peça pra ele confirmar o telefone usado no agendamento.",
      }, 200);
    }
    // Compara só os últimos 8 dígitos: tolera diferenças de DDI (55) e o "9" extra do celular.
    const tail = digits.slice(-8);

    let query = admin
      .from("crm_appointments")
      .select("id, nome, telefone, scheduled_datetime, confirmacao, comparecimento, status")
      .is("deleted_at", null)
      .ilike("telefone_digits", `%${tail}%`)
      .order("scheduled_datetime", { ascending: true })
      .limit(10);
    if (nome?.trim()) {
      query = query.ilike("nome", `%${nome.trim()}%`);
    }
    const { data: rows, error: rowsErr } = await query;
    if (rowsErr) throw rowsErr;

    if (!rows || rows.length === 0) {
      return jsonResponse({
        ok: true,
        appointments: [],
        message: "Não encontrei nenhum agendamento com esse telefone. Pode ser que ainda não tenha sido marcado, ou foi feito com outro número.",
      });
    }

    const now = Date.now();
    const future = rows.filter((r) => new Date(r.scheduled_datetime).getTime() >= now);
    const relevant = future.length > 0 ? future : [rows[rows.length - 1]];

    const lista = relevant
      .map((r) => `${r.nome || "Cliente"} — ${formatDateTimeBR(r.scheduled_datetime)} (status: ${r.confirmacao || "Pendente"})`)
      .join("; ");

    return jsonResponse({
      ok: true,
      appointments: relevant.map((r) => ({
        id: r.id,
        nome: r.nome,
        scheduled_datetime: r.scheduled_datetime,
        confirmacao: r.confirmacao,
        comparecimento: r.comparecimento,
      })),
      message:
        future.length > 0
          ? `Agendamento(s) encontrado(s): ${lista}.`
          : `Não há agendamento futuro. Último encontrado (já passou): ${lista}.`,
    });
  } catch (error) {
    console.error("ai-agent-lookup-appointment error:", error);
    return jsonResponse({ ok: false, message: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
