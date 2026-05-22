// Compute lead status from rule-based form fields (date_status_ranges + status_mapping).
// Mirrors the logic used at lead creation in NewLeadPage.tsx so we can re-evaluate
// the status later (e.g. after a tratativa is registered) without duplicating logic.

type DateStatusRange = { max_years: number; status_key: string };
type DateStatusConfig = { ranges: DateStatusRange[]; above_all: string; no_answer: string };

export type RuleField = {
  id: string;
  field_type: string;
  position?: number;
  status_mapping: Record<string, string> | null;
  date_status_ranges: DateStatusConfig | null;
};

export type ResolveOptions = {
  /** If a field's status_mapping points to any of these status keys, skip that field. */
  excludeFieldsMappingTo?: string[];
  /** Fallback status when no rule resolves. */
  fallbackStatus?: string;
};

export function resolveLeadStatusFromData(
  data: Record<string, any>,
  fields: RuleField[],
  options: ResolveOptions = {},
): string | null {
  const exclude = new Set(options.excludeFieldsMappingTo ?? []);

  const ruleFields = fields
    .filter(f =>
      (f.date_status_ranges && f.field_type === "date") ||
      (f.status_mapping && Object.keys(f.status_mapping).length > 0)
    )
    .filter(f => {
      if (exclude.size === 0) return true;
      if (!f.status_mapping) return true;
      // skip the field if ANY of its mapping values point to an excluded status
      return !Object.values(f.status_mapping).some(v => exclude.has(v));
    })
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Pass 1: try to resolve via answered rules
  for (const f of ruleFields) {
    const fieldKey = `field_${f.id}`;
    const answer = data[fieldKey];
    const hasAnswer = !(answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0));

    if (f.date_status_ranges && f.field_type === "date") {
      if (!hasAnswer) continue;
      const config = f.date_status_ranges;
      const diffMs = Date.now() - new Date(answer as string).getTime();
      const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
      const sortedRanges = [...config.ranges].sort((a, b) => a.max_years - b.max_years);
      for (const range of sortedRanges) {
        if (diffYears <= range.max_years && range.status_key) return range.status_key;
      }
      if (config.above_all) return config.above_all;
      continue;
    }

    if (f.status_mapping && Object.keys(f.status_mapping).length > 0) {
      if (!hasAnswer) continue;
      const mapping = f.status_mapping;
      if (typeof answer === "string" && mapping[answer]) return mapping[answer];
      if (Array.isArray(answer)) {
        for (const v of answer) {
          if (mapping[v]) return mapping[v];
        }
      }
      if (mapping["__any__"]) return mapping["__any__"];
    }
  }

  // Pass 2: fallback "no_answer" of the first unanswered date rule
  for (const f of ruleFields) {
    if (f.date_status_ranges && f.field_type === "date") {
      const fieldKey = `field_${f.id}`;
      const answer = data[fieldKey];
      const hasAnswer = !(answer === undefined || answer === null || (typeof answer === "string" && !answer.trim()));
      if (!hasAnswer && f.date_status_ranges.no_answer) {
        return f.date_status_ranges.no_answer;
      }
    }
  }

  return options.fallbackStatus ?? null;
}
