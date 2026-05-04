import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, WifiOff, ArrowLeft, Check, Eye, CalendarIcon, Clock } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { addToOfflineQueue, syncOfflineQueue, getOfflineQueue, type OfflineAppointmentPayload } from "@/lib/offlineSync";
import { formatPhoneBR } from "@/lib/phoneFormat";
import { format, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { normalizeLeadData, resolveLeadIdentity } from "@/lib/leadIdentity";

type DateStatusRange = { max_years: number; status_key: string };
type DateStatusConfig = { ranges: DateStatusRange[]; above_all: string; no_answer: string };

type FormField = {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
  position: number;
  is_required: boolean;
  parent_field_id: string | null;
  parent_trigger_value: string | null;
  status_mapping: Record<string, string> | null;
  date_status_ranges: DateStatusConfig | null;
  is_name_field?: boolean;
  is_phone_field?: boolean;
};

type CrmStatus = { id: string; key: string; label: string; position: number; color: string };
type Company = { id: string; name: string };

export default function NewLeadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [fields, setFields] = useState<FormField[]>([]);
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentUserName, setCurrentUserName] = useState("");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formStatus, setFormStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [step, setStep] = useState(0); // 0 = info step, then groups of 2 fields

  // Inline scheduling on the preview step
  const [agendou, setAgendou] = useState<"sim" | "nao" | "">("");
  const [observacao, setObservacao] = useState("");
  const [agDate, setAgDate] = useState(""); // yyyy-MM-dd
  const [agTime, setAgTime] = useState("09:00");
  const [agFormaPagamento, setAgFormaPagamento] = useState("");
  const [agCanal, setAgCanal] = useState("");

  // Duplicate phone detection
  const [duplicateInfo, setDuplicateInfo] = useState<
    | { leadId: string; ownerName: string; isMine: boolean }
    | null
  >(null);

  const CANAIS_AGENDAMENTO = [
    "Ligação Leads", "Ligação Renovação", "Loja", "Rede Social", "Ação Adam",
    "Convênios", "PAP", "Reavaliação", "Recomendação", "Teste de Visão Online",
    "Tráfego Pago", "Cortesia",
  ];
  const FORMAS_PAGAMENTO = [
    "Dinheiro", "Cartão de Crédito", "Cartão de Débito", "PIX", "Convênio", "Boleto", "Cortesia",
  ];

  useEffect(() => {
    const onLine = () => setIsOnline(true);
    const offLine = () => setIsOnline(false);
    window.addEventListener("online", onLine);
    window.addEventListener("offline", offLine);
    return () => { window.removeEventListener("online", onLine); window.removeEventListener("offline", offLine); };
  }, []);

  // Load from cache helper
  const loadFromCache = useCallback(() => {
    try {
      const cachedFields = JSON.parse(localStorage.getItem("crm_cache_fields") || "[]");
      const cachedStatuses = JSON.parse(localStorage.getItem("crm_cache_statuses") || "[]");
      const cachedCompanies = JSON.parse(localStorage.getItem("crm_cache_companies") || "[]");
      const cachedUsername = localStorage.getItem("crm_cache_username") || "";
      setFields(cachedFields);
      setStatuses(cachedStatuses);
      setCompanies(cachedCompanies);
      setCurrentUserName(cachedUsername);
      if (cachedStatuses.length > 0 && !formStatus) {
        setFormStatus(searchParams.get("status") || cachedStatuses[0].key);
      }
      return cachedFields.length > 0 || cachedStatuses.length > 0;
    } catch {
      return false;
    }
  }, [searchParams, formStatus]);

  useEffect(() => {
    // Always load cache first for instant display
    loadFromCache();

    // If online, fetch fresh data
    if (!navigator.onLine) return;

    const fetchData = async () => {
      try {
        const [{ data: flds }, { data: sts }, { data: profs }, { data: myProfile }, { data: managerCos }] = await Promise.all([
          supabase.from("crm_form_fields").select("id, label, field_type, options, position, is_required, parent_field_id, parent_trigger_value, status_mapping, date_status_ranges, is_name_field, is_phone_field").order("position"),
          supabase.from("crm_statuses").select("*").order("position"),
          supabase.rpc("get_profile_names"),
          supabase.from("profiles").select("company_id").eq("user_id", user!.id).maybeSingle(),
          supabase.from("manager_companies").select("company_id").eq("user_id", user!.id),
        ]);

        // Build list of company ids the user belongs to
        const companyIds = new Set<string>();
        if (myProfile?.company_id) companyIds.add(myProfile.company_id);
        (managerCos || []).forEach((mc: any) => mc.company_id && companyIds.add(mc.company_id));

        let comps: Company[] = [];
        if (companyIds.size > 0) {
          const { data: c } = await supabase
            .from("companies")
            .select("id, name")
            .in("id", Array.from(companyIds))
            .order("name");
          comps = (c || []) as Company[];
        }

        if (flds) setFields(flds as unknown as FormField[]);
        if (sts) setStatuses(sts as CrmStatus[]);
        setCompanies(comps);
        if (sts && sts.length > 0) setFormStatus(searchParams.get("status") || sts[0].key);
        const me = (profs || []).find((p: any) => p.user_id === user?.id);
        setCurrentUserName(me?.full_name || user?.email || "");

        // Update cache
        try {
          localStorage.setItem("crm_cache_fields", JSON.stringify(flds || []));
          localStorage.setItem("crm_cache_statuses", JSON.stringify(sts || []));
          localStorage.setItem("crm_cache_companies", JSON.stringify(comps || []));
          localStorage.setItem("crm_cache_username", me?.full_name || user?.email || "");
        } catch {}
      } catch {
        // Network failed, cache already loaded above
      }
    };

    fetchData();
  }, [user, loadFromCache]);

  // Sync offline queue when online
  useEffect(() => {
    if (isOnline) {
      syncOfflineQueue().then((syncedIds) => {
        if (syncedIds.length > 0) toast.success(`${syncedIds.length} lead(s) sincronizado(s)!`);
      });
    }
  }, [isOnline]);

  const set = (key: string, val: any) => setFormData({ ...formData, [key]: val });

  const toggleArray = (key: string, item: string) => {
    const arr: string[] = formData[key] || [];
    set(key, arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]);
  };

  const isFieldVisible = useCallback((field: FormField): boolean => {
    if (!field.parent_field_id) return true;
    const parent = fields.find((f) => f.id === field.parent_field_id);
    if (!parent) return false;
    if (!isFieldVisible(parent)) return false;
    if (!field.parent_trigger_value) return true;
    const parentValue = formData[`field_${parent.id}`];
    let triggerValues: string[];
    try {
      const parsed = JSON.parse(field.parent_trigger_value);
      triggerValues = Array.isArray(parsed) ? parsed : [field.parent_trigger_value];
    } catch {
      triggerValues = [field.parent_trigger_value];
    }
    if (Array.isArray(parentValue)) {
      return parentValue.some((v: string) => triggerValues.includes(v));
    }
    return triggerValues.includes(parentValue);
  }, [fields, formData]);

  // Get visible root fields and their visible children flattened
  const getVisibleFields = useCallback((): FormField[] => {
    const result: FormField[] = [];
    const addWithChildren = (field: FormField) => {
      if (!isFieldVisible(field)) return;
      result.push(field);
      fields
        .filter((f) => f.parent_field_id === field.id)
        .sort((a, b) => a.position - b.position)
        .forEach(addWithChildren);
    };
    fields
      .filter((f) => !f.parent_field_id)
      .sort((a, b) => a.position - b.position)
      .forEach(addWithChildren);
    return result;
  }, [fields, isFieldVisible]);

  const visibleFields = getVisibleFields();

  // Group visible fields in pages of 2
  const FIELDS_PER_PAGE = 2;
  const totalFieldPages = Math.ceil(visibleFields.length / FIELDS_PER_PAGE);
  const totalSteps = 1 + totalFieldPages + 1; // step 0 = info, steps 1..N = field pages, last = preview
  const previewStep = totalSteps - 1;
  const isPreviewStep = step === previewStep;
  const currentPageFields = step > 0 && !isPreviewStep
    ? visibleFields.slice((step - 1) * FIELDS_PER_PAGE, step * FIELDS_PER_PAGE)
    : [];

  const getVisibleAnswers = () => {
    const answers: { label: string; value: string }[] = [];
    const processField = (field: FormField) => {
      if (!isFieldVisible(field)) return;
      const fieldKey = `field_${field.id}`;
      const raw = formData[fieldKey];
      let display = "";
      if (Array.isArray(raw)) {
        display = raw.length > 0 ? raw.join(", ") : "—";
      } else {
        display = raw ? String(raw) : "—";
      }
      answers.push({ label: field.label, value: display });
      fields
        .filter((f) => f.parent_field_id === field.id)
        .sort((a, b) => a.position - b.position)
        .forEach(processField);
    };
    fields
      .filter((f) => !f.parent_field_id)
      .sort((a, b) => a.position - b.position)
      .forEach(processField);
    return answers;
  };

  const resolveStatus = (): string => {
    const defaultStatus = statuses.length > 0 ? statuses[0].key : formStatus;

    // Reúne TODAS as perguntas com regra de redirecionamento (data ou opção)
    // e processa na ordem do formulário (position). Primeira que tiver resposta válida vence.
    const ruleFields = fields
      .filter(f =>
        (f.date_status_ranges && f.field_type === "date") ||
        (f.status_mapping && Object.keys(f.status_mapping).length > 0)
      )
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    if (ruleFields.length === 0) return formStatus;

    // Pass 1: tenta resolver por respostas efetivamente preenchidas
    for (const f of ruleFields) {
      const fieldKey = `field_${f.id}`;
      const answer = formData[fieldKey];
      const hasAnswer = !(answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0));

      // Campo de data
      if (f.date_status_ranges && f.field_type === "date") {
        if (!hasAnswer) continue; // sem resposta -> ignora aqui (no_answer só na pass 2)
        const config = f.date_status_ranges;
        const diffMs = Date.now() - new Date(answer as string).getTime();
        const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
        const sortedRanges = [...config.ranges].sort((a, b) => a.max_years - b.max_years);
        for (const range of sortedRanges) {
          if (diffYears <= range.max_years && range.status_key) return range.status_key;
        }
        if (config.above_all) return config.above_all;
        continue;
      }

      // Campo de opção (status_mapping)
      if (f.status_mapping && Object.keys(f.status_mapping).length > 0) {
        if (!hasAnswer) continue;
        const mapping = f.status_mapping;
        if (typeof answer === "string" && mapping[answer]) return mapping[answer];
        if (Array.isArray(answer)) {
          for (const v of answer) {
            if (mapping[v]) return mapping[v];
          }
        }
        if (mapping["__any__"]) return mapping["__any__"];
      }
    }

    // Pass 2: nenhuma pergunta foi respondida com regra ativa.
    // Aplica fallback "no_answer" do primeiro campo de data sem resposta.
    for (const f of ruleFields) {
      if (f.date_status_ranges && f.field_type === "date") {
        const fieldKey = `field_${f.id}`;
        const answer = formData[fieldKey];
        const hasAnswer = !(answer === undefined || answer === null || (typeof answer === "string" && !answer.trim()));
        if (!hasAnswer && f.date_status_ranges.no_answer) {
          return f.date_status_ranges.no_answer;
        }
      }
    }

    return defaultStatus;
  };

  const handleSubmit = async () => {
    // Validate all required visible fields
    const missing = visibleFields.filter(f => {
      if (!f.is_required) return false;
      const val = formData[`field_${f.id}`];
      if (val === undefined || val === null || val === "") return true;
      if (Array.isArray(val) && val.length === 0) return true;
      return false;
    });
    if (missing.length > 0) {
      toast.error(`Preencha o campo obrigatório: ${missing[0].label}`);
      return;
    }

    // Validate scheduling fields when "Sim"
    if (agendou === "sim") {
      if (!agDate || !agTime || !agFormaPagamento || !agCanal) {
        toast.error("Preencha todos os campos do agendamento.");
        return;
      }
    }

    setSaving(true);

    // Server-side check: telefone já existe no banco?
    try {
      const { nome: _n, telefone: phoneCheck } = resolveLeadIdentity(
        normalizeLeadData({ ...formData }, fields),
        fields,
      );
      const digitsCheck = (phoneCheck || "").replace(/\D/g, "");
      if (digitsCheck.length >= 8 && navigator.onLine) {
        const { data: dup } = await supabase.rpc("find_lead_by_phone", { _phone: digitsCheck });
        const row = Array.isArray(dup) ? dup[0] : null;
        if (row) {
          setSaving(false);
          setDuplicateInfo({
            leadId: row.lead_id,
            ownerName: row.owner_name || "outro vendedor",
            isMine: !!row.is_mine,
          });
          return;
        }
      }
    } catch {}


    // Resolve final status: if agendou=sim → status "agendado" (if exists), else use rules
    let resolvedStatus = resolveStatus();
    if (agendou === "sim") {
      const agendadoStatus = statuses.find(s => s.key === "agendado");
      if (agendadoStatus) resolvedStatus = "agendado";
    }

    // Merge observacao into data so it's persisted on the lead
    const finalData: Record<string, any> = normalizeLeadData({ ...formData }, fields);
    if (observacao.trim()) finalData.observacao = observacao.trim();

    const { nome: leadName, telefone: leadPhone, idade: leadIdade } = resolveLeadIdentity(finalData, fields);

    // Build appointment payload (if scheduling)
    const apptPayload: (OfflineAppointmentPayload & { idade?: string }) | undefined = agendou === "sim" ? {
      scheduled_datetime: (() => {
        const [y, mo, d] = agDate.split("-").map(Number);
        const [h, m] = agTime.split(":").map(Number);
        return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
      })(),
      scheduled_by: user!.id,
      nome: leadName,
      telefone: leadPhone,
      idade: leadIdade,
      valor: 0,
      forma_pagamento: agFormaPagamento,
      canal_agendamento: agCanal,
      resumo: observacao.trim(),
      previous_status: resolvedStatus,
    } : undefined;

    const tempLeadId = crypto.randomUUID();
    const leadData = {
      id: tempLeadId,
      data: finalData,
      status: resolvedStatus,
      assigned_to: user?.id || null,
      created_by: user!.id,
      created_at: new Date().toISOString(),
      pending_appointment: apptPayload,
    };

    if (!isOnline) {
      addToOfflineQueue(leadData);
      toast.success(
        apptPayload
          ? "Lead e agendamento salvos offline! Serão sincronizados quando voltar a internet."
          : "Lead salvo offline! Será sincronizado quando tiver internet."
      );
      setSaving(false);
      setFormData({});
      setObservacao("");
      setAgendou("");
      setAgDate(""); setAgTime("09:00"); setAgFormaPagamento(""); setAgCanal("");
      setStep(0);
      navigate(apptPayload ? "/agendamentos" : "/");
      return;
    }

    // Check for existing lead with same name + phone (server-side)
    let existingLeadId: string | null = null;
    try {
        const nameField = fields.find((f) => f.is_name_field);
        const phoneField = fields.find((f) => f.is_phone_field);
        if (leadName && leadPhone && nameField && phoneField) {
        const digits = leadPhone.replace(/\D/g, "");
        const { data: matches } = await supabase
          .from("crm_leads")
          .select("id, data")
          .or(
            `data->>field_${nameField.id}.ilike.${leadName.trim()},data->>field_${phoneField.id}.ilike.%${digits}%`
          )
          .limit(20);
        const found = (matches || []).find((l: any) => {
          const d = (l.data || {}) as Record<string, any>;
          const eName = String(d[`field_${nameField.id}`] || "").trim().toLowerCase();
          const ePhone = String(d[`field_${phoneField.id}`] || "").replace(/\D/g, "");
          return eName === leadName.trim().toLowerCase() && ePhone === digits;
        });
        if (found) existingLeadId = found.id;
      }
    } catch {}

    let finalLeadId: string | null = existingLeadId;

    if (existingLeadId) {
      const { error } = await supabase.from("crm_leads").update({
        data: finalData,
        status: resolvedStatus,
        assigned_to: user?.id || null,
      }).eq("id", existingLeadId);
      if (error) {
        addToOfflineQueue(leadData);
        toast.warning("Erro ao atualizar. Salvo offline.");
        setSaving(false);
        navigate(apptPayload ? "/agendamentos" : "/");
        return;
      }
      toast.success("Lead já existia — informações atualizadas!");
    } else {
      const { data: inserted, error } = await supabase.from("crm_leads").insert({
        data: finalData,
        status: resolvedStatus,
        assigned_to: user?.id || null,
        created_by: user!.id,
      }).select("id").single();
      if (error || !inserted) {
        addToOfflineQueue(leadData);
        toast.warning("Erro ao enviar. Salvo offline para sincronizar depois.");
        setSaving(false);
        navigate(apptPayload ? "/agendamentos" : "/");
        return;
      }
      finalLeadId = inserted.id;
      toast.success("Lead criado com sucesso!");
    }

    // Create appointment online
    if (apptPayload && finalLeadId) {
      const { error: aErr } = await supabase.from("crm_appointments").insert({
        lead_id: finalLeadId,
        scheduled_by: apptPayload.scheduled_by,
        scheduled_datetime: apptPayload.scheduled_datetime,
        nome: apptPayload.nome,
        telefone: apptPayload.telefone,
        idade: (apptPayload as any).idade || "",
        valor: apptPayload.valor,
        forma_pagamento: apptPayload.forma_pagamento,
        canal_agendamento: apptPayload.canal_agendamento,
        resumo: apptPayload.resumo || "",
        previous_status: apptPayload.previous_status,
      });
      if (aErr) {
        toast.warning("Lead salvo, mas erro ao agendar: " + aErr.message);
      } else {
        toast.success("Agendamento criado!");
      }
    }

    setSaving(false);
    setFormData({});
    setObservacao("");
    setAgendou("");
    setAgDate(""); setAgTime("09:00"); setAgFormaPagamento(""); setAgCanal("");
    setStep(0);
    navigate(apptPayload ? "/agendamentos" : "/");
  };

  const renderFormField = (field: FormField) => {
    const fieldKey = `field_${field.id}`;
    const value = formData[fieldKey] || "";

    return (
      <div key={field.id} className={`space-y-2 ${field.parent_field_id ? "ml-4 pl-3 border-l-2 border-primary/20" : ""}`}>
        <Label>
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>

        {field.field_type === "select" && field.options && (
          <Select value={value} onValueChange={(v) => set(fieldKey, v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {field.options.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field.field_type === "checkbox_group" && field.options && (
          <div className="flex flex-wrap gap-2">
            {field.options.map((opt) => {
              const arr: string[] = formData[fieldKey] || [];
              const checked = arr.includes(opt);
              return (
                <label
                  key={opt}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                    checked ? "bg-primary/10 border-primary text-primary" : "bg-muted/50 border-border text-foreground hover:bg-muted"
                  }`}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggleArray(fieldKey, opt)} className="h-3.5 w-3.5" />
                  {opt}
                </label>
              );
            })}
          </div>
        )}

        {field.field_type === "textarea" && (
          <Textarea value={value} onChange={(e) => set(fieldKey, e.target.value)} rows={3} />
        )}

        {field.field_type === "phone" && (
          <Input
            type="tel"
            inputMode="numeric"
            placeholder="(00) 00000-0000"
            value={formatPhoneBR(value)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
              set(fieldKey, digits);
            }}
            required={field.is_required}
            maxLength={16}
          />
        )}

        {field.field_type === "date" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4 text-destructive" />
                {value ? format(new Date(value + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={value ? new Date(value + "T00:00:00") : undefined}
                onSelect={(d) => set(fieldKey, d ? format(d, "yyyy-MM-dd") : "")}
                locale={ptBR}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        )}

        {["text", "number", "email"].includes(field.field_type) && (
          <Input
            type={field.field_type}
            value={value}
            onChange={(e) => set(fieldKey, e.target.value)}
            required={field.is_required}
          />
        )}

        {/* Fallback for unknown field types (e.g. cached PWA with old bundle) */}
        {!["select", "checkbox_group", "textarea", "phone", "text", "number", "date", "email"].includes(field.field_type) && (
          <Input
            type="text"
            value={value}
            onChange={(e) => set(fieldKey, e.target.value)}
            required={field.is_required}
          />
        )}
      </div>
    );
  };

  const offlineCount = getOfflineQueue().length;

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Novo Lead</h1>
            <p className="text-xs text-muted-foreground">
              Passo {step + 1} de {totalSteps}
            </p>
          </div>
          {!isOnline && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 text-xs font-medium">
              <WifiOff className="h-3.5 w-3.5" />
              Offline
            </div>
          )}
          {offlineCount > 0 && (
            <div className="text-xs text-muted-foreground">
              {offlineCount} pendente{offlineCount !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted rounded-full mb-6 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Step 0: Basic info */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Input value={companies.map(c => c.name).join(", ") || "—"} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>Vendedor Responsável</Label>
              <Input value={currentUserName || "—"} readOnly className="bg-muted" />
            </div>
            {!fields.some(f => (f.status_mapping && Object.keys(f.status_mapping).length > 0) || f.date_status_ranges) ? (
              <div className="space-y-2">
                <Label>Coluna (Status) <span className="text-destructive">*</span></Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                ℹ️ A coluna será definida automaticamente com base nas respostas.
              </p>
            )}
          </div>
        )}

        {/* Field pages */}
        {step > 0 && !isPreviewStep && (
          <div className="space-y-4">
            {currentPageFields.map(renderFormField)}
          </div>
        )}

        {/* Preview step */}
        {isPreviewStep && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              📋 Confira as respostas antes de salvar o lead:
            </p>
            <div className="rounded-lg border bg-muted/30 divide-y divide-border">
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-sm font-medium text-muted-foreground">Empresa</span>
                <span className="text-sm text-foreground font-medium">
                  {companies.map(c => c.name).join(", ") || "—"}
                </span>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5">
                <span className="text-sm font-medium text-muted-foreground">Vendedor</span>
                <span className="text-sm text-foreground font-medium">{currentUserName || "—"}</span>
              </div>
              {getVisibleAnswers().map((item, i) => (
                <div key={i} className="flex justify-between items-start px-4 py-2.5 gap-4">
                  <span className="text-sm font-medium text-muted-foreground shrink-0">{item.label}</span>
                  <span className="text-sm text-foreground font-medium text-right">{item.value}</span>
                </div>
              ))}
            </div>

            {/* Observação */}
            <div className="space-y-2 pt-2">
              <Label>Observação</Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Adicione uma observação sobre o lead (opcional)"
                rows={3}
              />
            </div>

            {/* Agendou consulta? */}
            <div className="space-y-2 pt-2">
              <Label>Agendou a consulta? <span className="text-destructive">*</span></Label>
              <Select value={agendou} onValueChange={(v) => setAgendou(v as "sim" | "nao")}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {agendou === "sim" && (
              <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-medium text-primary">📅 Dados do Agendamento</p>

                <div className="space-y-2">
                  <Label>Data <span className="text-destructive">*</span></Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !agDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4 text-destructive" />
                        {agDate ? format(new Date(agDate + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={agDate ? new Date(agDate + "T00:00:00") : undefined}
                        onSelect={(d) => setAgDate(d ? format(d, "yyyy-MM-dd") : "")}
                        locale={ptBR}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Horário <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive pointer-events-none" />
                    <Input type="time" value={agTime} onChange={(e) => setAgTime(e.target.value)} className="pl-10" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Forma de Pagamento <span className="text-destructive">*</span></Label>
                  <Select value={agFormaPagamento} onValueChange={setAgFormaPagamento}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {FORMAS_PAGAMENTO.map((fp) => (
                        <SelectItem key={fp} value={fp}>{fp}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Canal de Agendamento <span className="text-destructive">*</span></Label>
                  <Select value={agCanal} onValueChange={setAgCanal}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {CANAIS_AGENDAMENTO.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
          {step < previewStep ? (
            <Button className="flex-1" onClick={() => {
              // Validate required fields on current page
              if (step > 0) {
                const missing = currentPageFields.filter(f => {
                  if (!f.is_required) return false;
                  const val = formData[`field_${f.id}`];
                  if (val === undefined || val === null || val === "") return true;
                  if (Array.isArray(val) && val.length === 0) return true;
                  return false;
                });
                if (missing.length > 0) {
                  toast.error(`Preencha o campo obrigatório: ${missing[0].label}`);
                  return;
                }
              }
              setStep(step + 1);
            }} disabled={step === 0 && !formStatus}>
              {step === previewStep - 1
                ? <><Eye className="h-4 w-4 mr-1" /> Revisar</>
                : <>Próximo <ChevronRight className="h-4 w-4 ml-1" /></>
              }
            </Button>
          ) : (
            <Button className="flex-1" onClick={handleSubmit} disabled={saving}>
              {saving ? "Salvando..." : <><Check className="h-4 w-4 mr-1" /> Confirmar</>}
            </Button>
          )}
        </div>
      </div>
      <AlertDialog open={!!duplicateInfo} onOpenChange={(o) => !o && setDuplicateInfo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {duplicateInfo?.isMine ? "Lead já cadastrado" : "Telefone já cadastrado"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateInfo?.isMine
                ? "Esse lead já está cadastrado em sua carteira. Deseja abrir o cadastro para atualizá-lo?"
                : `Esse lead já está cadastrado pelo vendedor ${duplicateInfo?.ownerName}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            {duplicateInfo?.isMine && (
              <AlertDialogAction
                onClick={() => {
                  if (duplicateInfo) {
                    navigate(`/leads?edit=${duplicateInfo.leadId}`);
                  }
                }}
              >
                Atualizar lead
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
