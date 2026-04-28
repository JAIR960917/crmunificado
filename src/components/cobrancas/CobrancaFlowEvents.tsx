import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Zap, User, ArrowRight, AlertCircle, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type FlowEvent = {
  id: string;
  status_key: string | null;
  status_label: string | null;
  event_type: "tratativa" | "gatilho_enviado" | "avancou_coluna" | "gatilho_falhou";
  whatsapp_trigger_campaign_name: string | null;
  next_status_key: string | null;
  next_status_label: string | null;
  details: any;
  created_at: string;
};

type FlowConfig = {
  flow_enabled: boolean;
  column_type: "manual" | "auto";
  days_to_advance: number;
  whatsapp_trigger_campaign_id: string | null;
  next_status_id: string | null;
};

type Props = {
  cobrancaId: string;
  cobrancaData: Record<string, any>;
  currentStatusKey: string | null;
  refreshKey?: number;
};

function fmt(ts: string) {
  try { return format(new Date(ts), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
  catch { return ts; }
}

function daysBetween(fromIso: string): number {
  const ms = Date.now() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export default function CobrancaFlowEvents({ cobrancaId, cobrancaData, currentStatusKey, refreshKey }: Props) {
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [flow, setFlow] = useState<FlowConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const [{ data: evs }, { data: status }] = await Promise.all([
        (supabase as any)
          .from("crm_cobranca_flow_events")
          .select("*")
          .eq("cobranca_id", cobrancaId)
          .order("created_at", { ascending: false })
          .limit(50),
        currentStatusKey
          ? (supabase as any).from("crm_cobranca_statuses").select("id").eq("key", currentStatusKey).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      let cfg: FlowConfig | null = null;
      if (status?.id) {
        const { data: f } = await (supabase as any)
          .from("crm_cobranca_column_flow")
          .select("flow_enabled, column_type, days_to_advance, whatsapp_trigger_campaign_id, next_status_id")
          .eq("status_id", status.id)
          .maybeSingle();
        cfg = (f as FlowConfig) || null;
      }
      if (!mounted) return;
      setEvents((evs || []) as FlowEvent[]);
      setFlow(cfg);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [cobrancaId, currentStatusKey, refreshKey]);

  if (loading || !flow?.flow_enabled) return null;

  // Estado atual
  const isAuto = flow.column_type === "auto";
  const tratativaForCurrent = cobrancaData?.tratativa_status_key === currentStatusKey ? cobrancaData?.tratativa_em : null;
  const gatilhoForCurrent = cobrancaData?.gatilho_status_key === currentStatusKey ? cobrancaData?.gatilho_enviado_em : null;
  const baseTs = isAuto ? gatilhoForCurrent : tratativaForCurrent;
  const remaining = baseTs ? Math.max(0, flow.days_to_advance - daysBetween(baseTs)) : flow.days_to_advance;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Workflow className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Fluxo automático</span>
        {isAuto ? (
          <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 hover:bg-blue-500/20">
            <Zap className="h-3 w-3 mr-1" /> Automática
          </Badge>
        ) : (
          <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20">
            <User className="h-3 w-3 mr-1" /> Tratativa
          </Badge>
        )}
      </div>

      {/* Status atual */}
      <div className="text-xs space-y-1">
        {isAuto ? (
          gatilhoForCurrent ? (
            <p className="text-blue-700">
              ✉️ Gatilho enviado em <strong>{fmt(gatilhoForCurrent)}</strong>. Avança em <strong>{remaining}</strong> dia(s).
            </p>
          ) : (
            <p className="text-muted-foreground">Aguardando envio do gatilho automático…</p>
          )
        ) : (
          tratativaForCurrent ? (
            <p className="text-emerald-700">
              ✅ Tratativa registrada em <strong>{fmt(tratativaForCurrent)}</strong>. Avança em <strong>{remaining}</strong> dia(s).
            </p>
          ) : (
            <p className="text-amber-700">⏳ Aguardando tratativa para liberar o avanço da coluna.</p>
          )
        )}
      </div>

      {/* Histórico */}
      {events.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Histórico do fluxo</p>
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5">
                {e.event_type === "gatilho_enviado" && <Zap className="h-3.5 w-3.5 text-blue-500" />}
                {e.event_type === "tratativa" && <User className="h-3.5 w-3.5 text-amber-600" />}
                {e.event_type === "avancou_coluna" && <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />}
                {e.event_type === "gatilho_falhou" && <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
              </span>
              <div className="flex-1">
                {e.event_type === "gatilho_enviado" && (
                  <p>
                    Gatilho <strong>{e.whatsapp_trigger_campaign_name || "WhatsApp"}</strong> enviado
                    {e.status_label ? <> em <em>{e.status_label}</em></> : null}.
                  </p>
                )}
                {e.event_type === "tratativa" && (
                  <p>
                    Tratativa registrada{e.status_label ? <> em <em>{e.status_label}</em></> : null}
                    {e.details?.atendeu === "sim" ? " — cliente atendeu" : e.details?.atendeu === "nao" ? " — não atendeu" : ""}.
                  </p>
                )}
                {e.event_type === "avancou_coluna" && (
                  <p>
                    Avançou de <em>{e.status_label}</em> para <strong>{e.next_status_label}</strong>.
                  </p>
                )}
                {e.event_type === "gatilho_falhou" && (
                  <p className="text-red-600">
                    Falha ao enviar gatilho <strong>{e.whatsapp_trigger_campaign_name || ""}</strong>: {e.details?.error || e.details?.reason || "erro"}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{fmt(e.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
