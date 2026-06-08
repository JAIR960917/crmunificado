import { format } from "date-fns";

export const DEFAULT_COMPANY_EXAM_COLORS = [
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#84CC16",
] as const;

export type EyeExamSpecialist = {
  id: string;
  name: string;
  active: boolean;
};

export type CompanyWithExamColor = {
  id: string;
  name: string;
  exam_schedule_color: string | null;
};

export type SpecialistScheduleEntry = {
  examDate: string;
  companyId: string;
  companyName: string;
  companyColor: string;
  specialistId: string;
  specialistName: string;
  eyeExamDayId: string;
};

export function toExamDateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function resolveCompanyExamColor(
  company: Pick<CompanyWithExamColor, "id" | "exam_schedule_color">,
  companyIndex = 0,
): string {
  if (company.exam_schedule_color?.trim()) return company.exam_schedule_color.trim();
  return DEFAULT_COMPANY_EXAM_COLORS[companyIndex % DEFAULT_COMPANY_EXAM_COLORS.length];
}

export function textColorForBackground(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#111827" : "#ffffff";
}

type RawScheduleRow = {
  exam_date: string;
  company_id: string;
  eye_exam_day_id: string;
  companies: { id: string; name: string; exam_schedule_color: string | null } | null;
  eye_exam_specialists: { id: string; name: string } | null;
};

export function mapScheduleRows(
  rows: RawScheduleRow[],
  companyColorIndex: Map<string, number>,
): SpecialistScheduleEntry[] {
  return rows
    .filter((r) => r.companies && r.eye_exam_specialists)
    .map((r) => {
      const company = r.companies!;
      const specialist = r.eye_exam_specialists!;
      const idx = companyColorIndex.get(company.id) ?? 0;
      return {
        examDate: String(r.exam_date).slice(0, 10),
        companyId: r.company_id,
        companyName: company.name,
        companyColor: resolveCompanyExamColor(company, idx),
        specialistId: specialist.id,
        specialistName: specialist.name,
        eyeExamDayId: r.eye_exam_day_id,
      };
    });
}

export function groupScheduleByDay(entries: SpecialistScheduleEntry[]): Map<string, SpecialistScheduleEntry[]> {
  const map = new Map<string, SpecialistScheduleEntry[]>();
  for (const e of entries) {
    if (!map.has(e.examDate)) map.set(e.examDate, []);
    map.get(e.examDate)!.push(e);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.specialistName.localeCompare(b.specialistName, "pt-BR"));
  }
  return map;
}
