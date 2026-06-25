import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format, isSameDay, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck, Plus, Trash2, CalendarIcon, Undo2, ChevronLeft, ChevronRight, AlertTriangle, List, Users } from "lucide-react";
import AppointmentsCalendar from "@/components/appointments/AppointmentsCalendar";
import AppointmentsListTable from "@/components/appointments/AppointmentsListTable";
import SpecialistScheduleCalendar from "@/components/appointments/SpecialistScheduleCalendar";
import {
  parseWorkPeriod,
  resolveCompanyExamColor,
  type CompanyWithExamColor,
  type EyeExamDayCellInfo,
  type EyeExamSpecialist,
  type SpecialistScheduleEntry,
} from "@/lib/eyeExamSchedule";
import {
  getCalendarQueryRange,
  shiftFocusDate,
  type CalendarViewMode,
} from "@/lib/appointmentCalendarUtils";
import { cn } from "@/lib/utils";
import { isRealtimeEnabled } from "@/lib/runtime-config";
import {
  CANAIS_AGENDAMENTO,
  FORMAS_PAGAMENTO_CONSULTA,
  FORMAS_PAGAMENTO_OCULOS,
  formaConsultaSemValor,
  formatRescheduleNote,
  isAppointmentInactive,
  isMovedToOrcamentos,
  isRescheduleSnapshotVisibleToUser,
  closeAppointmentRescheduleSnapshots,
  logAppointmentHistory,
} from "@/lib/appointmentUtils";
import AppointmentHistoryPanel from "@/components/appointments/AppointmentHistoryPanel";

type ProdutoItem = { nome: string; valor: string };

type Appointment = {
  id: string;
  lead_id: string | null;
  renovacao_id: string | null;
  scheduled_by: string;
  scheduled_datetime: string;
  valor: number;
  forma_pagamento: string;
  forma_pagamento_consulta: string | null;
  consulta_a_receber: string | null;
  consulta_a_receber_updated_at: string | null;
  consulta_paga: boolean | null;
  consulta_paga_em: string | null;
  consulta_paga_por: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  returned_at: string | null;
  returned_by: string | null;
  canal_agendamento: string;
  confirmacao: string;
  comparecimento: string;
  venda: string;
  resumo: string;
  previous_status: string;
  status: string;
  nome: string;
  telefone: string;
  idade: string;
  nao_vendido_motivo?: string | null;
  fez_orcamento?: boolean | null;
  orcamento_valor?: number | null;
  orcamento_produtos?: string | null;
  orcamento_produtos_itens?: ProdutoItem[] | null;
  orcamento_observacao?: string | null;
  forma_pagamento_oculos?: string | null;
  original_scheduled_datetime?: string | null;
  rescheduled_from_datetime?: string | null;
  rescheduled_to_datetime?: string | null;
  is_reschedule_snapshot?: boolean;
  snapshot_of_appointment_id?: string | null;
};

type Profile = { user_id: string; full_name: string };

