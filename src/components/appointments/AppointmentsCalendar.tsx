import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getAppointmentCalendarColor, formatRescheduleNote } from "@/lib/appointmentUtils";
import {
  buildMonthGrid,
  buildWeekDays,
  buildTimeGridLayout,
  dayKey,
  format,
  getNowLineTop,
  HOUR_SLOTS,
  isConsultaPaga,
  isSameDay,
  isSameMonth,
  ptBR,
  type CalendarEventLayout,
  WEEKDAY_LABELS,
  type CalendarViewMode,
} from "@/lib/appointmentCalendarUtils";

export type CalendarAppointment = {
  id: string;
  nome: string;
  scheduled_datetime: string;
  consulta_paga: boolean | null;
  consulta_paga_em?: string | null;
  created_at: string;
  is_reschedule_snapshot?: boolean | null;
  rescheduled_from_datetime?: string | null;
  original_scheduled_datetime?: string | null;
  rescheduled_to_datetime?: string | null;
  deleted_at?: string | null;
  returned_at?: string | null;
};

type Props = {
  appointments: CalendarAppointment[];
  view: CalendarViewMode;
  focusDate: Date;
  onSelectAppointment: (appt: CalendarAppointment) => void;
  onDayClick?: (date: Date) => void;
};

const MONTH_MAX_VISIBLE = 5;

function apptsByDay(appts: CalendarAppointment[]) {
  const map = new Map<string, CalendarAppointment[]>();
  for (const a of appts) {
    const key = dayKey(new Date(a.scheduled_datetime));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  map.forEach((list) =>
    list.sort((x, y) => new Date(x.scheduled_datetime).getTime() - new Date(y.scheduled_datetime).getTime()),
  );
  return map;
}

function groupLayoutsBySlot<T extends { scheduled_datetime: string }>(
  layouts: CalendarEventLayout<T>[],
) {
  const groups = new Map<string, CalendarEventLayout<T>[]>();
  for (const layout of layouts) {
    const key = `${layout.top}:${layout.height}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(layout);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((a, b) => a.column - b.column),
  );
}

function EventChip({
  appt,
  onClick,
  compact,
}: {
  appt: CalendarAppointment;
  onClick: () => void;
  compact?: boolean;
}) {
  const dt = new Date(appt.scheduled_datetime);
  const rowColor = getAppointmentCalendarColor(appt as Parameters<typeof getAppointmentCalendarColor>[0]);
  const note = formatRescheduleNote(appt);
  const title = note
    ? `${appt.nome} — ${format(dt, "HH:mm", { locale: ptBR })} · ${note}`
    : `${appt.nome} — ${format(dt, "HH:mm", { locale: ptBR })}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "h-full w-full text-left rounded truncate border overflow-hidden box-border",
        rowColor || "bg-primary text-primary-foreground border-primary/50",
        compact ? "h-4 shrink-0 text-[9px] px-1 py-0 leading-4" : "h-full max-h-full px-1 py-0 text-[11px] leading-none",
        appt.is_reschedule_snapshot && "border-dashed",
      )}
      title={title}
    >
      {!compact && <span className="font-medium">{format(dt, "HH:mm")} </span>}
      {appt.is_reschedule_snapshot && <span className="opacity-80">↪ </span>}
      {appt.nome || "—"}
    </button>
  );
}

