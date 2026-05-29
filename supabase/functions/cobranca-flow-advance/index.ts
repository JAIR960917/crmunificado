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
import { assertCronOrServiceRole, internalCorsHeaders } from "../_shared/internalAuth.ts";
import {
  resolveSendTargetBySession,
  sendWhatsAppMessage,
  cleanPhone as sharedCleanPhone,
} from "../_shared/whatsappSend.ts";

const corsHeaders = internalCorsHeaders;

const cleanPhone = sharedCleanPhone;

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

const SUCCESS_TOKENS = ["success", "sucesso", "sent", "enviado", "accepted", "queued", "ok"];
const ERROR_TOKENS = [
  "error", "erro", "failed", "failure", "invalid", "invalido", "inválido",
  "offline", "disconnected", "desconect", "not connected", "não conectado",
  "nao conectado", "not found", "forbidden", "blocked",
  "restri", "banimento", "banido", "bloqueio", "limite excedido",
];

function extractApiMessages(result: any) {
  return [
    result?.message, result?.mensagem, result?.error, result?.msg, result?.status,
    result?.data?.message, result?.data?.mensagem, result?.data?.error, result?.data?.msg, result?.data?.status,
  ].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function includesToken(values: string[], tokens: string[]) {
  const haystack = values.join(" ").toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

function resolveSendResult(responseOk: boolean, result: any) {
  const messages = extractApiMessages(result);
  const fallback = messages[0] || "A API Full não confirmou o envio da mensagem";
  const boolFlags = [
    result?.success,
    result?.sucesso,
    result?.data?.success,
    result?.data?.sucesso,
  ].filter((v) => typeof v === "boolean");

  if (!responseOk) return { ok: false, error: fallback };
  if (boolFlags.includes(false)) return { ok: false, error: fallback };
  if (includesToken(messages, ERROR_TOKENS)) return { ok: false, error: fallback };
  if (boolFlags.includes(true) || includesToken(messages, SUCCESS_TOKENS)) return { ok: true, error: null };
  if (responseOk) return { ok: true, error: null };
  return { ok: false, error: fallback };
}

async function sendMessage(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  session: string,
  phone: string,
  text: string,
  imageUrl?: string | null,
  metaTemplateName?: string | null,
) {
  const target = await resolveSendTargetBySession(supabase, session);
  if (!target) return { ok: false, error: "Instância não encontrada", raw: null };
  const metaToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const result = await sendWhatsAppMessage({
    target,
    phone,
    text,
    imageUrl,
    apiFullKey: apiKey,
    metaAccessToken: metaToken,
    metaTemplateName: metaTemplateName || target.metaDefaultTemplate,
    supabase,
  });
  return { ok: result.ok, error: result.errorMessage, raw: result.raw };
}

async function resolveSession(supabase: any, instanceId: string | null, companyId: string | null): Promise<string | null> {
  if (instanceId) {
    const { data } = await supabase.from("whatsapp_instances").select("session, is_active").eq("id", instanceId).maybeSingle();
    if (data?.session) return data.session;
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

  const authDenied = assertCronOrServiceRole(req, corsHeaders);
  if (authDenied) return authDenied;

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
      .select("id, status, data, company_id, ssotica_cliente_id, assigned_to, created_by")
      .in("status", Array.from(enabledKeys));

    // Pré-carrega IDs de cobranças com qualquer atividade pendente (não concluída).
    // Cards com tarefa pendente/atrasada NÃO podem avançar de coluna.
    const cobrancaIds = (cobrancas || []).map((c: any) => c.id);
    const pendingCobrancaIds = new Set<string>();
    if (cobrancaIds.length > 0) {
      const { data: pendingActs } = await supabase
        .from("cobranca_activities")
        .select("cobranca_id")
        .is("completed_at", null)
        .in("cobranca_id", cobrancaIds);
      for (const a of (pendingActs || []) as any[]) {
        if (a?.cobranca_id) pendingCobrancaIds.add(a.cobranca_id);
      }
    }

    const stats = { processed: 0, gatilhos_enviados: 0, gatilhos_falhos: 0, avancados: 0, skipped: 0, bloqueados_por_tarefa: 0 };
    const now = new Date();

    // Dedupe por lead (telefone/ssotica_cliente_id) por status, dentro deste tick
    const triggeredLeadsByStatus = new Set<string>();

    for (const cob of (cobrancas || []) as any[]) {
      stats.processed++;
      const statusObj = statusByKey.get(cob.status);
      if (!statusObj) { stats.skipped++; continue; }
      const flow = flowByStatusId.get(statusObj.id);
      if (!flow) { stats.skipped++; continue; }

      const data = (cob.data || {}) as Record<string, any>;

      // ---- COLUNA AUTO: garantir disparo do gatilho ----
      if (flow.column_type === "auto") {
        const sentForThisStatus = data.gatilho_status_key === cob.status
          && data.gatilho_enviado_em
          && !data.envio_erro;
        const phoneRawDedupe = String(data.telefone || data.phone || data.celular || "").replace(/\D/g, "");
        const leadKey = `${cob.status}::${(cob as any).ssotica_cliente_id || phoneRawDedupe || cob.id}`;
        if (!sentForThisStatus && !triggeredLeadsByStatus.has(leadKey) && flow.whatsapp_trigger_campaign_id) {
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
              const result = await sendMessage(
                supabase,
                APIFULL_API_KEY,
                session,
                phone,
                text,
                step.image_url || null,
                step.meta_template_name,
              );
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
                // Registra tarefa concluída para refletir o envio no painel "Atividade"
                try {
                  const createdBy = cob.assigned_to || cob.created_by || null;
                  if (createdBy) {
                    await supabase.from("cobranca_activities").insert({
                      cobranca_id: cob.id,
                      created_by: createdBy,
                      title: `WhatsApp enviado — ${campaign.name}`,
                      description: text,
                      scheduled_date: sentAt,
                      completed_at: sentAt,
                    });
                  }
                } catch (e) {
                  console.error("[flow-advance] erro ao registrar activity:", e);
                }
                // refletimos a mudança em memória para a checagem de avanço a seguir
                Object.assign(data, newData);
                triggeredLeadsByStatus.add(leadKey);
                stats.gatilhos_enviados++;
              } else {
                const errMsg = (result as any).error || "envio_falhou";
                await supabase.from("crm_cobrancas").update({
                  data: {
                    ...data,
                    envio_erro: errMsg,
                    envio_erro_em: new Date().toISOString(),
                    envio_erro_campaign_id: campaign.id,
                    envio_erro_campaign_name: campaign.name,
                  },
                }).eq("id", cob.id);
                await supabase.from("crm_cobranca_flow_events").insert({
                  cobranca_id: cob.id,
                  status_id: statusObj.id,
                  status_key: cob.status,
                  status_label: statusObj.label,
                  event_type: "gatilho_falhou",
                  whatsapp_trigger_campaign_id: campaign.id,
                  whatsapp_trigger_campaign_name: campaign.name,
                  details: { error: errMsg, session, phone },
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

      // Bloqueia avanço se houver tarefa pendente/atrasada vinculada ao card.
      if (pendingCobrancaIds.has(cob.id)) {
        stats.bloqueados_por_tarefa++;
        continue;
      }


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
      newData.status_entered_at = new Date().toISOString();
      newData.status_entered_status_key = nextStatus.key;

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