const sortAppointmentsByTime = (list: Appointment[]) =>
  [...list].sort(
    (a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime(),
  );

const CONFIRMACAO_OPTIONS = ["Pendente", "Confirmado", "Cancelado"];
const COMPARECIMENTO_OPTIONS = ["Pendente", "Compareceu", "Não Compareceu"];
const VENDA_OPTIONS = ["Pendente", "Vendido", "Gerou Orçamento", "Não Gerou Orçamento", "Laudo", "Doença no Olho"];

type Company = CompanyWithExamColor;
type ProfileFull = { user_id: string; full_name: string; company_id: string | null };
type PageMode = "appointments" | "specialist-schedule";

export default function AppointmentsPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesFull, setProfilesFull] = useState<ProfileFull[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [calendarView, setCalendarView] = useState<CalendarViewMode>("month");
  const [listDay, setListDay] = useState<Date | null>(null);
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");
  const [userCompanyId, setUserCompanyId] = useState<string | null>(null);
  const [eyeExamDayKeys, setEyeExamDayKeys] = useState<Set<string>>(new Set());
  const [eyeExamDayDetails, setEyeExamDayDetails] = useState<Map<string, EyeExamDayCellInfo[]>>(new Map());
  const [pageMode, setPageMode] = useState<PageMode>("appointments");
  const [filterSpecialistId, setFilterSpecialistId] = useState<string>("all");
  const [specialists, setSpecialists] = useState<EyeExamSpecialist[]>([]);
  const [specialistSchedule, setSpecialistSchedule] = useState<SpecialistScheduleEntry[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [saving, setSaving] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formTelefone, setFormTelefone] = useState("");
  const [formIdade, setFormIdade] = useState("");
  const [formCanal, setFormCanal] = useState("Loja");
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formTime, setFormTime] = useState("09:00");
  const [formValor, setFormValor] = useState("");
  const [formPagamentoOculos, setFormPagamentoOculos] = useState("");
  const [formPagamentoConsulta, setFormPagamentoConsulta] = useState("");
  const [formConsultaPaga, setFormConsultaPaga] = useState("");
  const [formConfirmacao, setFormConfirmacao] = useState("Pendente");
  const [formComparecimento, setFormComparecimento] = useState("Pendente");
  const [formVenda, setFormVenda] = useState("Pendente");
  const [formResumo, setFormResumo] = useState("");
  const [formRescheduleDate, setFormRescheduleDate] = useState<Date | undefined>();
  const [formRescheduleTime, setFormRescheduleTime] = useState("09:00");
  const [rescheduling, setRescheduling] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Return to Leads confirmation
  const [returnId, setReturnId] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  // Sale dialog (when "Vendido" is selected)
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [saleApptId, setSaleApptId] = useState<string | null>(null);
  const [saleValor, setSaleValor] = useState("");
  const [salePagamento, setSalePagamento] = useState("");
  const [saleSaving, setSaleSaving] = useState(false);

  // Não Vendido / Gerou Orçamento dialog
  const [nvDialogOpen, setNvDialogOpen] = useState(false);
  const [nvApptId, setNvApptId] = useState<string | null>(null);
  const [nvVendaTipo, setNvVendaTipo] = useState<"Gerou Orçamento" | "Não Gerou Orçamento">("Gerou Orçamento");
  const [nvMotivo, setNvMotivo] = useState("");
  const [nvValor, setNvValor] = useState("");
  const [nvProdutosItens, setNvProdutosItens] = useState<ProdutoItem[]>([{ nome: "", valor: "" }]);
  const [nvObservacao, setNvObservacao] = useState("");
  const [nvSaving, setNvSaving] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);



  const fetchEyeExamDays = useCallback(async () => {
    if (!isAdmin && !userCompanyId) {
      setEyeExamDayKeys(new Set());
      setEyeExamDayDetails(new Map());
      return;
    }

    const { queryStart, queryEnd } = getCalendarQueryRange(focusDate, calendarView);
    const selectFields = isAdmin
      ? "exam_date"
      : `
        exam_date,
        company_eye_exam_day_specialists (
          work_period,
          eye_exam_specialists ( name, active )
        )
      `;
    let query = supabase
      .from("company_eye_exam_days")
      .select(selectFields)
      .gte("exam_date", format(queryStart, "yyyy-MM-dd"))
      .lte("exam_date", format(queryEnd, "yyyy-MM-dd"));
    if (isAdmin && filterCompanyId !== "all") {
      query = query.eq("company_id", filterCompanyId);
    } else if (!isAdmin && userCompanyId) {
      query = query.eq("company_id", userCompanyId);
    }
    const { data } = await query;
    const keys = new Set<string>();
    const details = new Map<string, EyeExamDayCellInfo[]>();

    for (const row of data || []) {
      const examDate = String((row as { exam_date: string }).exam_date).slice(0, 10);
      keys.add(examDate);

      if (!isAdmin) {
        const links = (row as {
          company_eye_exam_day_specialists?: {
            work_period: string | null;
            eye_exam_specialists: { name: string; active: boolean } | null;
          }[];
        }).company_eye_exam_day_specialists || [];

        const infos: EyeExamDayCellInfo[] = links
          .filter((l) => l.eye_exam_specialists && l.eye_exam_specialists.active !== false)
          .map((l) => ({
            specialistName: l.eye_exam_specialists!.name,
            workPeriod: parseWorkPeriod(l.work_period),
          }))
          .sort((a, b) => a.specialistName.localeCompare(b.specialistName, "pt-BR"));

        if (infos.length > 0) details.set(examDate, infos);
      }
    }

    setEyeExamDayKeys(keys);
    setEyeExamDayDetails(details);
  }, [focusDate, calendarView, isAdmin, filterCompanyId, userCompanyId]);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) return;
    void supabase
      .from("profiles")
      .select("company_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setUserCompanyId(data?.company_id ?? null));
  }, [user, isAdmin]);

  useEffect(() => {
    void fetchEyeExamDays();
  }, [fetchEyeExamDays]);

  const fetchSpecialistSchedule = useCallback(async () => {
    if (!isAdmin || pageMode !== "specialist-schedule") return;
    setScheduleLoading(true);
    const { queryStart, queryEnd } = getCalendarQueryRange(focusDate, "month");
    let query = supabase
      .from("company_eye_exam_days")
      .select(`
        id,
        exam_date,
        company_id,
        companies ( id, name, exam_schedule_color ),
        company_eye_exam_day_specialists (
          specialist_id,
          work_period,
          eye_exam_specialists ( id, name )
        )
      `)
      .gte("exam_date", format(queryStart, "yyyy-MM-dd"))
      .lte("exam_date", format(queryEnd, "yyyy-MM-dd"));
    if (filterCompanyId !== "all") {
      query = query.eq("company_id", filterCompanyId);
    }
    const { data, error } = await query;
    if (error) {
      toast.error("Erro ao carregar escala de especialistas");
      setScheduleLoading(false);
      return;
    }
    const companyColorIndex = new Map(companies.map((c, i) => [c.id, i]));
    const entries: SpecialistScheduleEntry[] = [];
    for (const day of data || []) {
      const row = day as {
        id: string;
        exam_date: string;
        company_id: string;
        companies: { id: string; name: string; exam_schedule_color: string | null } | null;
        company_eye_exam_day_specialists?: {
          specialist_id: string;
          work_period: string | null;
          eye_exam_specialists: { id: string; name: string } | null;
        }[];
      };
      const company = row.companies;
      if (!company) continue;
      const color = resolveCompanyExamColor(company, companyColorIndex.get(company.id) ?? 0);
      for (const link of row.company_eye_exam_day_specialists || []) {
        const spec = link.eye_exam_specialists;
        if (!spec) continue;
        if (filterSpecialistId !== "all" && spec.id !== filterSpecialistId) continue;
        entries.push({
          examDate: String(row.exam_date).slice(0, 10),
          companyId: row.company_id,
          companyName: company.name,
          companyColor: color,
          specialistId: spec.id,
          specialistName: spec.name,
          workPeriod: parseWorkPeriod(link.work_period),
          eyeExamDayId: row.id,
        });
      }
    }
    setSpecialistSchedule(entries);
    setScheduleLoading(false);
  }, [isAdmin, pageMode, focusDate, filterCompanyId, filterSpecialistId, companies]);

  useEffect(() => {
    if (!isAdmin) return;
    void supabase
      .from("eye_exam_specialists")
      .select("id, name, active")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setSpecialists((data || []) as EyeExamSpecialist[]));
  }, [isAdmin]);

  useEffect(() => {
    void fetchSpecialistSchedule();
  }, [fetchSpecialistSchedule]);

  const fetchAll = async () => {
    setLoading(true);
    const { queryStart, queryEnd } = getCalendarQueryRange(focusDate, calendarView);
    let query = supabase
      .from("crm_appointments")
      .select("*")
      .eq("status", "agendado")
      .gte("scheduled_datetime", queryStart.toISOString())
      .lte("scheduled_datetime", queryEnd.toISOString())
      .order("scheduled_datetime", { ascending: true });
    query = query.is("deleted_at", null).is("returned_at", null);
    if (!isAdmin) {
      query = query
        .eq("is_reschedule_snapshot", false)
        .neq("venda", "Gerou Orçamento")
        .neq("venda", "Não Gerou Orçamento");
    }
    const [apptRes, profRes] = await Promise.all([
      query,
      supabase.rpc("get_profile_names"),
    ]);
    setAppointments(sortAppointmentsByTime((apptRes.data || []) as unknown as Appointment[]));
    setProfiles((profRes.data || []) as Profile[]);
    if (isAdmin) {
      const [compRes, profFullRes] = await Promise.all([
        supabase.from("companies").select("id, name, exam_schedule_color").order("name"),
        supabase.from("profiles").select("user_id, full_name, company_id"),
      ]);
      setCompanies((compRes.data || []) as Company[]);
      setProfilesFull((profFullRes.data || []) as ProfileFull[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [focusDate, calendarView, isAdmin]);

  // Realtime: refresh appointments when the table changes
  useEffect(() => {
    if (!isRealtimeEnabled()) return;
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; fetchAll(); }, 400);
    };
    const channel = supabase
      .channel("appointments-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_appointments" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDate, calendarView]);

  const filteredAppointments = useMemo(() => {
    const base =
      isAdmin && filterCompanyId !== "all"
        ? appointments.filter((appt) => {
            const prof = profilesFull.find((p) => p.user_id === appt.scheduled_by);
            return prof?.company_id === filterCompanyId;
          })
        : appointments;
    return sortAppointmentsByTime(
      base.filter((appt) => isRescheduleSnapshotVisibleToUser(appt, isAdmin)),
    );
  }, [appointments, isAdmin, filterCompanyId, profilesFull]);

  const listDayAppointments = useMemo(() => {
    if (!listDay) return [];
    return filteredAppointments.filter((a) =>
      isSameDay(new Date(a.scheduled_datetime), listDay),
    );
  }, [filteredAppointments, listDay]);

  const scheduleLegend = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    for (const e of specialistSchedule) {
      if (!seen.has(e.companyId)) {
        seen.set(e.companyId, { id: e.companyId, name: e.companyName, color: e.companyColor });
      }
    }
    if (seen.size > 0) return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const companyColorIndex = new Map(companies.map((c, i) => [c.id, i]));
    const list =
      filterCompanyId === "all"
        ? companies
        : companies.filter((c) => c.id === filterCompanyId);
    return list.map((c) => ({
      id: c.id,
      name: c.name,
      color: resolveCompanyExamColor(c, companyColorIndex.get(c.id) ?? 0),
    }));
  }, [specialistSchedule, companies, filterCompanyId]);

  const getProfileName = (userId: string) => profiles.find(p => p.user_id === userId)?.full_name || "—";

  const appointmentActionContext = (appt: Appointment, actorId: string) => {
    const leadName = appt.nome?.trim() || "Lead";
    const vendedorPart = actorId !== appt.scheduled_by
      ? ` (vendedor: ${getProfileName(appt.scheduled_by)})`
      : "";
    return { leadName, vendedorPart };
  };

  /** Admin e vendedor (próprio) usam update direto; gerente em agendamento da equipe usa RPC. */
  const usesTeamAppointmentRpc = (appt: Appointment) => {
    if (!user || isAdmin) return false;
    return appt.scheduled_by !== user.id;
  };

  const updateField = async (id: string, field: string, value: string) => {
    const apptBefore = appointments.find((a) => a.id === id);
    if (!apptBefore || !user) return;

    if (field === "consulta_paga") {
      if (!isAdmin && apptBefore.consulta_paga === true) {
        toast.error("Somente administradores podem alterar consulta paga após marcada.");
        return;
      }
      if (value === "sim" && apptBefore.consulta_paga !== true) {
        const nowIso = new Date().toISOString();
        const payload = {
          consulta_paga: true,
          consulta_paga_em: nowIso,
          consulta_paga_por: user.id,
        };
        const { error } = usesTeamAppointmentRpc(apptBefore)
          ? await supabase.rpc("set_crm_appointment_consulta_paga", {
              p_appointment_id: id,
              p_paga: true,
            })
          : await supabase.from("crm_appointments").update(payload).eq("id", id);
        if (error) { toast.error(error.message || "Erro ao atualizar"); return; }
        setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
        const { leadName, vendedorPart } = appointmentActionContext(apptBefore, user.id);
        await logAppointmentHistory(
          id,
          user.id,
          "consulta_paga",
          `${getProfileName(user.id)} marcou consulta paga como Sim no agendamento de ${leadName}${vendedorPart}`,
          { lead_nome: leadName, scheduled_by: apptBefore.scheduled_by },
        );
        return;
      }
      if (value === "nao") {
        if (!isAdmin && apptBefore.consulta_paga === true) {
          toast.error("Somente administradores podem alterar consulta paga após marcada.");
          return;
        }
        const payload = {
          consulta_paga: false,
          consulta_paga_em: null,
          consulta_paga_por: null,
        };
        const { error } = usesTeamAppointmentRpc(apptBefore)
          ? await supabase.rpc("set_crm_appointment_consulta_paga", {
              p_appointment_id: id,
              p_paga: false,
            })
          : await supabase.from("crm_appointments").update(payload).eq("id", id);
        if (error) { toast.error(error.message || "Erro ao atualizar"); return; }
        setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
        if (isAdmin) {
          const { leadName, vendedorPart } = appointmentActionContext(apptBefore, user.id);
          await logAppointmentHistory(
            id,
            user.id,
            "consulta_paga",
            `${getProfileName(user.id)} marcou consulta paga como Não no agendamento de ${leadName}${vendedorPart}`,
            { lead_nome: leadName, scheduled_by: apptBefore.scheduled_by },
          );
        }
        return;
      }
      return;
    }

    if (field === "valor") {
      const num = parseFloat(value.replace(",", "."));
      if (Number.isNaN(num) || num < 0) {
        toast.error("Informe um valor válido para a consulta");
        return;
      }
      const valorStr = String(num);
      const payload = { valor: num };
      const { error } = usesTeamAppointmentRpc(apptBefore)
        ? await supabase.rpc("update_crm_appointment_field", {
            p_appointment_id: id,
            p_field: "valor",
            p_value: valorStr,
          })
        : await supabase.from("crm_appointments").update(payload).eq("id", id);
      if (error) {
        toast.error(error.message || "Erro ao atualizar valor");
        return;
      }
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
      const { leadName, vendedorPart } = appointmentActionContext(apptBefore, user.id);
      await logAppointmentHistory(
        id,
        user.id,
        "field_update",
        `${getProfileName(user.id)} alterou o valor da consulta para R$ ${num.toFixed(2)} no agendamento de ${leadName}${vendedorPart}`,
        { field: "valor", value: valorStr, lead_nome: leadName, scheduled_by: apptBefore.scheduled_by },
      );
      return;
    }

    if (field === "venda" && (value === "Gerou Orçamento" || value === "Não Gerou Orçamento")) {
      const appt = appointments.find(a => a.id === id);
      setNvApptId(id);
      setNvVendaTipo(value as "Gerou Orçamento" | "Não Gerou Orçamento");
      setNvMotivo(appt?.nao_vendido_motivo || "");
      setNvValor(appt?.orcamento_valor != null ? String(appt.orcamento_valor) : "");
      const existing = (appt?.orcamento_produtos_itens as ProdutoItem[] | null | undefined);
      setNvProdutosItens(existing && existing.length > 0 ? existing.map(p => ({ nome: p.nome || "", valor: p.valor || "" })) : [{ nome: "", valor: "" }]);
      setNvObservacao(appt?.orcamento_observacao || "");
      setNvDialogOpen(true);
      return;
    }
    if (field === "venda" && value === "Vendido") {
      setSaleApptId(id);
      setSaleValor("");
      setSalePagamento("");
      setSaleDialogOpen(true);
      return;
    }
    const payload: Record<string, unknown> = { [field]: value };
    if (field === "forma_pagamento_consulta" && formaConsultaSemValor(value)) {
      payload.valor = 0;
    }
    const { error } = usesTeamAppointmentRpc(apptBefore)
      ? await supabase.rpc("update_crm_appointment_field", {
          p_appointment_id: id,
          p_field: field,
          p_value: value,
        })
      : await supabase.from("crm_appointments").update(payload).eq("id", id);
    if (error) toast.error(error.message || "Erro ao atualizar");
    else {
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
      const { leadName, vendedorPart } = appointmentActionContext(apptBefore, user.id);
      await logAppointmentHistory(
        id,
        user.id,
        "field_update",
        `${getProfileName(user.id)} alterou ${field} do agendamento de ${leadName}${vendedorPart}`,
        { field, value, lead_nome: leadName, scheduled_by: apptBefore.scheduled_by },
      );
    }
  };

  const handleDialogVendaChange = (value: string) => {
    if (!editingAppt) return;
    setFormVenda(value);
    if (value === "Gerou Orçamento" || value === "Não Gerou Orçamento") {
      updateField(editingAppt.id, "venda", value);
      return;
    }
    if (value === "Vendido") {
      setSaleApptId(editingAppt.id);
      setSaleValor("");
      setSalePagamento("");
      setSaleDialogOpen(true);
    }
  };

  const handleReschedule = async () => {
    if (!editingAppt || !formRescheduleDate || !user || editingAppt.is_reschedule_snapshot) return;
    const [h, m] = formRescheduleTime.split(":").map(Number);
    const newDt = new Date(formRescheduleDate);
    newDt.setHours(h || 9, m || 0, 0, 0);
    const newDtIso = newDt.toISOString();
    const currentIso = editingAppt.scheduled_datetime;
    if (newDtIso === currentIso) {
      toast.error("Escolha uma data/horário diferente do agendamento atual.");
      return;
    }

    const originalFirst = editingAppt.original_scheduled_datetime || editingAppt.scheduled_datetime;
    setRescheduling(true);

    const { error: rescheduleErr } = await supabase.rpc("reschedule_crm_appointment", {
      p_appointment_id: editingAppt.id,
      p_new_datetime: newDtIso,
    });

    if (rescheduleErr) {
      toast.error(rescheduleErr.message || "Erro ao reagendar");
      setRescheduling(false);
      return;
    }

    const origLabel = format(new Date(originalFirst), "dd/MM/yyyy", { locale: ptBR });
    const newLabel = format(newDt, "dd/MM/yyyy", { locale: ptBR });
    const actorName = getProfileName(user.id);
    const leadName = editingAppt.nome?.trim() || "Lead";
    const vendedorName = getProfileName(editingAppt.scheduled_by);
    const vendedorPart = user.id !== editingAppt.scheduled_by ? ` (vendedor: ${vendedorName})` : "";
    await logAppointmentHistory(
      editingAppt.id,
      user.id,
      "rescheduled",
      `${actorName} reagendou o agendamento de ${leadName}${vendedorPart} de ${origLabel} para ${newLabel}`,
      {
        from: originalFirst,
        to: newDtIso,
        lead_nome: leadName,
        scheduled_by: editingAppt.scheduled_by,
      },
    );

    toast.success(`Reagendado para ${newLabel}`);
    setRescheduling(false);
    setFormRescheduleDate(undefined);
    setDialogOpen(false);
    fetchAll();
  };

  const handleNvSubmit = async () => {
    if (!nvApptId || !user) return;
    if (!nvMotivo.trim()) { toast.error("Informe o motivo da não compra"); return; }
    const fezOrc = nvVendaTipo === "Gerou Orçamento";
    const itensValidos = nvProdutosItens.filter(p => p.nome.trim() && p.valor);
    if (fezOrc && itensValidos.length === 0) {
      toast.error("Adicione ao menos um produto com nome e valor");
      return;
    }
    const valorSoma = itensValidos.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
    const appt = appointments.find(a => a.id === nvApptId);
    const actorName = getProfileName(user.id);
    const nomeLead = appt?.nome || "lead";
    setNvSaving(true);
    const payload: any = {
      venda: nvVendaTipo,
      nao_vendido_motivo: nvMotivo.trim(),
      fez_orcamento: fezOrc,
      orcamento_valor: fezOrc ? valorSoma : null,
      orcamento_produtos: fezOrc ? itensValidos.map(p => `${p.nome} - R$ ${p.valor}`).join("; ") : null,
      orcamento_produtos_itens: fezOrc ? itensValidos : [],
      orcamento_observacao: nvObservacao.trim() || null,
    };
    const { error } = await supabase.from("crm_appointments").update(payload).eq("id", nvApptId);
    if (error) toast.error("Erro ao salvar");
    else {
      const action = fezOrc ? "orcamento" : "nao_orcamento";
      const summary = fezOrc
        ? `${actorName} registrou que ${nomeLead} gerou orçamento e não comprou — lead na tela de Orçamentos`
        : `${actorName} registrou que ${nomeLead} não gerou orçamento e não comprou — lead na tela de Orçamentos`;
      await logAppointmentHistory(nvApptId, user.id, action, summary, {
        venda: nvVendaTipo,
        motivo: nvMotivo.trim(),
        valor: fezOrc ? valorSoma : null,
      });
      setAppointments((prev) => prev.map((a) => (a.id === nvApptId ? { ...a, ...payload } : a)));
      await supabase
        .from("crm_appointments")
        .update({ venda: nvVendaTipo, fez_orcamento: fezOrc } as any)
        .eq("snapshot_of_appointment_id", nvApptId)
        .eq("is_reschedule_snapshot", true);
      toast.success(fezOrc ? "Orçamento registrado" : "Registro salvo — lead na tela de Orçamentos");
      setFormVenda(nvVendaTipo);
      setHistoryRefreshKey((k) => k + 1);
      if (!isAdmin) setDialogOpen(false);
    }
    setNvSaving(false);
    setNvDialogOpen(false);
    setNvApptId(null);
    fetchAll();
  };


  const handleNvOpenChange = (open: boolean) => {
    if (!open) {
      toast.error("Preencha as informações e clique em Salvar para continuar.");
      return;
    }
    setNvDialogOpen(true);
  };

  const returnAppt = appointments.find(a => a.id === returnId);
  const isFromRenovacao = !!returnAppt?.renovacao_id;

  const confirmReturnToLeads = async () => {
    if (!returnId || !returnAppt || !user) return;
    setReturning(true);
    const nowIso = new Date().toISOString();
    const actorName = getProfileName(user.id);
    let apptLabel = format(new Date(returnAppt.scheduled_datetime), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

    if (isFromRenovacao && returnAppt.renovacao_id) {
      await supabase.from("crm_renovacoes").update({ status: returnAppt.previous_status || "novo", scheduled_date: null } as any).eq("id", returnAppt.renovacao_id);
      await supabase.from("crm_renovacao_notes" as any).insert({
        renovacao_id: returnAppt.renovacao_id,
        user_id: user.id,
        content: `↩ Retornou da tela de Agendamentos (${apptLabel}) — enviado por ${actorName}`,
      });
    } else if (returnAppt.lead_id) {
      const { error: leadErr } = await supabase
        .from("crm_leads")
        .update({
          status: returnAppt.previous_status || "novo",
          scheduled_date: null,
          updated_at: nowIso,
        } as any)
        .eq("id", returnAppt.lead_id);
      if (leadErr) {
        toast.error("Erro ao restaurar lead na tela de Leads");
        setReturning(false);
        return;
      }
      await supabase.from("crm_lead_notes").insert({
        lead_id: returnAppt.lead_id,
        user_id: user.id,
        content: `↩ Retornou da tela de Agendamentos (${apptLabel}) — enviado por ${actorName}`,
      });
    }

    const { error } = await supabase.from("crm_appointments").update({
      deleted_at: nowIso,
      deleted_by: user.id,
      returned_at: nowIso,
      returned_by: user.id,
    } as any).eq("id", returnId);

    if (error) toast.error("Erro ao retornar");
    else {
      await closeAppointmentRescheduleSnapshots(returnId, user.id, nowIso);
      const destino = isFromRenovacao ? "Renovações" : "Leads";
      await logAppointmentHistory(
        returnId,
        user.id,
        "returned",
        `${actorName} retornou o agendamento de ${returnAppt.nome || "lead"} para a tela de ${destino}`,
        { lead_id: returnAppt.lead_id, renovacao_id: returnAppt.renovacao_id },
      );
      toast.success(isFromRenovacao ? "Cliente retornado para Renovações" : "Lead retornado para a tela de Leads");
      setDialogOpen(false);
    }
    setReturning(false);
    setReturnId(null);
    fetchAll();
  };

  const handleSaleSubmit = async () => {
    if (!saleApptId || !salePagamento || !saleValor) return;
    setSaleSaving(true);
    const appt = appointments.find(a => a.id === saleApptId);
    await supabase.from("crm_appointments").update({
      venda: "Vendido",
      valor_venda: parseFloat(saleValor) || 0,
      forma_pagamento_venda: salePagamento,
    } as any).eq("id", saleApptId);
    if (appt?.lead_id) {
      await supabase.from("crm_leads").update({ comprou: true } as any).eq("id", appt.lead_id);
    }
    toast.success("Venda registrada!");
    setFormVenda("Vendido");
    setSaleSaving(false);
    setSaleDialogOpen(false);
    setSaleApptId(null);
    fetchAll();
  };

  const openAdd = () => {
    setEditingAppt(null);
    setFormNome(""); setFormTelefone(""); setFormIdade("");
    setFormDate(undefined); setFormTime("09:00");
    setFormValor(""); setFormPagamentoOculos(""); setFormPagamentoConsulta(""); setFormCanal("Loja");
    setFormConsultaPaga(""); setFormConfirmacao("Pendente");
    setFormComparecimento("Pendente"); setFormVenda("Pendente"); setFormResumo("");
    setFormRescheduleDate(undefined); setFormRescheduleTime("09:00");
    setDialogOpen(true);
  };

  const calendarLabel = getCalendarQueryRange(focusDate, calendarView).label;

  // Explica por que o botão Salvar está desabilitado — sem isso, um
  // agendamento sem "forma de pagamento da consulta" preenchida travava o
  // botão pra QUALQUER edição (até só corrigir o nome) sem nenhuma mensagem
  // visível explicando o motivo.
  const saveBlockedReason = (): string | null => {
    if (editingAppt?.is_reschedule_snapshot) return null;
    if (editingAppt && isAppointmentInactive(editingAppt)) return null;
    if (!formNome) return "Preencha o nome do cliente.";
    if (!formDate) return "Preencha a data do agendamento.";
    if (!formPagamentoOculos) return "Selecione a forma de pagamento dos óculos.";
    if (!editingAppt && !formConsultaPaga) return "Informe se a consulta foi paga.";
    if (formConsultaPaga === "sim" && !formPagamentoConsulta) {
      return "Selecione a forma de pagamento da consulta para poder salvar.";
    }
    return null;
  };

  const openEdit = (appt: Appointment) => {
    setEditingAppt(appt);
    setFormNome(appt.nome); setFormTelefone(appt.telefone); setFormIdade(appt.idade);
    try {
      const dt = new Date(appt.scheduled_datetime);
      setFormDate(dt);
      setFormTime(format(dt, "HH:mm"));
    } catch { setFormDate(undefined); setFormTime("09:00"); }
    setFormValor(String(appt.valor));
    setFormPagamentoOculos(appt.forma_pagamento_oculos || appt.forma_pagamento || "");
    setFormPagamentoConsulta(appt.forma_pagamento_consulta || "");
    setFormCanal(appt.canal_agendamento || "Loja");
    setFormConsultaPaga(appt.consulta_paga === true ? "sim" : appt.consulta_paga === false ? "nao" : "");
    setFormConfirmacao(appt.confirmacao || "Pendente");
    setFormComparecimento(appt.comparecimento || "Pendente");
    setFormVenda(appt.venda || "Pendente");
    setFormResumo(appt.resumo || "");
    setFormRescheduleDate(undefined);
    setFormRescheduleTime(format(new Date(appt.scheduled_datetime), "HH:mm"));
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDate || !formPagamentoOculos || !user) return;
    if (!editingAppt && !formConsultaPaga) {
      toast.error("Informe se a consulta foi paga (Sim ou Não).");
      return;
    }
    const pagamentoConsultaNeeded = formConsultaPaga === "sim";
    if (pagamentoConsultaNeeded && !formPagamentoConsulta) {
      toast.error("Informe a forma de pagamento da consulta.");
      return;
    }
    if (pagamentoConsultaNeeded && !formaConsultaSemValor(formPagamentoConsulta) && !formValor.trim()) {
      toast.error("Informe o valor da consulta.");
      return;
    }
    if (editingAppt?.is_reschedule_snapshot) return;
    if (editingAppt && isAppointmentInactive(editingAppt)) return;
    setSaving(true);
    const [h, m] = formTime.split(":").map(Number);
    const dt = new Date(formDate);
    dt.setHours(h, m, 0, 0);

    const pagaConsulta = formConsultaPaga === "sim";
    const valorConsulta = formaConsultaSemValor(formPagamentoConsulta)
      ? 0
      : (parseFloat(formValor) || 0);
    const nowIso = new Date().toISOString();

    if (editingAppt) {
      const payload: Record<string, unknown> = {
        nome: formNome, telefone: formTelefone, idade: formIdade,
        scheduled_datetime: dt.toISOString(),
        valor: valorConsulta,
        forma_pagamento: formPagamentoOculos,
        forma_pagamento_oculos: formPagamentoOculos,
        forma_pagamento_consulta: formPagamentoConsulta,
        canal_agendamento: formCanal,
        confirmacao: formConfirmacao,
        comparecimento: formComparecimento,
        resumo: formResumo,
      };
      if (!editingAppt.original_scheduled_datetime) {
        payload.original_scheduled_datetime = editingAppt.scheduled_datetime;
      }
      const { error } = await supabase.from("crm_appointments").update(payload as any).eq("id", editingAppt.id);
      if (error) toast.error("Erro ao atualizar");
      else {
        if (formConsultaPaga) {
          await updateField(editingAppt.id, "consulta_paga", formConsultaPaga);
        }
        toast.success("Agendamento atualizado");
        await logAppointmentHistory(
          editingAppt.id,
          user.id,
          "updated",
          `${getProfileName(user.id)} editou o agendamento de ${formNome}`,
        );
      }
    } else {
      const { data: newAppt, error } = await supabase.from("crm_appointments").insert({
        lead_id: null,
        scheduled_by: user.id,
        scheduled_datetime: dt.toISOString(),
        valor: valorConsulta,
        forma_pagamento: formPagamentoOculos,
        forma_pagamento_oculos: formPagamentoOculos,
        forma_pagamento_consulta: formPagamentoConsulta,
        consulta_paga: pagaConsulta,
        consulta_paga_no_agendamento: pagaConsulta,
        consulta_paga_em: pagaConsulta ? nowIso : null,
        consulta_paga_por: pagaConsulta ? user.id : null,
        canal_agendamento: formCanal,
        nome: formNome, telefone: formTelefone, idade: formIdade,
        previous_status: "manual",
        original_scheduled_datetime: dt.toISOString(),
      } as any).select("id").single();
      if (error) toast.error("Erro ao criar agendamento");
      else {
        toast.success("Agendamento criado");
        if (newAppt?.id) {
          await logAppointmentHistory(newAppt.id, user.id, "created", `${getProfileName(user.id)} criou agendamento para ${formNome}`);
        }
      }
    }
    setSaving(false);
    setDialogOpen(false);
    fetchAll();
  };

  const confirmDelete = async () => {
    if (!deleteId || !user) return;
    const appt = appointments.find(a => a.id === deleteId);
    if (!appt) return;

    const actorName = getProfileName(user.id);
    const leadName = appt?.nome?.trim() || "Lead";
    const vendedorPart = appt && user.id !== appt.scheduled_by
      ? ` (vendedor: ${getProfileName(appt.scheduled_by)})`
      : "";

    let error: { message: string } | null = null;
    if (isAdmin) {
      await logAppointmentHistory(
        deleteId,
        user.id,
        "deleted",
        `${actorName} excluiu definitivamente o agendamento de ${leadName}${vendedorPart}`,
        {
          lead_nome: leadName,
          scheduled_by: appt.scheduled_by ?? null,
          permanent: true,
        },
      );
      const res = await supabase.rpc("hard_delete_crm_appointment", {
        p_appointment_id: deleteId,
      });
      error = res.error;
    } else if (usesTeamAppointmentRpc(appt)) {
      const res = await supabase.rpc("soft_delete_crm_appointment", {
        p_appointment_id: deleteId,
      });
      error = res.error;
    } else {
      const deletedAt = new Date().toISOString();
      if (appt.lead_id) {
        await supabase.from("crm_leads").update({
          status: appt.previous_status,
          scheduled_date: null,
          updated_at: deletedAt,
        } as any).eq("id", appt.lead_id);
      }
      if (appt.renovacao_id) {
        await supabase.from("crm_renovacoes").update({
          status: appt.previous_status || "novo",
          scheduled_date: null,
          updated_at: deletedAt,
        } as any).eq("id", appt.renovacao_id);
      }
      const res = await supabase.from("crm_appointments").update({
        deleted_at: deletedAt,
        deleted_by: user.id,
      }).eq("id", deleteId);
      error = res.error;
      if (!error) {
        await closeAppointmentRescheduleSnapshots(deleteId, user.id, deletedAt);
      }
    }

    if (error) toast.error(error.message || "Erro ao excluir");
    else {
      if (!isAdmin) {
        await logAppointmentHistory(
          deleteId,
          user.id,
          "deleted",
          `${actorName} excluiu o agendamento de ${leadName}${vendedorPart}`,
          {
            lead_nome: leadName,
            scheduled_by: appt.scheduled_by ?? null,
          },
        );
      }
      toast.success(isAdmin ? "Agendamento excluído definitivamente" : "Agendamento removido da sua lista");
    }
    setDeleteId(null);
    fetchAll();
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    if (!open && nvDialogOpen) {
      toast.error("Conclua o registro de orçamento antes de fechar o agendamento.");
      return;
    }
    if (!open && saleDialogOpen) {
      toast.error("Conclua o registro da venda antes de fechar o agendamento.");
      return;
    }
    setDialogOpen(open);
  };

  return (
    <AppLayout>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarCheck className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Agendamentos</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {pageMode === "specialist-schedule" && isAdmin
              ? `${specialistSchedule.length} escala(s) no período`
              : `${filteredAppointments.length} agendamento(s)`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Select
              value={pageMode}
              onValueChange={(v) => {
                const mode = v as PageMode;
                setPageMode(mode);
                setListDay(null);
                if (mode === "specialist-schedule") setCalendarView("month");
              }}
            >
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="appointments">Agendamentos</SelectItem>
                <SelectItem value="specialist-schedule">Escala de especialistas</SelectItem>
              </SelectContent>
            </Select>
          )}
          {isAdmin && pageMode === "specialist-schedule" && companies.length > 0 && (
            <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Todas empresas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas empresas</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isAdmin && pageMode === "specialist-schedule" && (
            <Select value={filterSpecialistId} onValueChange={setFilterSpecialistId}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Especialista" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos especialistas</SelectItem>
                {specialists.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isAdmin && companies.length > 0 && pageMode === "appointments" && (
            <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Todas empresas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas empresas</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {pageMode === "appointments" && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-1 h-4 w-4" /> Novo Agendamento
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 min-w-0 max-w-full">
          {pageMode === "specialist-schedule" && isAdmin ? (
            <>
              {scheduleLegend.length > 0 && (
                <div className="rounded-lg border bg-card px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Gabarito — cor por loja
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {scheduleLegend.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="h-3.5 w-3.5 rounded-sm border border-black/10 shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setFocusDate(new Date())}>Hoje</Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFocusDate((d) => shiftFocusDate(d, "month", -1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFocusDate((d) => shiftFocusDate(d, "month", 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-semibold capitalize ml-1">
                    {format(focusDate, "MMMM 'de' yyyy", { locale: ptBR })}
                  </span>
                </div>
              </div>
              {scheduleLoading ? (
                <p className="text-center text-muted-foreground py-8">Carregando escala...</p>
              ) : (
                <SpecialistScheduleCalendar
                  focusDate={focusDate}
                  entries={specialistSchedule}
                />
              )}
            </>
          ) : listDay ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setListDay(null)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Calendário
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      const next = addDays(listDay, -1);
                      setListDay(next);
                      setFocusDate(next);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      const next = addDays(listDay, 1);
                      setListDay(next);
                      setFocusDate(next);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-semibold capitalize ml-1 flex items-center gap-1.5">
                    <List className="h-4 w-4 text-muted-foreground" />
                    {format(listDay, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {listDayAppointments.length} agendamento(s)
                </span>
              </div>
              <AppointmentsListTable
                appointments={listDayAppointments}
                isAdmin={isAdmin}
                canEditValor={isAdmin || isGerente}
                loading={loading}
                getProfileName={getProfileName}
                onUpdateField={updateField}
                onEdit={(a) => {
                  const full = appointments.find((x) => x.id === a.id);
                  if (full) openEdit(full);
                }}
                onDelete={setDeleteId}
                onReturn={setReturnId}
                confirmacaoOptions={CONFIRMACAO_OPTIONS}
                comparecimentoOptions={COMPARECIMENTO_OPTIONS}
                vendaOptions={VENDA_OPTIONS}
              />
            </>
          ) : (
            <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setFocusDate(new Date())}>Hoje</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFocusDate((d) => shiftFocusDate(d, calendarView, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFocusDate((d) => shiftFocusDate(d, calendarView, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold capitalize ml-1">{calendarLabel}</span>
            </div>
            <Select
              value={calendarView}
              onValueChange={(v) => {
                setListDay(null);
                setCalendarView(v as CalendarViewMode);
              }}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Mês</SelectItem>
                <SelectItem value="week">Semana</SelectItem>
                <SelectItem value="day">Dia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {eyeExamDayKeys.size > 0 && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-2 px-1">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-semibold text-white">
                {format(focusDate, "d")}
              </span>
              Dia com exame de vista agendado na empresa
            </p>
          )}
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Carregando...</p>
          ) : (
            <AppointmentsCalendar
              appointments={filteredAppointments}
              view={calendarView}
              focusDate={focusDate}
              eyeExamDayKeys={eyeExamDayKeys}
              eyeExamDayDetails={!isAdmin ? eyeExamDayDetails : undefined}
              onSelectAppointment={(a) => {
                const full = appointments.find((x) => x.id === a.id);
                if (full) openEdit(full);
              }}
              onDayClick={(d) => {
                if (calendarView === "month") {
                  setFocusDate(d);
                  setListDay(d);
                } else {
                  setFocusDate(d);
                  setCalendarView("day");
                }
              }}
            />
          )}
            </>
          )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleEditDialogOpenChange}>
        <DialogContent
          className={cn(editingAppt ? "sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" : "sm:max-w-md")}
          onPointerDownOutside={(e) => {
            if (!editingAppt) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!editingAppt) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editingAppt?.is_reschedule_snapshot
                ? "Histórico de reagendamento"
                : editingAppt
                  ? "Editar Agendamento"
                  : "Novo Agendamento"}
            </DialogTitle>
          </DialogHeader>
          <div className={cn(editingAppt ? "flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden" : "")}>
          <form onSubmit={handleSubmit} className={cn("space-y-3", editingAppt ? "flex-1 overflow-y-auto pr-0 md:pr-4 max-h-[70vh]" : "")}>
            {editingAppt && isAppointmentInactive(editingAppt) && (
              <div className="rounded-md border border-muted-foreground/40 bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                {editingAppt.returned_at
                  ? `Retornado para ${editingAppt.renovacao_id ? "Renovações" : "Leads"}. Visível aqui apenas para administradores.`
                  : "Agendamento excluído. Visível aqui apenas para administradores."}
              </div>
            )}

            {editingAppt && isMovedToOrcamentos(editingAppt) && !isAppointmentInactive(editingAppt) && (
              <div className="rounded-md border border-muted-foreground/40 bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
                {editingAppt.venda === "Gerou Orçamento"
                  ? "Lead gerou orçamento e não comprou — registrado na tela de Orçamentos. Visível no calendário apenas para administradores."
                  : "Lead não gerou orçamento e não comprou — registrado na tela de Orçamentos. Visível no calendário apenas para administradores."}
              </div>
            )}

            {editingAppt && formatRescheduleNote(editingAppt) && !isAppointmentInactive(editingAppt) && !isMovedToOrcamentos(editingAppt) && (
              <div className={cn(
                "rounded-md border px-3 py-2 text-xs",
                editingAppt.is_reschedule_snapshot
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                  : "border-primary/30 bg-primary/10 text-foreground",
              )}>
                {formatRescheduleNote(editingAppt)}
              </div>
            )}

            {editingAppt?.is_reschedule_snapshot ? (
              <div className="space-y-2 text-sm">
                <p><span className="text-muted-foreground">Cliente:</span> {editingAppt.nome}</p>
                <p><span className="text-muted-foreground">Telefone:</span> {editingAppt.telefone || "—"}</p>
                <p><span className="text-muted-foreground">Data original:</span> {format(new Date(editingAppt.scheduled_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                {editingAppt.rescheduled_to_datetime && (
                  <p><span className="text-muted-foreground">Nova data:</span> {format(new Date(editingAppt.rescheduled_to_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                )}
                {editingAppt.snapshot_of_appointment_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const active = appointments.find((a) => a.id === editingAppt.snapshot_of_appointment_id);
                      if (active) openEdit(active);
                    }}
                  >
                    Abrir agendamento ativo
                  </Button>
                )}
              </div>
            ) : (
            <>
            <div className="space-y-1.5">
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={formNome} onChange={e => setFormNome(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input value={formTelefone} onChange={e => setFormTelefone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Idade</Label>
                <Input value={formIdade} onChange={e => setFormIdade(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data <span className="text-destructive">*</span></Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formDate ? format(formDate, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={formDate} onSelect={setFormDate} locale={ptBR} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label>Horário <span className="text-destructive">*</span></Label>
                <Input type="time" value={formTime} onChange={e => setFormTime(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Forma de captação <span className="text-destructive">*</span></Label>
              <Select value={formCanal} onValueChange={setFormCanal}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{CANAIS_AGENDAMENTO.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pagamento do Óculos <span className="text-destructive">*</span></Label>
              <Select value={formPagamentoOculos} onValueChange={setFormPagamentoOculos}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{FORMAS_PAGAMENTO_OCULOS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!editingAppt && (
              <div className="space-y-1.5">
                <Label>Consulta paga? <span className="text-destructive">*</span></Label>
                <Select
                  value={formConsultaPaga}
                  onValueChange={(v) => {
                    setFormConsultaPaga(v);
                    if (v === "nao") {
                      setFormPagamentoConsulta("");
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(!!editingAppt || formConsultaPaga === "sim") && (
              <div className="space-y-1.5">
                <Label>Pagamento da consulta <span className="text-destructive">*</span></Label>
                <Select
                  value={formPagamentoConsulta}
                  onValueChange={(v) => {
                    setFormPagamentoConsulta(v);
                    if (formaConsultaSemValor(v)) setFormValor("0");
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{FORMAS_PAGAMENTO_CONSULTA.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {(!!editingAppt || formConsultaPaga === "sim") && formPagamentoConsulta && !formaConsultaSemValor(formPagamentoConsulta) && (
              <div className="space-y-1.5">
                <Label>Valor (R$) <span className="text-destructive">*</span></Label>
                <Input type="number" step="0.01" min="0" value={formValor} onChange={e => setFormValor(e.target.value)} required />
              </div>
            )}
            {!editingAppt && formConsultaPaga === "nao" && (
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input type="number" step="0.01" min="0" value={formValor} onChange={e => setFormValor(e.target.value)} placeholder="0.00" />
              </div>
            )}

            {editingAppt && (
              <>
                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Atendimento</p>
                  <div className="space-y-1.5">
                    <Label>Consulta paga</Label>
                    <Select
                      value={formConsultaPaga}
                      onValueChange={setFormConsultaPaga}
                      disabled={editingAppt.consulta_paga === true && !isAdmin}
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sim">Sim</SelectItem>
                        <SelectItem value="nao">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Confirmação</Label>
                      <Select value={formConfirmacao} onValueChange={setFormConfirmacao}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{CONFIRMACAO_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Comparecimento</Label>
                      <Select value={formComparecimento} onValueChange={setFormComparecimento}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{COMPARECIMENTO_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Venda</Label>
                    <Select value={formVenda} onValueChange={handleDialogVendaChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{VENDA_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Resumo</Label>
                    <Textarea
                      value={formResumo}
                      onChange={(e) => setFormResumo(e.target.value)}
                      rows={2}
                      placeholder="Observações..."
                    />
                  </div>
                </div>

                <div className="border-t pt-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reagendamento</p>
                  <p className="text-xs text-muted-foreground">
                    O lead permanece visível na data original apenas para administradores. Vendedores e gerentes verão somente a nova data.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Nova data</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formRescheduleDate && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formRescheduleDate ? format(formRescheduleDate, "dd/MM/yyyy") : "Selecionar"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={formRescheduleDate} onSelect={setFormRescheduleDate} locale={ptBR} className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Novo horário</Label>
                      <Input type="time" value={formRescheduleTime} onChange={e => setFormRescheduleTime(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={!formRescheduleDate || rescheduling}
                    onClick={handleReschedule}
                  >
                    {rescheduling ? "Reagendando..." : "Confirmar reagendamento"}
                  </Button>
                </div>
              </>
            )}

            {editingAppt && !editingAppt.is_reschedule_snapshot && !isAppointmentInactive(editingAppt) && (
              <div className="flex gap-2 pt-1">
                {editingAppt.venda !== "Vendido" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => { setDialogOpen(false); setReturnId(editingAppt.id); }}
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    {editingAppt.renovacao_id ? "Retornar p/ Renovações" : "Retornar p/ Leads"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={() => { setDialogOpen(false); setDeleteId(editingAppt.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Excluir
                </Button>
              </div>
            )}

            {!saving && saveBlockedReason() && (
              <p className="text-xs text-destructive">{saveBlockedReason()}</p>
            )}
            <Button type="submit" className="w-full" disabled={saving || !formDate || !formPagamentoOculos || !formNome || (!editingAppt && !formConsultaPaga) || (formConsultaPaga === "sim" && !formPagamentoConsulta) || !!editingAppt?.is_reschedule_snapshot || !!(editingAppt && isAppointmentInactive(editingAppt))}>
              {saving ? "Salvando..." : editingAppt ? (isAppointmentInactive(editingAppt) ? "Somente leitura" : "Atualizar") : "Criar Agendamento"}
            </Button>
            </>
            )}
          </form>
          {editingAppt && isAdmin && !editingAppt.is_reschedule_snapshot && (
            <AppointmentHistoryPanel appointmentId={editingAppt.id} profiles={profiles} refreshKey={historyRefreshKey} />
          )}
          {editingAppt?.is_reschedule_snapshot && isAdmin && editingAppt.snapshot_of_appointment_id && (
            <AppointmentHistoryPanel appointmentId={editingAppt.snapshot_of_appointment_id} profiles={profiles} refreshKey={historyRefreshKey} />
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {isAdmin
                ? "O agendamento será excluído permanentemente e o lead voltará à coluna original."
                : "O lead será devolvido à coluna original."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return to Leads confirm */}
      <AlertDialog open={!!returnId} onOpenChange={(open) => !open && setReturnId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isFromRenovacao ? "Retornar para Renovações?" : "Retornar lead para a tela de Leads?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isFromRenovacao
                ? "O agendamento será removido e o cliente voltará para a tela de Renovações na coluna original."
                : "O agendamento será removido e o lead voltará para a tela de Leads na coluna original."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={returning}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReturnToLeads} disabled={returning}>
              {returning ? "Retornando..." : "Retornar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sale Dialog */}
      <Dialog open={saleDialogOpen} onOpenChange={(open) => { if (!open) { setSaleDialogOpen(false); setSaleApptId(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Venda</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Valor Total da Venda (R$) <span className="text-destructive">*</span></Label>
              <Input type="number" step="0.01" min="0" value={saleValor} onChange={(e) => setSaleValor(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pagamento do Óculos <span className="text-destructive">*</span></Label>
              <Select value={salePagamento} onValueChange={setSalePagamento}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGAMENTO_OCULOS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={saleSaving || !saleValor || !salePagamento} onClick={handleSaleSubmit}>
              {saleSaving ? "Salvando..." : "Confirmar Venda"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Não Vendido Dialog */}
      <Dialog open={nvDialogOpen} onOpenChange={handleNvOpenChange}>
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto [&>button]:hidden"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            toast.error("Preencha as informações e clique em Salvar para continuar.");
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{nvVendaTipo} — informações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Informe os dados abaixo e clique em Salvar. Esta tela só fecha após salvar.</span>
            </div>
            <div className="space-y-1.5">
              <Label>Por que o cliente não comprou? <span className="text-destructive">*</span></Label>
              <Textarea value={nvMotivo} onChange={(e) => setNvMotivo(e.target.value)} rows={3} maxLength={1000} placeholder="Ex.: achou caro, vai pensar, etc." />
            </div>
            {nvVendaTipo === "Gerou Orçamento" && (
              <>
                <div className="space-y-1.5">
                  <Label>Produtos passados <span className="text-destructive">*</span></Label>
                  <div className="space-y-2">
                    {nvProdutosItens.map((item, idx) => (
                      <div key={idx} className="flex gap-2 items-start">
                        <Input
                          placeholder="Nome do produto"
                          value={item.nome}
                          onChange={(e) => setNvProdutosItens(prev => prev.map((p, i) => i === idx ? { ...p, nome: e.target.value } : p))}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Valor"
                          value={item.valor}
                          onChange={(e) => setNvProdutosItens(prev => prev.map((p, i) => i === idx ? { ...p, valor: e.target.value } : p))}
                          className="w-28"
                        />
                        {nvProdutosItens.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setNvProdutosItens(prev => prev.filter((_, i) => i !== idx))}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => setNvProdutosItens(prev => [...prev, { nome: "", valor: "" }])}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar produto
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <span className="font-medium">Valor total do orçamento</span>
                  <span className="font-bold">
                    R$ {nvProdutosItens.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0).toFixed(2)}
                  </span>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea value={nvObservacao} onChange={(e) => setNvObservacao(e.target.value)} rows={3} maxLength={1000} placeholder="Observações adicionais..." />
            </div>
            <Button className="w-full" disabled={nvSaving} onClick={handleNvSubmit}>
              {nvSaving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

