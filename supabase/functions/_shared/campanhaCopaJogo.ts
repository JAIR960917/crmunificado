import { syncFlagsFromTeamNames } from "./countryFlagCode.ts";

export type CampanhaCopaJogoConfig = {
  team_home_name: string;
  team_away_name: string;
  team_home_flag: string;
  team_away_flag: string;
  match_meta: string;
};

export const DEFAULT_CAMPANHA_COPA_JOGO: CampanhaCopaJogoConfig = {
  team_home_name: "Brasil",
  team_away_name: "Marrocos",
  team_home_flag: "br",
  team_away_flag: "ma",
  match_meta: "Nova Jersey · 13/06 · Sábado · 19:00",
};

export const CAMPANHA_COPA_JOGO_SETTING_KEY = "campanha_copa_jogo_config";

export function slugTeam(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Chave única do confronto — independe da ordem casa/fora na tela. */
export function buildJogoKey(home: string, away: string): string {
  const slugs = [slugTeam(home), slugTeam(away)].filter(Boolean).sort();
  return slugs.join("_");
}

export function buildJogoLabel(home: string, away: string): string {
  return `${home.trim()} x ${away.trim()}`;
}

export function parseJogoConfig(raw: string | null | undefined): CampanhaCopaJogoConfig {
  if (!raw?.trim()) return { ...DEFAULT_CAMPANHA_COPA_JOGO };
  try {
    const parsed = JSON.parse(raw) as Partial<CampanhaCopaJogoConfig>;
    const base = {
      team_home_name: String(parsed.team_home_name || DEFAULT_CAMPANHA_COPA_JOGO.team_home_name).trim(),
      team_away_name: String(parsed.team_away_name || DEFAULT_CAMPANHA_COPA_JOGO.team_away_name).trim(),
      match_meta: String(parsed.match_meta ?? DEFAULT_CAMPANHA_COPA_JOGO.match_meta).trim(),
    };
    const flags = syncFlagsFromTeamNames(base);
    return { ...base, ...flags };
  } catch {
    return { ...DEFAULT_CAMPANHA_COPA_JOGO };
  }
}

export function normalizeFlagCode(code: string): string {
  return (code || "").trim().toLowerCase().replace(/[^a-z-]/g, "").slice(0, 6);
}

export async function loadCampanhaCopaJogoConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<CampanhaCopaJogoConfig & { jogo_key: string; jogo_label: string }> {
  const { data } = await supabase
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", CAMPANHA_COPA_JOGO_SETTING_KEY)
    .maybeSingle();

  const cfg = parseJogoConfig(data?.setting_value);
  return {
    ...cfg,
    jogo_key: buildJogoKey(cfg.team_home_name, cfg.team_away_name),
    jogo_label: buildJogoLabel(cfg.team_home_name, cfg.team_away_name),
  };
}
