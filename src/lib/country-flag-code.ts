/** Normaliza nome do país para busca no mapa de bandeiras. */
function normalizeCountryKey(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Nomes e apelidos (PT/EN) → código ISO 3166-1 alpha-2 para flagcdn.com
 * Ordem: entradas mais longas primeiro no match parcial.
 */
const COUNTRY_FLAG_MAP: Record<string, string> = {
  "estados unidos": "us",
  "estados unidos da america": "us",
  "united states": "us",
  "united states of america": "us",
  eua: "us",
  usa: "us",
  "coreia do sul": "kr",
  "south korea": "kr",
  "coreia do norte": "kp",
  "north korea": "kp",
  "arabia saudita": "sa",
  "saudi arabia": "sa",
  "costa do marfim": "ci",
  "cote d'ivoire": "ci",
  "cote divoire": "ci",
  "republica tcheca": "cz",
  "czech republic": "cz",
  "czechia": "cz",
  "bosnia e herzegovina": "ba",
  "bosnia and herzegovina": "ba",
  "trinidad e tobago": "tt",
  "trinidad and tobago": "tt",
  "nova zelandia": "nz",
  "new zealand": "nz",
  "africa do sul": "za",
  "south africa": "za",
  "emirados arabes": "ae",
  "emirados arabes unidos": "ae",
  "united arab emirates": "ae",
  brasil: "br",
  brazil: "br",
  marrocos: "ma",
  morocco: "ma",
  argentina: "ar",
  uruguai: "uy",
  uruguay: "uy",
  paraguai: "py",
  paraguay: "py",
  chile: "cl",
  colombia: "co",
  equador: "ec",
  ecuador: "ec",
  peru: "pe",
  bolivia: "bo",
  venezuela: "ve",
  mexico: "mx",
  canada: "ca",
  "costa rica": "cr",
  jamaica: "jm",
  panama: "pa",
  honduras: "hn",
  "el salvador": "sv",
  guatemala: "gt",
  alemanha: "de",
  germany: "de",
  franca: "fr",
  france: "fr",
  espanha: "es",
  spain: "es",
  italia: "it",
  italy: "it",
  portugal: "pt",
  inglaterra: "gb-eng",
  england: "gb-eng",
  "reino unido": "gb",
  "united kingdom": "gb",
  holanda: "nl",
  netherlands: "nl",
  "paises baixos": "nl",
  belgica: "be",
  belgium: "be",
  croacia: "hr",
  croatia: "hr",
  servia: "rs",
  serbia: "rs",
  suica: "ch",
  switzerland: "ch",
  austria: "at",
  polonia: "pl",
  poland: "pl",
  ucrania: "ua",
  ukraine: "ua",
  turquia: "tr",
  turkey: "tr",
  dinamarca: "dk",
  denmark: "dk",
  suecia: "se",
  sweden: "se",
  noruega: "no",
  norway: "no",
  irlanda: "ie",
  ireland: "ie",
  escocia: "gb-sct",
  scotland: "gb-sct",
  gales: "gb-wls",
  wales: "gb-wls",
  hungria: "hu",
  hungary: "hu",
  romenia: "ro",
  romania: "ro",
  grecia: "gr",
  greece: "gr",
  finlandia: "fi",
  finland: "fi",
  islandia: "is",
  iceland: "is",
  eslovaquia: "sk",
  slovakia: "sk",
  eslovenia: "si",
  slovenia: "si",
  bulgaria: "bg",
  georgia: "ge",
  armenia: "am",
  albania: "al",
  macedonia: "mk",
  montenegro: "me",
  kosovo: "xk",
  luxemburgo: "lu",
  senegal: "sn",
  nigeria: "ng",
  gana: "gh",
  ghana: "gh",
  camarao: "cm",
  camaroes: "cm",
  cameroon: "cm",
  argelia: "dz",
  algeria: "dz",
  tunisia: "tn",
  tunisie: "tn",
  egito: "eg",
  egypt: "eg",
  mali: "ml",
  burkina: "bf",
  "burkina faso": "bf",
  gabao: "ga",
  gabon: "ga",
  angola: "ao",
  mocambique: "mz",
  mozambique: "mz",
  japao: "jp",
  japan: "jp",
  china: "cn",
  australia: "au",
  qatar: "qa",
  catar: "qa",
  ira: "ir",
  iran: "ir",
  iraque: "iq",
  iraq: "iq",
  india: "in",
  indonesia: "id",
  tailandia: "th",
  thailand: "th",
  vietna: "vn",
  vietnam: "vn",
  uzbequistao: "uz",
  uzbekistan: "uz",
  jordania: "jo",
  jordan: "jo",
  libano: "lb",
  lebanon: "lb",
  israel: "il",
  palestina: "ps",
  kuwait: "kw",
  bahrein: "bh",
  bahrain: "bh",
  oman: "om",
  omã: "om",
  haiti: "ht",
  cuba: "cu",
};

const SORTED_KEYS = Object.keys(COUNTRY_FLAG_MAP).sort((a, b) => b.length - a.length);

/** Caso o campo receba "Time A x Time B" (colado por engano), usa só o 1º nome. */
function firstTeamSegment(name: string): string {
  const raw = (name || "").trim();
  return raw.split(/\s+(?:x|vs\.?|versus)\s+/i)[0] || raw;
}

export function resolveFlagCodeFromCountryName(name: string): string {
  const normalized = normalizeCountryKey(firstTeamSegment(name));
  if (!normalized) return "xx";

  const exact = COUNTRY_FLAG_MAP[normalized];
  if (exact) return exact;

  for (const key of SORTED_KEYS) {
    if (normalized === key) return COUNTRY_FLAG_MAP[key];
    if (normalized.startsWith(`${key} `) || normalized.endsWith(` ${key}`)) {
      return COUNTRY_FLAG_MAP[key];
    }
    if (key.length >= 4 && new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized)) {
      return COUNTRY_FLAG_MAP[key];
    }
  }

  return "xx";
}

export function syncFlagsFromTeamNames(cfg: {
  team_home_name: string;
  team_away_name: string;
}): { team_home_flag: string; team_away_flag: string } {
  return {
    team_home_flag: resolveFlagCodeFromCountryName(cfg.team_home_name),
    team_away_flag: resolveFlagCodeFromCountryName(cfg.team_away_name),
  };
}