function MonthView({ appointments, focusDate, onSelectAppointment, onDayClick }: Props) {
  const byDay = useMemo(() => apptsByDay(appointments), [appointments]);
  const grid = buildMonthGrid(focusDate);
  const today = new Date();

  return (
    <div className="rounded-lg border overflow-hidden bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/50">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-[11px] font-semibold text-muted-foreground">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border">
        {grid.map((day) => {
          const key = dayKey(day);
          const dayAppts = byDay.get(key) || [];
          const paid = dayAppts.filter(isConsultaPaga).length;
          const total = dayAppts.length;
          const inMonth = isSameMonth(day, focusDate);
          const isToday = isSameDay(day, today);

          return (
            <div
              key={key}
              className={cn(
                "min-h-[140px] p-1 flex flex-col gap-0.5 bg-background",
                !inMonth && "bg-muted/20 text-muted-foreground",
              )}
              onClick={() => onDayClick?.(day)}
            >
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDayClick?.(day); }}
                  className={cn(
                    "h-7 w-7 rounded-full text-sm font-medium flex items-center justify-center",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </button>
                {inMonth && total > 0 && (
                  <span className="text-[10px] text-muted-foreground font-medium">
                    pagos {paid}/{total}
                  </span>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-px min-h-0 overflow-hidden">
                {dayAppts.slice(0, MONTH_MAX_VISIBLE).map((a) => (
                  <EventChip key={a.id} appt={a} compact onClick={() => onSelectAppointment(a)} />
                ))}
                {dayAppts.length > MONTH_MAX_VISIBLE && (
                  <span className="text-[9px] text-muted-foreground px-0.5 leading-4 shrink-0">
                    +{dayAppts.length - MONTH_MAX_VISIBLE} mais
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGridView({
  appointments,
  focusDate,
  view,
  onSelectAppointment,
}: Props & { view: "week" | "day" }) {
  const days = useMemo(
    () => (view === "week" ? buildWeekDays(focusDate) : [focusDate]),
    [view, focusDate],
  );
  const byDay = useMemo(() => apptsByDay(appointments), [appointments]);
  const gridLayout = useMemo(
    () => buildTimeGridLayout(days, byDay),
    [days, byDay],
  );
  const { hourHeights, totalHeight, layoutsByDay } = gridLayout;
  const now = new Date();
  const nowTop = getNowLineTop(now, hourHeights);
  const showNowLine = days.some((d) => isSameDay(d, now)) && nowTop != null;

  return (
    <div className="rounded-lg border overflow-hidden bg-card flex flex-col max-h-[calc(100vh-220px)]">
      <div className="flex border-b bg-muted/50 shrink-0 overflow-x-auto">
        <div className="w-14 shrink-0 border-r" />
        {days.map((day) => {
          const isToday = isSameDay(day, now);
          return (
            <div key={dayKey(day)} className="flex-1 min-w-[100px] text-center py-2 border-r last:border-r-0">
              <div className="text-[11px] font-semibold text-muted-foreground">
                {WEEKDAY_LABELS[day.getDay()]}
              </div>
              <div
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium mt-0.5",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto relative">
        <div className="flex" style={{ minHeight: totalHeight }}>
          <div className="w-14 shrink-0 border-r bg-muted/20">
            {HOUR_SLOTS.map((h) => (
              <div
                key={h}
                className="text-[10px] text-muted-foreground text-right pr-1 border-b border-border/50 flex items-start justify-end pt-0.5"
                style={{ height: hourHeights[h] }}
              >
                {h <= 12 ? `${h === 12 ? 12 : h} ${h < 12 ? "AM" : "PM"}` : `${h - 12} PM`}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = dayKey(day);
            const layouts = layoutsByDay.get(key) || [];
            const slotGroups = groupLayoutsBySlot(layouts);
            return (
              <div
                key={key}
                className="flex-1 min-w-[100px] border-r last:border-r-0 relative isolate"
                style={{ minHeight: totalHeight }}
              >
                {HOUR_SLOTS.map((h) => (
                  <div key={h} className="border-b border-border/40" style={{ height: hourHeights[h] }} />
                ))}
                {slotGroups.map((group) => (
                  <div
                    key={`${group[0].top}-${group.map((g) => g.item.id).join("-")}`}
                    className="absolute left-1 right-1 flex gap-0.5 overflow-hidden"
                    style={{
                      top: group[0].top,
                      height: group[0].height,
                      zIndex: 10 + group[0].column,
                    }}
                  >
                    {group.map(({ item: a }) => (
                      <div key={a.id} className="flex-1 min-w-0 min-h-0">
                        <EventChip appt={a} onClick={() => onSelectAppointment(a)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {showNowLine && (
          <div
            className="absolute left-14 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
            style={{ top: nowTop! }}
          >
            <span className="absolute -left-2 -top-1.5 h-2.5 w-2.5 rounded-full bg-red-500" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppointmentsCalendar(props: Props) {
  if (props.view === "month") return <MonthView {...props} />;
  return <TimeGridView {...props} view={props.view} />;
}
