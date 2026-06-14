import { isVisualAcuityValid } from "@/lib/visualAcuity";
import { parseCidadeUf } from "@/lib/brazilLocations";

type FieldLike = { field_type: string; is_required: boolean };

export function isFormFieldValueMissing(field: FieldLike, val: unknown): boolean {
  if (!field.is_required) return false;
  if (field.field_type === "visual_acuity") {
    return !isVisualAcuityValid(val, true);
  }
  if (val === undefined || val === null || val === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (field.field_type === "cidade_estado") {
    const { cidade, uf } = parseCidadeUf(String(val));
    if (!cidade || !uf) return true;
  }
  return false;
}
