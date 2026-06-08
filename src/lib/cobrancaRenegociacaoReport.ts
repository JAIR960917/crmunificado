import { supabase } from "@/integrations/supabase/client";
import { attendanceRangeBounds } from "@/lib/attendanceReport";

export type CobrancaRenegReportTotals = {
  /** Cobranças distintas + tarefas do crediário com trabalho real no período */
  tratados: number;
  /** Cobranças distintas com tentativa de contato ou tarefa manual no card */
  cobrancasTratadas: number;
  /** Tarefas manuais criadas no período (crediário + cards de cobrança) */
  tarefas: number;
  naoAtenderam: number;
  atenderam: number;
  renegociados: number;
  naoRenegociados: number;
  tarefasConcluidas: number;
};

type ContactCat = "renegociou" | "naoRenegociou" | "naoAtendeu" | "atendeuSemRenegociar";

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const inRange = (iso: string, startISO: string, endISO: string) =>
  iso >= startISO && iso <= endISO;

const isContactAttemptNote = (content: string) => content.startsWith("📞 Tentativa de contato");

const isSystemCobrancaActivity = (title: string | null | undefined) => {
  const t = title || "";
  return t.startsWith("Mudou de coluna:") || t.startsWith("WhatsApp enviado —");
};

const classifyCobrancaContactNote = (content: string): ContactCat | null => {
  if (!isContactAttemptNote(content)) return null;
  if (content.includes("NÃO ATENDEU")) return "naoAtendeu";
  if (content.includes("ATENDEU")) {
    if (content.includes("✅ Cliente RENEGOCIOU")) return "renegociou";
    if (content.includes("❌ Cliente NÃO renegociou")) return "naoRenegociou";
    return "atendeuSemRenegociar";
  }
  return null;
};

type CobActivityRow = {
  id: string;
  cobranca_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  title?: string | null;
};

type CrediarioTaskRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  renegociacao_status: string | null;
  completed_at: string | null;
};

const activityCountsAsTratado = (
  a: CobActivityRow,
  startISO: string,
  endISO: string,
) => {
  if (isSystemCobrancaActivity(a.title)) return false;
  if (inRange(a.created_at, startISO, endISO)) return true;
  if (inRange(a.updated_at, startISO, endISO) && a.updated_at !== a.created_at) return true;
  return false;
};

const crediarioCountsAsTratado = (
  t: CrediarioTaskRow,
  startISO: string,
  endISO: string,
) => {
  if (inRange(t.created_at, startISO, endISO)) return true;
  if (
    t.completed_at
    && inRange(t.completed_at, startISO, endISO)
    && t.renegociacao_status
  ) {
    return true;
  }
  return false;
};

