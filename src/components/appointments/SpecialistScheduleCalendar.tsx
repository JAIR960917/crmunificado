import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  buildMonthGrid,
  dayKey,
  format,
  isSameDay,
  isSameMonth,
  ptBR,
  WEEKDAY_LABELS,
} from "@/lib/appointmentCalendarUtils";
import {
  groupScheduleByDay,
  textColorForBackground,
  type SpecialistScheduleEntry,
} from "@/lib/eyeExamSchedule";

type Props = {
  focusDate: Date;
  entries: SpecialistScheduleEntry[];
  onDayClick?: (date: Date) => void;
};

const MAX_VISIBLE = 5;

export default function SpecialistScheduleCalendar({ focusDate, entries, onDayClick }: Props) {
  const byDay = useMemo(() => groupScheduleByDay(entries), [entries]);
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
          const dayEntries = byDay.get(key) || [];
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onDayClick?.(day);
                  }}
                  className={cn(
                    "h-7 w-7 rounded-full text-sm font-medium flex items-center justify-center",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </button>
                {inMonth && dayEntries.length > 0 && (
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {dayEntries.length} especialista(s)
                  </span>
                )}
              </div>
              <div className="flex-1 flex flex-col gap-px min-h-0 overflow-hidden">
                {dayEntries.slice(0, MAX_VISIBLE).map((e) => (
                  <div
                    key={`${e.eyeExamDayId}-${e.specialistId}`}
                    className="h-4 shrink-0 text-[9px] px-1 py-0 leading-4 rounded truncate border border-black/10"
                    style={{
                      backgroundColor: e.companyColor,
                      color: textColorForBackground(e.companyColor),
                    }}
                    title={`${e.specialistName} — ${e.companyName}`}
                  >
                    {e.specialistName}
                  </div>
                ))}
                {dayEntries.length > MAX_VISIBLE && (
                  <span className="text-[9px] text-muted-foreground px-0.5 leading-4 shrink-0">
                    +{dayEntries.length - MAX_VISIBLE} mais
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
