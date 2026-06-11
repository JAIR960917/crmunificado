import { supabase } from "@/integrations/supabase/client";

export type AttendanceProfile = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  company_id: string | null;
};

export type AttendanceCompany = { id: string; name: string };

export type AttendanceSellerRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  company_id: string | null;
  company_name: string;
  adicionados: number;
  tratados: number;
  naoAtenderam: number;
  atenderam: number;
  agendaram: number;
  naoAgendaram: number;
  /** Consultas criadas no CRM (crm_appointments) no período */
  agendamentos: number;
};

export const attendanceRangeBounds = (startStr: string, endStr: string) => {
  const [ys, ms, ds] = startStr.split("-").map(Number);
  const [ye, me, de] = endStr.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
  const end = new Date(ye, me - 1, de, 23, 59, 59, 999);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

type ContactCat = "agendou" | "naoAtendeu" | "atendeuSemAgendar";

const classifyContactNote = (content: string): ContactCat | null => {
  if (!content.startsWith("📞 Tentativa de contato")) return null;
  if (content.includes("NÃO ATENDEU")) return "naoAtendeu";
  if (content.includes("ATENDEU")) {
    if (content.includes("✅ Consulta marcada")) return "agendou";
    return "atendeuSemAgendar";
  }
  return null;
};

const isContactAttemptNote = (content: string) => content.startsWith("📞 Tentativa de contato");

const isSystemColumnActivity = (title: string | null | undefined) =>
  (title || "").startsWith("Mudou de coluna:");

const activityCountsAsTratado = (
  a: { created_at: string; updated_at: string; title?: string | null },
  startISO: string,
  endISO: string,
) => {
  if (isSystemColumnActivity(a.title)) return false;
  if (a.created_at >= startISO && a.created_at <= endISO) return true;
  if (a.updated_at >= startISO && a.updated_at <= endISO && a.updated_at !== a.created_at) return true;
  return false;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
};

const resolveUserDisplayName = (
  uid: string,
  profById: Map<string, AttendanceProfile>,
  roleByUser: Map<string, string>,
): string => {
  const p = profById.get(uid);
  if (p?.full_name?.trim()) return p.full_name.trim();
  const role = roleByUser.get(uid);
  if (role) return `${ROLE_LABELS[role] || role} (sem perfil)`;
  return `Conta removida (${uid.slice(0, 8)})`;
};

const addToSetMap = (map: Map<string, Set<string>>, uid: string, key: string) => {
  if (!map.has(uid)) map.set(uid, new Set());
  map.get(uid)!.add(key);
};

export type AttendanceReportTotals = {
  adicionados: number;
  tratados: number;
  naoAtenderam: number;
  atenderam: number;
  agendaram: number;
  naoAgendaram: number;
  agendamentos: number;
};

export type AttendanceReportResult = {
  rows: AttendanceSellerRow[];
  profiles: AttendanceProfile[];
  companies: AttendanceCompany[];
  vendedorIds: Set<string>;
  /** Totais globais (leads únicos, sem somar vendedores) */
  uniqueTotals: AttendanceReportTotals;
};

export async function fetchAttendanceReport(startStr: string, endStr: string): Promise<AttendanceReportResult> {
  const { startISO, endISO } = attendanceRangeBounds(startStr, endStr);

  const [{ data: profilesData }, { data: companiesData }, { data: adminRoles }, { data: rolesData }] =
    await Promise.all([
      supabase.from("profiles").select("user_id, full_name, avatar_url, company_id"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
      supabase.from("user_roles").select("user_id, role"),
    ]);

  const profs = (profilesData || []) as AttendanceProfile[];
  const profById = new Map(profs.map((p) => [p.user_id, p]));
  const comps = (companiesData || []) as AttendanceCompany[];
  const adminSet = new Set<string>((adminRoles || []).map((r: { user_id: string }) => r.user_id));
  const roleByUser = new Map<string, string>(
    (rolesData || []).map((r: { user_id: string; role: string }) => [r.user_id, r.role]),
  );
  const vendSet = new Set(
    (rolesData || [])
      .filter((r: { role: string }) => r.role === "vendedor")
      .map((r: { user_id: string }) => r.user_id),
  );
  const compById = new Map(comps.map((c) => [c.id, c.name]));

  const [
    { data: createdLeads },
    { data: leadNotes },
    { data: renovNotes },
    { data: leadActivities },
    { data: renovacaoActivities },
    { data: appointments },
  ] = await Promise.all([
    supabase
      .from("crm_leads")
      .select("id, created_by, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("crm_lead_notes")
      .select("user_id, lead_id, content, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("crm_renovacao_notes")
      .select("user_id, renovacao_id, content, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("lead_activities")
      .select("lead_id, created_by, created_at, updated_at, title")
      .gte("updated_at", startISO)
      .lte("updated_at", endISO),
    supabase
      .from("renovacao_activities")
      .select("renovacao_id, created_by, created_at, updated_at, title")
      .gte("updated_at", startISO)
      .lte("updated_at", endISO),
    supabase
      .from("crm_appointments")
      .select("id, scheduled_by, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .is("deleted_at", null)
      .eq("is_reschedule_snapshot", false),
  ]);

  const renovNotesInRange = (renovNotes || []) as { user_id: string; renovacao_id: string; content: string; created_at: string }[];

  const adicionadosMap = new Map<string, Set<string>>();
  const globalAdicionados = new Set<string>();
  (createdLeads || []).forEach((l: { id: string; created_by: string | null }) => {
    if (!l.created_by || adminSet.has(l.created_by)) return;
    addToSetMap(adicionadosMap, l.created_by, l.id);
    globalAdicionados.add(l.id);
  });

  /** Tratados = cards únicos (lead ou renovação) com tentativa de contato ou tarefa manual */
  const tratadosMap = new Map<string, Set<string>>();
  const globalTratados = new Set<string>();

  const markCardTratado = (uid: string, cardKey: string) => {
    addToSetMap(tratadosMap, uid, cardKey);
    globalTratados.add(cardKey);
  };

  (leadNotes || []).forEach((n: { user_id: string; lead_id: string; content: string }) => {
    if (adminSet.has(n.user_id) || !isContactAttemptNote(n.content || "")) return;
    markCardTratado(n.user_id, `lead:${n.lead_id}`);
  });

  renovNotesInRange.forEach((n) => {
    if (adminSet.has(n.user_id) || !isContactAttemptNote(n.content || "")) return;
    markCardTratado(n.user_id, `renovacao:${n.renovacao_id}`);
  });

  (
    (leadActivities || []) as {
      lead_id: string;
      created_by: string;
      created_at: string;
      updated_at: string;
      title?: string | null;
    }[]
  ).forEach((a) => {
    if (adminSet.has(a.created_by)) return;
    if (!activityCountsAsTratado(a, startISO, endISO)) return;
    markCardTratado(a.created_by, `lead:${a.lead_id}`);
  });

  (
    (renovacaoActivities || []) as {
      renovacao_id: string;
      created_by: string;
      created_at: string;
      updated_at: string;
      title?: string | null;
    }[]
  ).forEach((a) => {
    if (adminSet.has(a.created_by)) return;
    if (!activityCountsAsTratado(a, startISO, endISO)) return;
    markCardTratado(a.created_by, `renovacao:${a.renovacao_id}`);
  });

  type LastEntry = { ts: number; cat: ContactCat };
  const latestPerCardDay = new Map<string, LastEntry>();

  const ingestOutcomeNote = (
    noteUserId: string,
    cardType: "lead" | "renovacao",
    cardId: string,
    content: string,
    createdAt: string,
  ) => {
    if (adminSet.has(noteUserId)) return;
    const cat = classifyContactNote(content);
    if (!cat) return;
    const ts = new Date(createdAt).getTime();
    const key = `${noteUserId}|${dayKey(createdAt)}|${cardType}:${cardId}`;
    const prev = latestPerCardDay.get(key);
    if (!prev || ts > prev.ts) latestPerCardDay.set(key, { ts, cat });
  };

  (leadNotes || []).forEach((n: { user_id: string; lead_id: string; content: string; created_at: string }) =>
    ingestOutcomeNote(n.user_id, "lead", n.lead_id, n.content || "", n.created_at),
  );
  renovNotesInRange.forEach((n) =>
    ingestOutcomeNote(n.user_id, "renovacao", n.renovacao_id, n.content || "", n.created_at),
  );

  const agendou = new Map<string, number>();
  const naoAtendeu = new Map<string, number>();
  const atendeuSemAgendar = new Map<string, number>();

  latestPerCardDay.forEach((entry, key) => {
    const parts = key.split("|");
    const cardKey = parts[2] || "";
    if (!cardKey.startsWith("lead:") && !cardKey.startsWith("renovacao:")) return;
    const uid = parts[0];
    const target =
      entry.cat === "agendou" ? agendou : entry.cat === "naoAtendeu" ? naoAtendeu : atendeuSemAgendar;
    target.set(uid, (target.get(uid) || 0) + 1);
  });

  const agendamentosMap = new Map<string, number>();
  (appointments || []).forEach((a: { scheduled_by: string }) => {
    if (adminSet.has(a.scheduled_by)) return;
    agendamentosMap.set(a.scheduled_by, (agendamentosMap.get(a.scheduled_by) || 0) + 1);
  });

  const userIds = new Set<string>([
    ...tratadosMap.keys(),
    ...adicionadosMap.keys(),
    ...agendou.keys(),
    ...naoAtendeu.keys(),
    ...atendeuSemAgendar.keys(),
    ...agendamentosMap.keys(),
  ]);

  const globalNaoAtendeu = new Set<string>();
  const globalAtendeu = new Set<string>();
  const globalAgendou = new Set<string>();
  const globalSemAgendar = new Set<string>();
  latestPerCardDay.forEach((entry, key) => {
    const parts = key.split("|");
    const cardKey = parts[2] || "";
    if (!cardKey.startsWith("lead:") && !cardKey.startsWith("renovacao:")) return;
    if (entry.cat === "naoAtendeu") globalNaoAtendeu.add(cardKey);
    else if (entry.cat === "agendou") {
      globalAgendou.add(cardKey);
      globalAtendeu.add(cardKey);
    } else if (entry.cat === "atendeuSemAgendar") {
      globalSemAgendar.add(cardKey);
      globalAtendeu.add(cardKey);
    }
  });

  const rows: AttendanceSellerRow[] = Array.from(userIds).map((uid) => {
    const p = profById.get(uid);
    const ag = agendou.get(uid) || 0;
    const semAg = atendeuSemAgendar.get(uid) || 0;
    return {
      user_id: uid,
      full_name: resolveUserDisplayName(uid, profById, roleByUser),
      avatar_url: p?.avatar_url || null,
      company_id: p?.company_id || null,
      company_name: p?.company_id ? compById.get(p.company_id) || "—" : "—",
      adicionados: adicionadosMap.get(uid)?.size || 0,
      tratados: tratadosMap.get(uid)?.size || 0,
      naoAtenderam: naoAtendeu.get(uid) || 0,
      atenderam: ag + semAg,
      agendaram: ag,
      naoAgendaram: semAg,
      agendamentos: agendamentosMap.get(uid) || 0,
    };
  });

  rows.sort((a, b) => b.tratados - a.tratados);

  const uniqueTotals: AttendanceReportTotals = {
    adicionados: globalAdicionados.size,
    tratados: globalTratados.size,
    naoAtenderam: globalNaoAtendeu.size,
    atenderam: globalAtendeu.size,
    agendaram: globalAgendou.size,
    naoAgendaram: globalSemAgendar.size,
    agendamentos: Array.from(agendamentosMap.values()).reduce((s, n) => s + n, 0),
  };

  return {
    rows,
    profiles: profs.filter((p) => !adminSet.has(p.user_id)),
    companies: comps,
    vendedorIds: vendSet,
    uniqueTotals,
  };
}