export async function fetchCobrancaRenegociacaoReport(
  userId: string,
  startStr: string,
  endStr: string,
): Promise<CobrancaRenegReportTotals> {
  const { startISO, endISO } = attendanceRangeBounds(startStr, endStr);

  const [
    { data: cobNotes },
    { data: cobActivities },
    { data: crediarioCreated },
    { data: crediarioCompleted },
  ] = await Promise.all([
    supabase
      .from("crm_cobranca_notes")
      .select("user_id, cobranca_id, content, created_at")
      .eq("user_id", userId)
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("cobranca_activities")
      .select("id, cobranca_id, created_by, created_at, updated_at, title")
      .eq("created_by", userId)
      .gte("updated_at", startISO)
      .lte("updated_at", endISO),
    supabase
      .from("crediario_tasks")
      .select("id, user_id, created_at, updated_at, renegociacao_status, completed_at")
      .eq("user_id", userId)
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("crediario_tasks")
      .select("id, user_id, created_at, updated_at, renegociacao_status, completed_at")
      .eq("user_id", userId)
      .not("completed_at", "is", null)
      .not("renegociacao_status", "is", null)
      .gte("completed_at", startISO)
      .lte("completed_at", endISO),
  ]);

  const manualCobActivities = ((cobActivities || []) as CobActivityRow[]).filter((a) =>
    activityCountsAsTratado(a, startISO, endISO),
  );

  const cobrancasTratadasSet = new Set<string>();
  const tratadosSet = new Set<string>();

  (cobNotes || []).forEach((n: { cobranca_id: string; content: string }) => {
    if (!isContactAttemptNote(n.content || "")) return;
    cobrancasTratadasSet.add(n.cobranca_id);
    tratadosSet.add(`cobranca:${n.cobranca_id}`);
  });

  manualCobActivities.forEach((a) => {
    cobrancasTratadasSet.add(a.cobranca_id);
    tratadosSet.add(`cobranca:${a.cobranca_id}`);
  });

  const crediarioCreatedInPeriod = (crediarioCreated || []) as CrediarioTaskRow[];
  const crediarioCompletedInPeriod = (crediarioCompleted || []) as CrediarioTaskRow[];

  const crediarioWorked = new Map<string, CrediarioTaskRow>();
  crediarioCreatedInPeriod.forEach((t) => crediarioWorked.set(t.id, t));
  crediarioCompletedInPeriod.forEach((t) => {
    if (crediarioCountsAsTratado(t, startISO, endISO)) crediarioWorked.set(t.id, t);
  });

  crediarioWorked.forEach((t) => {
    if (crediarioCountsAsTratado(t, startISO, endISO)) {
      tratadosSet.add(`crediario:${t.id}`);
    }
  });

  let tarefasCobranca = 0;
  manualCobActivities.forEach((a) => {
    if (inRange(a.created_at, startISO, endISO)) tarefasCobranca += 1;
  });

  const tarefasCrediario = crediarioCreatedInPeriod.length;

  type LastEntry = { ts: number; cat: ContactCat };
  const latestPerCardDay = new Map<string, LastEntry>();

  (cobNotes || []).forEach((n: { user_id: string; cobranca_id: string; content: string; created_at: string }) => {
    const cat = classifyCobrancaContactNote(n.content || "");
    if (!cat) return;
    const ts = new Date(n.created_at).getTime();
    const key = `${n.user_id}|${dayKey(n.created_at)}|cobranca:${n.cobranca_id}`;
    const prev = latestPerCardDay.get(key);
    if (!prev || ts > prev.ts) latestPerCardDay.set(key, { ts, cat });
  });

  let renegociadosNotes = 0;
  let naoRenegociadosNotes = 0;
  let naoAtendeu = 0;
  let atendeuSemRenegociar = 0;

  latestPerCardDay.forEach((entry) => {
    if (entry.cat === "renegociou") renegociadosNotes += 1;
    else if (entry.cat === "naoRenegociou") naoRenegociadosNotes += 1;
    else if (entry.cat === "naoAtendeu") naoAtendeu += 1;
    else if (entry.cat === "atendeuSemRenegociar") atendeuSemRenegociar += 1;
  });

  let renegociadosTasks = 0;
  let naoRenegociadosTasks = 0;

  crediarioCompletedInPeriod.forEach((t) => {
    if (t.renegociacao_status === "sim") renegociadosTasks += 1;
    else if (t.renegociacao_status === "nao") naoRenegociadosTasks += 1;
  });

  const renegociados = renegociadosNotes + renegociadosTasks;
  const naoRenegociados = naoRenegociadosNotes + naoRenegociadosTasks;
  const atenderam = renegociadosNotes + naoRenegociadosNotes + atendeuSemRenegociar;
  const tarefas = tarefasCobranca + tarefasCrediario;

  return {
    tratados: tratadosSet.size,
    cobrancasTratadas: cobrancasTratadasSet.size,
    tarefas,
    naoAtenderam: naoAtendeu,
    atenderam,
    renegociados,
    naoRenegociados,
    tarefasConcluidas: crediarioCompletedInPeriod.length,
  };
}
