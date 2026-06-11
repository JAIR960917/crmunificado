/** Subcampos fixos do teste de acuidade visual (Adam Robo e demais fluxos). */
export const VISUAL_ACUITY_FIELDS = [
  { key: "od_longe", label: "OD Longe" },
  { key: "oe_longe", label: "OE Longe" },
  { key: "oe_perto", label: "OE Perto" },
  { key: "od_perto", label: "OD Perto" },
] as const;

export type VisualAcuityKey = (typeof VISUAL_ACUITY_FIELDS)[number]["key"];

export type VisualAcuityValue = Record<VisualAcuityKey, string>;

export function emptyVisualAcuity(): VisualAcuityValue {
  return { od_longe: "", oe_longe: "", oe_perto: "", od_perto: "" };
}

export function parseVisualAcuity(raw: unknown): VisualAcuityValue {
  const base = emptyVisualAcuity();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  for (const { key } of VISUAL_ACUITY_FIELDS) {
    if (o[key] !== undefined && o[key] !== null) {
      base[key] = String(o[key]).replace(/%/g, "").trim();
    }
  }
  return base;
}

export function formatVisualAcuityDisplay(raw: unknown): string {
  const v = parseVisualAcuity(raw);
  const parts = VISUAL_ACUITY_FIELDS.map(({ key, label }) => {
    const pct = v[key]?.trim();
    return pct ? `${label}: ${pct}%` : null;
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Uma medida por linha — ideal para a tela de revisão. */
export function formatVisualAcuityReview(raw: unknown): string {
  const v = parseVisualAcuity(raw);
  const lines = VISUAL_ACUITY_FIELDS.map(({ key, label }) => {
    const pct = v[key]?.trim();
    return `${label}: ${pct ? `${pct}%` : "—"}`;
  });
  return lines.join("\n");
}

export function isVisualAcuityEmpty(raw: unknown): boolean {
  const v = parseVisualAcuity(raw);
  return VISUAL_ACUITY_FIELDS.every(({ key }) => !v[key]?.trim());
}

export function isVisualAcuityComplete(raw: unknown): boolean {
  const v = parseVisualAcuity(raw);
  return VISUAL_ACUITY_FIELDS.every(({ key }) => {
    const n = Number(v[key]);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  });
}

/** Obrigatório = os 4 preenchidos com 0–100. Opcional = vazio ou os 4 completos. */
export function isVisualAcuityValid(raw: unknown, required: boolean): boolean {
  if (!required) {
    if (isVisualAcuityEmpty(raw)) return true;
    return isVisualAcuityComplete(raw);
  }
  return isVisualAcuityComplete(raw);
}

export function clampPercentInput(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 3);
  if (!digits) return "";
  const n = Math.min(100, parseInt(digits, 10));
  return String(n);
}
