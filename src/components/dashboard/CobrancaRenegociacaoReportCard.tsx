import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { isRealtimeEnabled } from "@/lib/runtime-config";
import {
  fetchCobrancaRenegociacaoReport,
  type CobrancaRenegReportTotals,
} from "@/lib/cobrancaRenegociacaoReport";
import { supabase } from "@/integrations/supabase/client";
import {
  Phone,
  PhoneOff,
  ThumbsUp,
  ThumbsDown,
  CalendarCheck,
  CalendarX,
  Calendar as CalIcon,
  CheckCircle2,
  ListTodo,
} from "lucide-react";

const formatDateForInput = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

type Props = {
  userId: string;
};

export default function CobrancaRenegociacaoReportCard({ userId }: Props) {
  const [loading, setLoading] = useState(true);
  const [dateMode, setDateMode] = useState<"day" | "range">("day");
  const [selectedDate, setSelectedDate] = useState(formatDateForInput(new Date()));
  const [startDate, setStartDate] = useState(formatDateForInput(new Date()));
  const [endDate, setEndDate] = useState(formatDateForInput(new Date()));
  const [totals, setTotals] = useState<CobrancaRenegReportTotals>({
    tratados: 0,
    cobrancasTratadas: 0,
    tarefas: 0,
    naoAtenderam: 0,
    atenderam: 0,
    renegociados: 0,
    naoRenegociados: 0,
    tarefasConcluidas: 0,
  });

  const load = async (start: string, end: string) => {
    const data = await fetchCobrancaRenegociacaoReport(userId, start, end);
    setTotals(data);
  };

  useEffect(() => {
    setLoading(true);
    const start = dateMode === "day" ? selectedDate : startDate;
    const end = dateMode === "day" ? selectedDate : endDate;
    load(start, end).finally(() => setLoading(false));
  }, [userId, dateMode, selectedDate, startDate, endDate]);

  useEffect(() => {
    if (!isRealtimeEnabled()) return;
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const start = dateMode === "day" ? selectedDate : startDate;
        const end = dateMode === "day" ? selectedDate : endDate;
        load(start, end);
      }, 400);
    };
    const channel = supabase
      .channel(`cobranca-reneg-report-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cobranca_notes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cobranca_activities" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crediario_tasks" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, dateMode, selectedDate, startDate, endDate]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div>
            <CardTitle>Relatório de renegociações</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Suas métricas de contato e renegociação no período selecionado.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground uppercase">Período</label>
              <Select value={dateMode} onValueChange={(v) => setDateMode(v as "day" | "range")}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Dia</SelectItem>
                  <SelectItem value="range">Intervalo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dateMode === "day" ? (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase">Data</label>
                <div className="relative">
                  <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="h-9 w-[170px] pl-7"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">De</label>
                  <Input
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 w-[160px]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">Até</label>
                  <Input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9 w-[160px]"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 mb-4">
              <SummaryStat
                label="Tratadas"
                value={totals.tratados}
                sub={`${totals.cobrancasTratadas} cobrança(s)`}
                icon={Phone}
                tone="default"
              />
              <SummaryStat
                label="Tarefas"
                value={totals.tarefas}
                sub="Crediário + cobrança"
                icon={ListTodo}
                tone="default"
              />
              <SummaryStat label="Não Atenderam" value={totals.naoAtenderam} icon={PhoneOff} tone="danger" />
              <SummaryStat label="Atenderam" value={totals.atenderam} icon={ThumbsUp} tone="success" />
              <SummaryStat label="Renegociados" value={totals.renegociados} icon={CalendarCheck} tone="success" />
              <SummaryStat label="Não Renegociados" value={totals.naoRenegociados} icon={CalendarX} tone="warning" />
              <SummaryStat label="Tarefas Concluídas" value={totals.tarefasConcluidas} icon={CheckCircle2} tone="default" />
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Tratadas = cobranças distintas com tentativa de contato ou tarefa manual no card + tarefas do crediário criadas ou concluídas com renegociação (sem mudanças automáticas de coluna ou WhatsApp do fluxo).
              Tarefas = novas tarefas do crediário + tarefas manuais criadas nos cards de cobrança no período.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "default" | "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
      : tone === "danger"
        ? "text-destructive bg-destructive/10 border-destructive/30"
        : tone === "warning"
          ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
          : "text-foreground bg-muted/40 border-border";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide opacity-80 leading-tight">{label}</span>
        <Icon className="h-4 w-4 opacity-70 shrink-0" />
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <p className="text-[10px] opacity-75 mt-0.5 leading-snug">{sub}</p>}
    </div>
  );
}
