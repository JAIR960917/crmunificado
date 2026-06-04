import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

type HistoryRow = {
  id: string;
  user_id: string;
  action: string;
  summary: string;
  created_at: string;
};

type Profile = { user_id: string; full_name: string };

type Props = {
  appointmentId: string;
  profiles: Profile[];
};

export default function AppointmentHistoryPanel({ appointmentId, profiles }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("crm_appointment_history")
        .select("id, user_id, action, summary, created_at")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setRows((data || []) as HistoryRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [appointmentId]);

  const nameOf = (uid: string) => profiles.find((p) => p.user_id === uid)?.full_name || "Usuário";

  return (
    <div className="flex flex-col border-t md:border-t-0 md:border-l md:min-w-[340px] md:max-w-[400px]">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Histórico do agendamento</span>
      </div>
      <ScrollArea className="flex-1 max-h-[420px] md:max-h-none px-4 py-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando histórico...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</p>
        ) : (
          <div className="relative pl-5 space-y-4">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
            {rows.map((row) => {
              const isMuted = row.action === "deleted" || row.action === "returned";
              return (
              <div key={row.id} className="relative">
                <div
                  className={cn(
                    "absolute -left-5 top-1.5 h-3 w-3 rounded-full border-2 border-background",
                    isMuted ? "bg-muted-foreground" : "bg-primary",
                  )}
                />
                <div
                  className={cn(
                    "rounded-lg border p-3",
                    isMuted
                      ? "border-muted-foreground/40 bg-muted/70 text-muted-foreground"
                      : "border-primary/20 bg-muted/20",
                  )}
                >
                  <p className={cn("text-sm font-medium leading-snug", isMuted && "text-muted-foreground")}>
                    {row.summary}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {nameOf(row.user_id)} · {format(new Date(row.created_at), "dd/MM/yyyy, HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
