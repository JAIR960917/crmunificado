/**
 * ============================================================================
 * Edge Function: cobranca-flow-advance
 * ============================================================================
 * Roda periodicamente (cron). Para cada cobrança:
 *   1) Lê a configuração da coluna atual (crm_cobranca_column_flow).
 *   2) Se a coluna é AUTOMÁTICA e ainda não foi enviado o gatilho neste status:
 *        → dispara a mensagem (1ª step da campanha vinculada) via API Full
 *        → grava evento 'gatilho_enviado' (com data/hora)
 *        → grava data.gatilho_enviado_em / data.gatilho_status_key no card
 *   3) Avalia se deve AVANÇAR para a próxima coluna:
 *        - manual: precisa ter data.tratativa_em na coluna atual + dias_to_advance
 *        - auto:   precisa ter data.gatilho_enviado_em na coluna atual + dias_to_advance
 *      Se sim, atualiza status do card, registra evento 'avancou_coluna' e
 *      limpa as marcas (tratativa_em / gatilho_enviado_em) para a próxima coluna.
 *
 * Antes da coluna "31 dias de atraso (Ligação)" o fluxo permanece como hoje.
 * Esta função só atua nos cards cuja coluna atual tem flow_enabled = true.
 * ============================================================================
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APIFULL_BASE = "https://api.apifull.com.br/whatsapp";

function cleanPhone(phone: string) {
  let clean = (phone || "").replace(/\D/g, "");
  if (!clean) return "";
  if (clean.startsWith("0")) clean = clean.substring(1);
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
}

function applyPlaceholders(text: string, data: Record<string, any>): string {
  if (!text) return "";
  const map: Record<string, any> = {
    nome: data.nome || data.nome_lead || "Cliente",
    telefone: data.telefone || "",
    valor: data.valor || "",
    vencimento: data.vencimento || "",
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(map[k] ?? data[k] ?? ""));
}

async function sendMessage(apiKey: string, session: string, phone: string, text: string, imageUrl?: string | null) {
  const endpoint = imageUrl ? "/send-image" : "/send-message";
  const body: Record<string, any> = imageUrl
    ? { session, number: phone, text, file: imageUrl }
    : { session, number: phone, text, isGroup: false };
  const res = await fetch(`${APIFULL_BASE}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  let json: any = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = { raw: t }; }
  if (!res.ok) return { ok: false, error: json?.message || json?.error || `HTTP ${res.status}` };
  return { ok: true, raw: json };
}

async function resolveSession(supabase: any, instanceId: string | null, companyId: string | null): Promise<string | null> {
  if (instanceId) {
    const { data } = await supabase.from("whatsapp_instances").select("session, is_active").eq("id", instanceId).maybeSingle();
    if (data?.is_active) return data.session;
  }
  if (companyId) {
    const { data } = await supabase.from("whatsapp_instances").select("session").eq("company_id", companyId).eq("is_active", true).maybeSingle();
    if (data?.session) return data.session;
  }
  const { data } = await supabase.from("system_settings").select("setting_value").eq("setting_key", "apifull_session").maybeSingle();
  return data?.setting_value || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const APIFULL_API_KEY = Deno.env.get("APIFULL_API_KEY");
    if (!APIFULL_API_KEY) throw new Error("APIFULL_API_KEY missing");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) Carrega configurações ativas
    const { data: flows } = await supabase
      .from("crm_cobranca_column_flow")
      .select("*")
      .eq("flow_enabled", true);

    if (!flows || flows.length === 0) {
      return new Response(JSON.stringify({ ok: true, msg: "no flows enabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const flowByStatusId = new Map<string, any>(flows.map((f: any) => [f.status_id, f]));
    const enabledStatusIds = new Set<string>(flows.map((f: any) => f.status_id));

    // mapas de status (id <-> key/label)
    const { data: statuses } = await supabase.from("crm_cobranca_statuses").select("id, key, label");
    const statusById = new Map<string, any>((statuses || []).map((s: any) => [s.id, s]));
    const statusByKey = new Map<string, any>((statuses || []).map((s: any) => [s.key, s]));

    const enabledKeys = new Set<string>(
      Array.from(enabledStatusIds).map((sid) => statusById.get(sid)?.key).filter(Boolean) as string[]
    );

    // 2) Carrega cobranças que estão em alguma coluna habilitada
    const { data: cobrancas } = await supabase
      .from("crm_cobrancas")
      .select("id, status, data, company_id")
      .in("status", Array.from(enabledKeys));

    const stats = { processed: 0, gatilhos_enviados: 0, gatilhos_falhos: 0, avancados: 0, skipped: 0 };
    const now = new Date();

    for (const cob of (cobrancas || []) as any[]) {
      stats.processed++;
      const statusObj = statusByKey.get(cob.status);
      if (!statusObj) { stats.skipped++; continue; }
      const flow = flowByStatusId.get(statusObj.id);
      if (!flow) { stats.skipped++; continue; }

      const data = (cob.data || {}) as Record<string, any>;

      // ---- COLUNA AUTO: garantir disparo do gatilho ----
      if (flow.column_type === "auto") {
        const sentForThisStatus = data.gatilho_status_key === cob.status && data.gatilho_enviado_em;
        if (!sentForThisStatus && flow.whatsapp_trigger_campaign_id) {
          // Carrega campanha + 1º step
          const { data: campaign } = await supabase
            .from("whatsapp_trigger_campaigns")
            .select("id, name, instance_id, company_id, is_active")
            .eq("id", flow.whatsapp_trigger_campaign_id)
            .maybeSingle();

          if (!campaign || !campaign.is_active) {
            stats.skipped++;
          } else {
            const { data: steps } = await supabase
              .from("whatsapp_trigger_steps")
              .select("id, position, message, image_url")
              .eq("campaign_id", campaign.id)
              .order("position", { ascending: true })
              .limit(1);
            const step = (steps || [])[0];

            const phoneRaw = data.telefone || data.phone || data.celular || "";
            const phone = cleanPhone(String(phoneRaw));
            const session = await resolveSession(supabase, campaign.instance_id, campaign.company_id || cob.company_id);

            if (!phone || !session || !step) {
              await supabase.from("crm_cobranca_flow_events").insert({
                cobranca_id: cob.id,
                status_id: statusObj.id,
                status_key: cob.status,
                status_label: statusObj.label,
                event_type: "gatilho_falhou",
                whatsapp_trigger_campaign_id: campaign.id,
                whatsapp_trigger_campaign_name: campaign.name,
                details: { reason: !phone ? "sem_telefone" : !session ? "sem_sessao_apifull" : "campanha_sem_step" },
              });
              stats.gatilhos_falhos++;
            } else {
              const text = applyPlaceholders(step.message || "", data);
              const result = await sendMessage(APIFULL_API_KEY, session, phone, text, step.image_url || null);
              if (result.ok) {
                const sentAt = new Date().toISOString();
                const newData = {
                  ...data,
                  gatilho_enviado_em: sentAt,
                  gatilho_status_key: cob.status,
                  gatilho_campaign_id: campaign.id,
                  gatilho_campaign_name: campaign.name,
                };
                await supabase.from("crm_cobrancas").update({ data: newData }).eq("id", cob.id);
                await supabase.from("crm_cobranca_flow_events").insert({
                  cobranca_id: cob.id,
                  status_id: statusObj.id,
                  status_key: cob.status,
                  status_label: statusObj.label,
                  event_type: "gatilho_enviado",
                  whatsapp_trigger_campaign_id: campaign.id,
                  whatsapp_trigger_campaign_name: campaign.name,
                  details: { phone, sent_at: sentAt },
                });
                // refletimos a mudança em memória para a checagem de avanço a seguir
                Object.assign(data, newData);
                stats.gatilhos_enviados++;
              } else {
                await supabase.from("crm_cobranca_flow_events").insert({
                  cobranca_id: cob.id,
                  status_id: statusObj.id,
                  status_key: cob.status,
                  status_label: statusObj.label,
                  event_type: "gatilho_falhou",
                  whatsapp_trigger_campaign_id: campaign.id,
                  whatsapp_trigger_campaign_name: campaign.name,
                  details: { error: (result as any).error || "envio_falhou" },
                });
                stats.gatilhos_falhos++;
              }
            }
          }
        }
      }

      // ---- AVANÇO DE COLUNA ----
      if (!flow.next_status_id || flow.days_to_advance == null) continue;
      const nextStatus = statusById.get(flow.next_status_id);
      if (!nextStatus) continue;

      let baseTs: string | null = null;
      if (flow.column_type === "manual") {
        if (data.tratativa_status_key === cob.status && data.tratativa_em) {
          baseTs = data.tratativa_em;
        }
      } else {
        if (data.gatilho_status_key === cob.status && data.gatilho_enviado_em) {
          baseTs = data.gatilho_enviado_em;
        }
      }
      if (!baseTs) continue; // sem tratativa/gatilho → não avança

      const elapsedDays = (now.getTime() - new Date(baseTs).getTime()) / 86400000;
      if (elapsedDays < (flow.days_to_advance || 0)) continue;

      // Mínimo de parcelas em atraso para liberar o avanço.
      // Se a coluna foi configurada com min_parcelas_atraso > 0, o card só sobe
      // quando o cliente tiver pelo menos esse número de parcelas vencidas.
      const minParcelas = Number(flow.min_parcelas_atraso ?? 1);
      if (minParcelas > 0) {
        const parcelasAtrasadas = Array.isArray(data.parcelas_atrasadas) ? data.parcelas_atrasadas : [];
        if (parcelasAtrasadas.length < minParcelas) continue;
      }

      // Avança o card e limpa marcas para que a próxima coluna conte do zero
      const newData = { ...data };
      delete newData.tratativa_em;
      delete newData.tratativa_status_key;
      delete newData.tratativa_atendeu;
      delete newData.gatilho_enviado_em;
      delete newData.gatilho_status_key;
      delete newData.gatilho_campaign_id;
      delete newData.gatilho_campaign_name;

      await supabase
        .from("crm_cobrancas")
        .update({ status: nextStatus.key, data: newData, updated_at: new Date().toISOString() })
        .eq("id", cob.id);

      await supabase.from("crm_cobranca_flow_events").insert({
        cobranca_id: cob.id,
        status_id: statusObj.id,
        status_key: cob.status,
        status_label: statusObj.label,
        event_type: "avancou_coluna",
        next_status_key: nextStatus.key,
        next_status_label: nextStatus.label,
        details: { reason: flow.column_type, days_elapsed: Math.round(elapsedDays) },
      });
      stats.avancados++;
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cobranca-flow-advance] error:", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
