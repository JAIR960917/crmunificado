import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { CampanhaCopaSubmission } from "./CampanhaCopaSubmissionDialog";

type HistoryRow = {
  id: string;
  user_id: string | null;
  action: string;
  summary: string;
  created_at: string;
};

type PalpiteRow = Pick<
  CampanhaCopaSubmission,
  "id" | "created_at" | "jogo_label" | "jogo" | "palpite_texto" | "palpite_brasil" | "palpite_marrocos"
>;

type Profile = { user_id: string; full_name: string };

type Props = {
  submission: CampanhaCopaSubmission;
  profiles: Profile[];
  refreshKey?: number;
};

const LEGACY_JOGO_LABELS: Record<string, string> = {
  brasil_x_marrocos: "Brasil x Marrocos",
  brasil_marrocos: "Brasil x Marrocos",
};

function palpiteOf(row: PalpiteRow): string {
  return (
    row.palpite_texto ||
    `${row.palpite_brasil ?? "?"} x ${row.palpite_marrocos ?? "?"}`
  );
}

function jogoLabelOf(row: PalpiteRow): string {
  return (
    row.jogo_label ||
    LEGACY_JOGO_LABELS[row.jogo || ""] ||
    row.jogo ||
    "Jogo"
  );
}

function cpfDigitsOnly(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

function formatCpfDigits(digits: string): string {
  if (digits.length !== 11) return digits;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

async function resolveCpfDigits(submission: CampanhaCopaSubmission): Promise<string> {
  const fromSubmission = cpfDigitsOnly(submission.cpf);
  if (fromSubmission.length === 11) return fromSubmission;

  if (!submission.lead_id) return fromSubmission;

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("data")
    .eq("id", submission.lead_id)
    .maybeSingle();

  const leadData = lead?.data as Record<string, unknown> | null | undefined;
  const fromLead = cpfDigitsOnly(typeof leadData?.cpf === "string" ? leadData.cpf : null);
  return fromLead.length === 11 ? fromLead : fromSubmission;
}

export default function CampanhaCopaHistoryPanel({ submission, profiles, refreshKey = 0 }: Props) {
  const [palpites, setPalpites] = useState<PalpiteRow[]>([]);
  const [events, setEvents] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      const cpfDigits = await resolveCpfDigits(submission);

      let palpiteQuery = supabase
        .from("campanha_copa_submissions")
        .select("id, created_at, jogo_label, jogo, palpite_texto, palpite_brasil, palpite_marrocos")
        .order("created_at", { ascending: false });

      if (cpfDigits.length === 11) {
        const formatted = formatCpfDigits(cpfDigits);
        palpiteQuery = palpiteQuery.or(`cpf.eq.${cpfDigits},cpf.eq.${formatted}`);
      } else {
        palpiteQuery = palpiteQuery.eq("id", submission.id);
      }

      const [palpiteRes, eventRes] = await Promise.all([
        palpiteQuery,
        supabase
          .from("campanha_copa_history" as never)
          .select("id, user_id, action, summary, created_at")
          .eq("submission_id", submission.id)
          .neq("action", "created")
          .order("created_at", { ascending: false }),
      ]);

      if (!cancelled) {
        setPalpites((palpiteRes.data || []) as PalpiteRow[]);
        setEvents((eventRes.data || []) as unknown as HistoryRow[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.id, submission.cpf, submission.lead_id, refreshKey]);

  const nameOf = (uid: string | null) => {
    if (!uid) return "Sistema";
    return profiles.find((p) => p.user_id === uid)?.full_name || "Usuário";
  };

  const isEmpty = palpites.length === 0 && events.length === 0;

  return (
    <div className="flex flex-col border-t md:border-t-0 md:border-l md:min-w-[320px] md:max-w-[380px]">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Histórico de palpites</span>
      </div>
      <ScrollArea className="flex-1 max-h-[420px] md:max-h-[520px] px-4 py-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando histórico...</p>
        ) : isEmpty ? (
          <p className="text-xs text-muted-foreground">Nenhum palpite registrado.</p>
        ) : (
          <div className="relative pl-5 space-y-4">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
            {palpites.map((row) => {
              const isCurrent = row.id === submission.id;
              return (
                <div key={row.id} className="relative">
                  <div
                    className={cn(
                      "absolute -left-5 top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary",
                    )}
                  />
                  <div
                    className={cn(
                      "rounded-lg border p-3 space-y-2",
                      isCurrent
                        ? "border-primary/30 bg-primary/5"
                        : "border-muted-foreground/30 bg-muted/30",
                    )}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {format(new Date(row.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}
                    </p>
                    <p className="text-sm font-semibold leading-snug">{jogoLabelOf(row)}</p>
                    <Badge variant="secondary" className="text-sm px-2.5 py-0.5">
                      Palpite {palpiteOf(row)}
                    </Badge>
                  </div>
                </div>
              );
            })}

            {events.map((row) => (
              <div key={row.id} className="relative">
                <div className="absolute -left-5 top-1.5 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground" />
                <div className="rounded-lg border border-muted-foreground/40 bg-muted/50 p-3">
                  <p className="text-sm leading-snug text-muted-foreground">{row.summary}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {nameOf(row.user_id)} ·{" "}
                    {format(new Date(row.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
