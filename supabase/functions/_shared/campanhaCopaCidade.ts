export type CidadeLojaRoute = {
  id: string;
  cidade_label: string;
  company_id: string;
};

export function normalizeCityKey(cidade: string): string {
  return (cidade || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/\-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function cityBaseKey(cidade: string): string {
  const n = normalizeCityKey(cidade);
  return n.split(/[/\-]/)[0]?.trim() || n;
}

export function matchCityToRoute(submissionCity: string, routeLabel: string): boolean {
  const s = normalizeCityKey(submissionCity);
  const r = normalizeCityKey(routeLabel);
  if (!s || !r) return false;
  if (s === r) return true;

  const sBase = cityBaseKey(submissionCity);
  const rBase = cityBaseKey(routeLabel);
  if (sBase && rBase && sBase === rBase) return true;
  if (sBase && r.includes(sBase)) return true;
  if (rBase && s.includes(rBase)) return true;
  return false;
}

export function resolveRouteForCity(
  cidade: string,
  routes: CidadeLojaRoute[],
): CidadeLojaRoute | null {
  if (!cidade?.trim()) return null;
  return routes.find((route) => matchCityToRoute(cidade, route.cidade_label)) ?? null;
}

export function pickRoundRobinUser(
  eligibleUserIds: string[],
  lastUserId: string | null | undefined,
): string | null {
  if (eligibleUserIds.length === 0) return null;
  const sorted = [...eligibleUserIds].sort();
  if (!lastUserId) return sorted[0];
  const idx = sorted.indexOf(lastUserId);
  if (idx < 0) return sorted[0];
  return sorted[(idx + 1) % sorted.length];
}
