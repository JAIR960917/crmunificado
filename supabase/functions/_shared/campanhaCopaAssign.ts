import {
  pickRoundRobinUser,
  resolveRouteForCity,
  type CidadeLojaRoute,
} from "./campanhaCopaCidade.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

export async function loadCidadeLojaRoutes(supabase: SupabaseAdmin): Promise<CidadeLojaRoute[]> {
  const { data } = await supabase
    .from("campanha_copa_cidade_lojas")
    .select("id, cidade_label, company_id");
  return (data || []) as CidadeLojaRoute[];
}

export async function getEligibleAssigneesForCompany(
  supabase: SupabaseAdmin,
  companyId: string,
): Promise<string[]> {
  const { data: profs } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("company_id", companyId);

  const userIds = ((profs || []) as { user_id: string }[]).map((p) => p.user_id);
  if (userIds.length === 0) return [];

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", userIds);

  return ((roles || []) as { user_id: string; role: string }[])
    .filter((r) => r.role === "vendedor" || r.role === "gerente")
    .map((r) => r.user_id);
}

export async function pickAssigneeForCity(
  supabase: SupabaseAdmin,
  cidade: string,
  routes: CidadeLojaRoute[],
): Promise<string | null> {
  const route = resolveRouteForCity(cidade, routes);
  if (!route) return null;

  const eligible = await getEligibleAssigneesForCompany(supabase, route.company_id);
  if (eligible.length === 0) return null;

  const { data: rr } = await supabase
    .from("campanha_copa_round_robin")
    .select("last_user_id")
    .eq("company_id", route.company_id)
    .maybeSingle();

  const nextUser = pickRoundRobinUser(eligible, rr?.last_user_id);
  if (!nextUser) return null;

  await supabase.from("campanha_copa_round_robin").upsert({
    company_id: route.company_id,
    last_user_id: nextUser,
    updated_at: new Date().toISOString(),
  });

  return nextUser;
}
