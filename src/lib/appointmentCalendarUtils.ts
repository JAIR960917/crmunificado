import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";

export type CalendarViewMode = "month" | "week" | "day";

export function getCalendarQueryRange(focusDate: Date, view: CalendarViewMode) {
  if (view === "month") {
    const monthStart = startOfMonth(focusDate);
    const monthEnd = endOfMonth(focusDate);
    return {
      queryStart: startOfWeek(monthStart, { weekStartsOn: 0 }),
      queryEnd: endOfWeek(monthEnd, { weekStartsOn: 0 }),
      label: format(focusDate, "MMMM 'de' yyyy", { locale: ptBR }),
    };
  }
  if (view === "week") {
    const weekStart = startOfWeek(focusDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(focusDate, { weekStartsOn: 0 });
    return {
      queryStart: weekStart,
      queryEnd: weekEnd,
      label: `${format(weekStart, "d MMM", { locale: ptBR })} – ${format(weekEnd, "d MMM yyyy", { locale: ptBR })}`,
    };
  }
  return {
    queryStart: startOfDay(focusDate),
    queryEnd: endOfDay(focusDate),
    label: format(focusDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR }),
  };
}

export function shiftFocusDate(focusDate: Date, view: CalendarViewMode, dir: -1 | 1) {
  if (view === "month") return dir === 1 ? addMonths(focusDate, 1) : subMonths(focusDate, 1);
  if (view === "week") return dir === 1 ? addWeeks(focusDate, 1) : subWeeks(focusDate, 1);
  return addDays(focusDate, dir);
}

export function buildMonthGrid(focusDate: Date): Date[] {
  const monthStart = startOfMonth(focusDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function buildWeekDays(focusDate: Date): Date[] {
  const weekStart = startOfWeek(focusDate, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export const WEEKDAY_LABELS = ["DOM.", "SEG.", "TER.", "QUA.", "QUI.", "SEX.", "SÁB."];

export const HOUR_SLOTS = Array.from({ length: 14 }, (_, i) => i + 7);

export function dayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function isConsultaPaga(appt: { consulta_paga: boolean | null }) {
  return appt.consulta_paga === true;
}

/** Duração padrão exibida no grid quando não há horário de término */
export const CALENDAR_EVENT_DURATION_MIN = 30;

export const CALENDAR_GRID_START_HOUR = 7;
export const CALENDAR_GRID_END_HOUR = 20;

type TimedEvent<T> = {
  item: T;
  startMin: number;
  endMin: number;
};

function timedEventsOverlap(a: TimedEvent<unknown>, b: TimedEvent<unknown>) {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

function toTimedEvent<T extends { scheduled_datetime: string }>(item: T): TimedEvent<T> {
  const dt = new Date(item.scheduled_datetime);
  const startMin = dt.getHours() * 60 + dt.getMinutes();
  return {
    item,
    startMin,
    endMin: startMin + CALENDAR_EVENT_DURATION_MIN,
  };
}

function overlapClusters<T>(events: TimedEvent<T>[]): TimedEvent<T>[][] {
  if (events.length === 0) return [];
  const parent = events.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (timedEventsOverlap(events[i], events[j])) union(i, j);
    }
  }
  const groups = new Map<number, TimedEvent<T>[]>();
  events.forEach((ev, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ev);
  });
  return [...groups.values()];
}

function layoutCluster<T extends { scheduled_datetime: string }>(
  cluster: TimedEvent<T>[],
): Array<{ item: T; column: number; columns: number; startMin: number; endMin: number }> {
  const sorted = [...cluster].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const columnEnds: number[] = [];
  const placed: Array<{ ev: TimedEvent<T>; column: number }> = [];

  for (const ev of sorted) {
    let col = columnEnds.findIndex((end) => end <= ev.startMin);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(ev.endMin);
    } else {
      columnEnds[col] = ev.endMin;
    }
    placed.push({ ev, column: col });
  }

  const totalCols = columnEnds.length;
  return placed.map(({ ev, column }) => ({
    item: ev.item,
    column,
    columns: totalCols,
    startMin: ev.startMin,
    endMin: ev.endMin,
  }));
}

export type CalendarEventLayout<T extends { scheduled_datetime: string }> = {
  item: T;
  top: number;
  height: number;
  column: number;
  columns: number;
};

/** Posiciona eventos lado a lado quando compartilham o mesmo horário */
export function layoutTimedAppointments<T extends { scheduled_datetime: string }>(
  items: T[],
  slotHeightPx: number,
): CalendarEventLayout<T>[] {
  const gridStart = CALENDAR_GRID_START_HOUR * 60;
  const gridEnd = CALENDAR_GRID_END_HOUR * 60;

  const inRange = items
    .map(toTimedEvent)
    .filter((e) => e.startMin >= gridStart && e.startMin < gridEnd);

  const layouts: CalendarEventLayout<T>[] = [];
  for (const cluster of overlapClusters(inRange)) {
    for (const slot of layoutCluster(cluster)) {
      const top = (slot.startMin - gridStart) * (slotHeightPx / 60);
      const height = Math.max(
        slotHeightPx * 0.75,
        ((slot.endMin - slot.startMin) / 60) * slotHeightPx,
      );
      layouts.push({
        item: slot.item,
        top,
        height,
        column: slot.column,
        columns: slot.columns,
      });
    }
  }
  return layouts;
}

export { isSameDay, isSameMonth, format, ptBR, startOfDay };
