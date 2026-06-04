import { useEffect, useMemo, useState } from "react";
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
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck, Plus, Pencil, Trash2, CalendarIcon, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRealtimeEnabled } from "@/lib/runtime-config";
import {
  FORMAS_PAGAMENTO_OCULOS,
  getAppointmentRowColor,
  glassesPaymentLabel,
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
};

type Profile = { user_id: string; full_name: string };

const sortAppointmentsByTime = (list: Appointment[]) =>
  [...list].sort(
    (a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime(),
  );

const CONFIRMACAO_OPTIONS = ["Pendente", "Confirmado", "Cancelado"];
const COMPARECIMENTO_OPTIONS = ["Pendente", "Compareceu", "Não Compareceu"];
const VENDA_OPTIONS = ["Pendente", "Vendido", "Gerou Orçamento", "Não Gerou Orçamento", "Laudo", "Doença no Olho"];
const FORMAS_PAGAMENTO_VENDA = [
  "Dinheiro", "Cartão de Crédito", "Cartão de Débito", "PIX", "Convênio", "Boleto", "Cortesia",
];

type Company = { id: string; name: string };
type ProfileFull = { user_id: string; full_name: string; company_id: string | null };

export default function AppointmentsPage() {
  const { user, isAdmin } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesFull, setProfilesFull] = useState<ProfileFull[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState<Date | undefined>(new Date());
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [saving, setSaving] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formTelefone, setFormTelefone] = useState("");
  const [formIdade, setFormIdade] = useState("");
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formTime, setFormTime] = useState("09:00");
  const [formValor, setFormValor] = useState("");
  const [formPagamentoOculos, setFormPagamentoOculos] = useState("");

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
  const [saleEntrada, setSaleEntrada] = useState("");

  // Não Vendido / Gerou Orçamento dialog
  const [nvDialogOpen, setNvDialogOpen] = useState(false);
  const [nvApptId, setNvApptId] = useState<string | null>(null);
  const [nvVendaTipo, setNvVendaTipo] = useState<"Gerou Orçamento" | "Não Gerou Orçamento">("Gerou Orçamento");
  const [nvMotivo, setNvMotivo] = useState("");
  const [nvValor, setNvValor] = useState("");
  const [nvProdutosItens, setNvProdutosItens] = useState<ProdutoItem[]>([{ nome: "", valor: "" }]);
  const [nvObservacao, setNvObservacao] = useState("");
  const [nvSaving, setNvSaving] = useState(false);



  const fetchAll = async () => {
    setLoading(true);
    let query = supabase
      .from("crm_appointments")
      .select("*")
      .eq("status", "agendado")
      .order("scheduled_datetime", { ascending: true });
    if (!isAdmin) {
      query = query.is("deleted_at", null);
    }
    if (filterDate) {
      const dayStart = new Date(filterDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(filterDate);
      dayEnd.setHours(23, 59, 59, 999);
      query = query.gte("scheduled_datetime", dayStart.toISOString()).lte("scheduled_datetime", dayEnd.toISOString());
    }
    const [apptRes, profRes] = await Promise.all([
      query,
      supabase.rpc("get_profile_names"),
    ]);
    setAppointments(sortAppointmentsByTime((apptRes.data || []) as unknown as Appointment[]));
    setProfiles((profRes.data || []) as Profile[]);
    if (isAdmin) {
      const [compRes, profFullRes] = await Promise.all([
        supabase.from("companies").select("id, name").order("name"),
        supabase.from("profiles").select("user_id, full_name, company_id"),
      ]);
      setCompanies((compRes.data || []) as Company[]);
      setProfilesFull((profFullRes.data || []) as ProfileFull[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [filterDate]);

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
  }, [filterDate]);

  const filteredAppointments = useMemo(() => {
    const base =
      isAdmin && filterCompanyId !== "all"
        ? appointments.filter((appt) => {
            const prof = profilesFull.find((p) => p.user_id === appt.scheduled_by);
            return prof?.company_id === filterCompanyId;
          })
        : appointments;
    return sortAppointmentsByTime(base);
  }, [appointments, isAdmin, filterCompanyId, profilesFull]);

  const getProfileName = (userId: string) => profiles.find(p => p.user_id === userId)?.full_name || "—";

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
        const { error } = await supabase.from("crm_appointments").update(payload).eq("id", id);
        if (error) { toast.error("Erro ao atualizar"); return; }
        setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
        await logAppointmentHistory(
          id,
          user.id,
          "consulta_paga",
          `${getProfileName(user.id)} marcou consulta paga como Sim`,
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
        const { error } = await supabase.from("crm_appointments").update(payload).eq("id", id);
        if (error) { toast.error("Erro ao atualizar"); return; }
        setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
        if (isAdmin) {
          await logAppointmentHistory(id, user.id, "consulta_paga", `${getProfileName(user.id)} marcou consulta paga como Não`);
        }
        return;
      }
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
    const payload: Record<string, unknown> = { [field]: value };
    const { error } = await supabase.from("crm_appointments").update(payload).eq("id", id);
    if (error) toast.error("Erro ao atualizar");
    else {
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, ...payload } : a)));
      await logAppointmentHistory(
        id,
        user.id,
        "field_update",
        `${getProfileName(user.id)} alterou ${field}`,
        { field, value },
      );
    }
    if (field === "venda" && value === "Vendido") {
      const appt = appointments.find(a => a.id === id);
      if (appt?.lead_id) {
        await supabase.from("crm_leads").update({ comprou: true } as any).eq("id", appt.lead_id);
      }
    }
  };

  const handleNvSubmit = async () => {
    if (!nvApptId) return;
    if (!nvMotivo.trim()) { toast.error("Informe o motivo da não compra"); return; }
    const fezOrc = nvVendaTipo === "Gerou Orçamento";
    const itensValidos = nvProdutosItens.filter(p => p.nome.trim() && p.valor);
    if (fezOrc && itensValidos.length === 0) {
      toast.error("Adicione ao menos um produto com nome e valor");
      return;
    }
    const valorSoma = itensValidos.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
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
    else toast.success("Registrado!");
    setNvSaving(false);
    setNvDialogOpen(false);
    setNvApptId(null);
    fetchAll();

  };


  const returnAppt = appointments.find(a => a.id === returnId);
  const isFromRenovacao = !!returnAppt?.renovacao_id;

  const confirmReturnToLeads = async () => {
    if (!returnId || !returnAppt) return;
    setReturning(true);
    if (isFromRenovacao && returnAppt.renovacao_id) {
      await supabase.from("crm_renovacoes").update({ status: returnAppt.previous_status || "novo", scheduled_date: null } as any).eq("id", returnAppt.renovacao_id);
    } else if (returnAppt.lead_id) {
      await supabase.from("crm_leads").update({ status: returnAppt.previous_status || "novo", scheduled_date: null } as any).eq("id", returnAppt.lead_id);
    }
    const { error } = await supabase.from("crm_appointments").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || null,
    }).eq("id", returnId);
    if (error) toast.error("Erro ao retornar");
    else {
      if (user) {
        await logAppointmentHistory(
          returnId,
          user.id,
          "returned",
          `${getProfileName(user.id)} retornou o lead à coluna anterior`,
        );
      }
      toast.success(isFromRenovacao ? "Cliente retornado para Renovações" : "Lead retornado para a tela de Leads");
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
      valor_entrada: parseFloat(saleEntrada) || 0,
      forma_pagamento_venda: salePagamento,
    } as any).eq("id", saleApptId);
    if (appt?.lead_id) {
      await supabase.from("crm_leads").update({ comprou: true } as any).eq("id", appt.lead_id);
    }
    toast.success("Venda registrada!");
    setSaleSaving(false);
    setSaleDialogOpen(false);
    setSaleApptId(null);
    fetchAll();
  };

  const openAdd = () => {
    setEditingAppt(null);
    setFormNome(""); setFormTelefone(""); setFormIdade("");
    setFormDate(undefined); setFormTime("09:00");
    setFormValor(""); setFormPagamentoOculos("");
    setDialogOpen(true);
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
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDate || !formPagamentoOculos || !user) return;
    setSaving(true);
    const [h, m] = formTime.split(":").map(Number);
    const dt = new Date(formDate);
    dt.setHours(h, m, 0, 0);

    if (editingAppt) {
      const { error } = await supabase.from("crm_appointments").update({
        nome: formNome, telefone: formTelefone, idade: formIdade,
        scheduled_datetime: dt.toISOString(),
        valor: parseFloat(formValor) || 0,
        forma_pagamento: formPagamentoOculos,
        forma_pagamento_oculos: formPagamentoOculos,
      } as any).eq("id", editingAppt.id);
      if (error) toast.error("Erro ao atualizar");
      else {
        toast.success("Agendamento atualizado");
        await logAppointmentHistory(
          editingAppt.id,
          user.id,
          "updated",
          `${getProfileName(user.id)} editou o agendamento de ${formNome}`,
        );
      }
    } else {
      const { error } = await supabase.from("crm_appointments").insert({
        lead_id: null,
        scheduled_by: user.id,
        scheduled_datetime: dt.toISOString(),
        valor: parseFloat(formValor) || 0,
        forma_pagamento: formPagamentoOculos,
        forma_pagamento_oculos: formPagamentoOculos,
        canal_agendamento: "Loja",
        nome: formNome, telefone: formTelefone, idade: formIdade,
        previous_status: "manual",
      } as any);
      if (error) toast.error("Erro ao criar agendamento");
      else toast.success("Agendamento criado");
    }
    setSaving(false);
    setDialogOpen(false);
    fetchAll();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const appt = appointments.find(a => a.id === deleteId);
    // Return lead to original column if it has a real lead_id
    if (appt && appt.lead_id) {
      await supabase.from("crm_leads").update({ status: appt.previous_status } as any).eq("id", appt.lead_id);
    }
    const { error } = await supabase.from("crm_appointments").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || null,
    }).eq("id", deleteId);
    if (error) toast.error("Erro ao excluir");
    else {
      if (user) {
        await logAppointmentHistory(
          deleteId,
          user.id,
          "deleted",
          `${getProfileName(user.id)} excluiu o agendamento de ${appt?.nome || "lead"}`,
        );
      }
      toast.success(isAdmin ? "Agendamento marcado como excluído" : "Agendamento removido da sua lista");
    }
    setDeleteId(null);
    fetchAll();
  };

  return (
    <AppLayout>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarCheck className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Agendamentos</h1>
          </div>
          <p className="text-sm text-muted-foreground">{filteredAppointments.length} agendamento(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && companies.length > 0 && (
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !filterDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4 text-destructive" />
                {filterDate ? format(filterDate, "dd/MM/yyyy", { locale: ptBR }) : "Todos os dias"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={filterDate} onSelect={setFilterDate} locale={ptBR} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {filterDate && (
            <Button variant="ghost" size="sm" onClick={() => setFilterDate(undefined)}>
              Limpar
            </Button>
          )}
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" /> Novo Agendamento
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-8">Carregando...</p>
      ) : filteredAppointments.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nenhum agendamento encontrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/70 border-b">
                <th className="text-left px-3 py-2.5 font-medium">Nome</th>
                <th className="text-left px-3 py-2.5 font-medium">Telefone</th>
                <th className="text-left px-3 py-2.5 font-medium">Idade</th>
                <th className="text-left px-3 py-2.5 font-medium">Horário</th>
                <th className="text-left px-3 py-2.5 font-medium">Agendado por</th>
                <th className="text-left px-3 py-2.5 font-medium">Valor</th>
                <th className="text-left px-3 py-2.5 font-medium">Consulta paga</th>
                <th className="text-left px-3 py-2.5 font-medium">Forma de pagamento do Óculos</th>
                <th className="text-left px-3 py-2.5 font-medium">Canal de Agendamento</th>
                <th className="text-left px-3 py-2.5 font-medium">Confirmação</th>
                <th className="text-left px-3 py-2.5 font-medium">Comparecimento</th>
                <th className="text-left px-3 py-2.5 font-medium">Venda</th>
                <th className="text-left px-3 py-2.5 font-medium">Resumo</th>
                <th className="text-left px-3 py-2.5 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredAppointments.map((appt) => {
                let dtFormatted = "—";
                try { dtFormatted = format(new Date(appt.scheduled_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch {}
                const cpaga = appt.consulta_paga;
                const rowColor = getAppointmentRowColor(appt);
                const consultaPagaLocked = cpaga === true && !isAdmin;
                return (
                  <tr
                    key={appt.id}
                    className={cn(
                      "transition-colors",
                      rowColor,
                      appt.deleted_at && isAdmin ? "opacity-60" : "",
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{appt.nome || "—"}</td>
                    <td className="px-3 py-2">{appt.telefone || "—"}</td>
                    <td className="px-3 py-2">{appt.idade || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dtFormatted}</td>
                    <td className="px-3 py-2">{getProfileName(appt.scheduled_by)}</td>
                    <td className="px-3 py-2">R$ {Number(appt.valor).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={cpaga === true ? "sim" : cpaga === false ? "nao" : ""}
                        onValueChange={(v) => updateField(appt.id, "consulta_paga", v)}
                        disabled={consultaPagaLocked}
                      >
                        <SelectTrigger className="h-8 text-xs w-[100px]"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sim">Sim</SelectItem>
                          <SelectItem value="nao">Não</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {glassesPaymentLabel(appt)}
                    </td>
                    <td className="px-3 py-2">{appt.canal_agendamento}</td>
                    <td className="px-3 py-2">
                      <Select value={appt.confirmacao} onValueChange={(v) => updateField(appt.id, "confirmacao", v)}>
                        <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{CONFIRMACAO_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select value={appt.comparecimento} onValueChange={(v) => updateField(appt.id, "comparecimento", v)}>
                        <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{COMPARECIMENTO_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select value={appt.venda} onValueChange={(v) => updateField(appt.id, "venda", v)}>
                        <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{VENDA_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        className="border rounded px-2 py-1 text-xs w-[150px] bg-background"
                        defaultValue={appt.resumo}
                        onBlur={(e) => { if (e.target.value !== appt.resumo) updateField(appt.id, "resumo", e.target.value); }}
                        placeholder="Observações..."
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {appt.venda !== "Vendido" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={appt.renovacao_id ? "Retornar para Renovações" : "Retornar para Leads"}
                            onClick={() => setReturnId(appt.id)}
                          >
                            <Undo2 className="h-3.5 w-3.5 text-primary" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(appt)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteId(appt.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={cn(editingAppt && isAdmin ? "sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" : "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>{editingAppt ? "Editar Agendamento" : "Novo Agendamento"}</DialogTitle>
          </DialogHeader>
          <div className={cn(editingAppt && isAdmin ? "flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden" : "")}>
          <form onSubmit={handleSubmit} className={cn("space-y-3", editingAppt && isAdmin ? "flex-1 overflow-y-auto pr-0 md:pr-4" : "")}>
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
              <Label>Valor (R$) <span className="text-destructive">*</span></Label>
              <Input type="number" step="0.01" min="0" value={formValor} onChange={e => setFormValor(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pagamento do Óculos <span className="text-destructive">*</span></Label>
              <Select value={formPagamentoOculos} onValueChange={setFormPagamentoOculos}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{FORMAS_PAGAMENTO_OCULOS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={saving || !formDate || !formPagamentoOculos || !formNome}>
              {saving ? "Salvando..." : editingAppt ? "Atualizar" : "Criar Agendamento"}
            </Button>

          </form>
          {editingAppt && isAdmin && (
            <AppointmentHistoryPanel appointmentId={editingAppt.id} profiles={profiles} />
          )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>O lead será devolvido à coluna original.</AlertDialogDescription>
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
              <Label>Valor da Entrada (R$)</Label>
              <Input type="number" step="0.01" min="0" value={saleEntrada} onChange={(e) => setSaleEntrada(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Forma de Pagamento <span className="text-destructive">*</span></Label>
              <Select value={salePagamento} onValueChange={setSalePagamento}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {FORMAS_PAGAMENTO_VENDA.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
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
      <Dialog open={nvDialogOpen} onOpenChange={(open) => { if (!open) { setNvDialogOpen(false); setNvApptId(null); } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{nvVendaTipo} — informações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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

