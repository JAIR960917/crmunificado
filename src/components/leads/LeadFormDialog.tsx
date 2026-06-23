import { useState, useEffect, useMemo, useCallback } from "react";
import { buildVisibleFormFieldOrder } from "@/lib/formFieldOrder";
import { formatVisualAcuityDisplay, formatVisualAcuityReview, parseVisualAcuity } from "@/lib/visualAcuity";
import VisualAcuityInput from "@/components/forms/VisualAcuityInput";
import CidadeEstadoInput from "@/components/forms/CidadeEstadoInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatPhoneBR } from "@/lib/phoneFormat";
import { ArrowLeft, Check, Eye, Plus, CalendarClock, CheckCircle2, AlertTriangle, Trash2, Clock, FileText, Pencil, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolveLeadIdentity } from "@/lib/leadIdentity";
import ContactAttemptForm from "./ContactAttemptForm";
import { recordCardOpen } from "@/lib/cardOpens";
import { resolveLeadStatusFromData } from "@/lib/resolveLeadStatus";

type Profile = { user_id: string; full_name: string; email?: string; avatar_url?: string | null; company_id?: string | null };
type Company = { id: string; name: string };

type FormField = {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
  position: number;
  is_required: boolean;
  is_name_field?: boolean;
  is_phone_field?: boolean;
  parent_field_id: string | null;
  parent_trigger_value: string | null;
  show_at_end?: boolean;
  appear_after_field_id?: string | null;
  status_mapping: Record<string, string> | null;
  date_status_ranges: { ranges: { max_years: number; status_key: string }[]; above_all: string; no_answer: string } | null;
};

type Activity = {
  id: string;
  lead_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  completed_at: string | null;
  created_by: string;
  created_at: string;
};

type Note = {
  id: string;
  lead_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type TimelineItem = {
  id: string;
  type: "activity" | "note";
  date: string;
  data: Activity | Note;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profiles: Profile[];
  /** Perfis permitidos no campo "Atribuído a" (gerente: vendedores da própria loja) */
  assignableProfiles?: Profile[];
  companies: Company[];
  currentUserName: string;
  formData: Record<string, any>;
  setFormData: (d: Record<string, any>) => void;
  formStatus: string;
  setFormStatus: (s: string) => void;
  formAssigned: string;
  setFormAssigned: (s: string) => void;
  saving: boolean;
  isEditing: boolean;
  canReassign?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  statusOptions: string[];
  statusLabels: Record<string, string>;
  leadId?: string | null;
  onActivityChange?: () => void;
  /** Atualiza o kanban quando a tratativa move o lead de coluna (ex.: Recomendação → fluxo normal). */
  onLeadStatusChange?: (fromStatus: string, toStatus: string, lead: Record<string, unknown>) => void;
};

const normalizeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const isFilledValue = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

const parseStoredDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  const raw = String(value).trim();
  if (!raw) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const parsed = new Date(`${brMatch[3]}-${brMatch[2]}-${brMatch[1]}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizePhoneDigits = (value: unknown): string => {
  if (value === null || value === undefined) return "";

  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length > 11 && digits.startsWith("55")) {
    return digits.slice(2, 13);
  }

  return digits.slice(0, 11);
};

const normalizeCheckboxValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== "string") return [];

  const raw = value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // noop
  }

  const splitValues = raw.split(/\s*[;,|]\s*/).map((item) => item.trim()).filter(Boolean);
  return splitValues.length > 1 ? splitValues : [raw];
};

const normalizeFieldValue = (field: FormField, value: unknown) => {
  if (!isFilledValue(value)) return field.field_type === "checkbox_group" ? [] : "";

  if (field.is_phone_field || field.field_type === "phone") {
    return normalizePhoneDigits(value);
  }

  if (field.field_type === "checkbox_group") {
    return normalizeCheckboxValue(value);
  }

  if (field.field_type === "date") {
    const parsed = parseStoredDate(value);
    if (!parsed) return typeof value === "string" ? value : "";
    return format(parsed, "yyyy-MM-dd");
  }

  if (field.field_type === "visual_acuity") {
    return parseVisualAcuity(value);
  }

  return typeof value === "string" ? value : String(value);
};

const findLegacyFieldValue = (field: FormField, data: Record<string, any>) => {
  const entries = Object.entries(data);
  const labelKey = normalizeKey(field.label);

  const directCandidates = [field.label, labelKey];
  for (const candidate of directCandidates) {
    if (isFilledValue(data[candidate])) return data[candidate];
  }

  const exactMatch = entries.find(([key]) => normalizeKey(key) === labelKey);
  if (exactMatch && isFilledValue(exactMatch[1])) return exactMatch[1];

  if (field.is_name_field) {
    const nameEntry = entries.find(([key]) => /nome|cliente|lead/.test(normalizeKey(key)));
    if (nameEntry && isFilledValue(nameEntry[1])) return nameEntry[1];
    if (isFilledValue(data.nome_lead)) return data.nome_lead;
  }

  if (field.is_phone_field) {
    const phoneEntry = entries.find(([key]) => /telefone|celular|whatsapp|fone/.test(normalizeKey(key)));
    if (phoneEntry && isFilledValue(phoneEntry[1])) return phoneEntry[1];
    if (isFilledValue(data.telefone)) return data.telefone;
  }

  if (labelKey.length > 3) {
    const fuzzyMatch = entries.find(([key]) => {
      const normalized = normalizeKey(key);
      return normalized.includes(labelKey) || labelKey.includes(normalized);
    });
    if (fuzzyMatch && isFilledValue(fuzzyMatch[1])) return fuzzyMatch[1];
  }

  return undefined;
};

const normalizeLeadDataForFields = (data: Record<string, any>, fields: FormField[]) => {
  const nextData = { ...data };

  // First pass: resolve values from legacy keys or direct field keys
  for (const field of fields) {
    const fieldKey = `field_${field.id}`;
    const currentValue = nextData[fieldKey];
    const fallbackValue = findLegacyFieldValue(field, data);
    const resolvedValue = isFilledValue(currentValue) ? currentValue : fallbackValue;

    if (resolvedValue !== undefined) {
      nextData[fieldKey] = normalizeFieldValue(field, resolvedValue);
    }
  }

  // Second pass: cross-reference sibling fields with same semantic role
  // e.g., if there are two phone fields and one has data, copy to the other
  const phoneFields = fields.filter((f) => f.is_phone_field);
  const nameFields = fields.filter((f) => f.is_name_field);

  const crossFill = (group: FormField[]) => {
    if (group.length < 2) return;
    const filledField = group.find((f) => isFilledValue(nextData[`field_${f.id}`]));
    if (!filledField) return;
    const filledValue = nextData[`field_${filledField.id}`];
    for (const f of group) {
      const key = `field_${f.id}`;
      if (!isFilledValue(nextData[key])) {
        nextData[key] = normalizeFieldValue(f, filledValue);
      }
    }
  };

  crossFill(phoneFields);
  crossFill(nameFields);

  // Normalize phone values: strip +55 country code prefix
  for (const pf of phoneFields) {
    const key = `field_${pf.id}`;
    const val = nextData[key];
    if (typeof val === "string" && val.startsWith("+55")) {
      nextData[key] = val.slice(3).replace(/\D/g, "");
    }
  }

  return nextData;
};

const formatStoredDateLabel = (value: unknown) => {
  const parsed = parseStoredDate(value);
  if (!parsed) return typeof value === "string" ? value : "Selecionar data";
  return format(parsed, "dd/MM/yyyy", { locale: ptBR });
};

export default function LeadFormDialog({
  open, onOpenChange, profiles, assignableProfiles, companies, currentUserName,
  formData, setFormData, formStatus, setFormStatus, formAssigned,
  setFormAssigned, saving, isEditing, canReassign, onSubmit, statusOptions, statusLabels,
  leadId, onActivityChange, onLeadStatusChange,
}: Props) {
  const { user, isAdmin } = useAuth();
  const [fields, setFields] = useState<FormField[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [profileRoles, setProfileRoles] = useState<Record<string, string>>({});

  // Derive the company name for the assigned user (or current user)
  const assignedCompanyName = useMemo(() => {
    const targetUserId = formAssigned || user?.id;
    if (!targetUserId) return "—";
    const profile = profiles.find((p) => p.user_id === targetUserId);
    if (!profile?.company_id) return "—";
    const company = companies.find((c) => c.id === profile.company_id);
    return company?.name || "—";
  }, [formAssigned, user?.id, profiles, companies]);

  // Timeline state
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [timelineFilter, setTimelineFilter] = useState<"all" | "activity" | "note">("all");

  // New activity form
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [actTitle, setActTitle] = useState("");
  const [actDescription, setActDescription] = useState("");
  const [actDatePart, setActDatePart] = useState<Date | undefined>(undefined);
  const [actTimePart, setActTimePart] = useState("09:00");
  const [actSaving, setActSaving] = useState(false);

  // Edit activity
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editActTitle, setEditActTitle] = useState("");
  const [editActDescription, setEditActDescription] = useState("");
  const [editActDatePart, setEditActDatePart] = useState<Date | undefined>(undefined);
  const [editActTimePart, setEditActTimePart] = useState("09:00");
  const [editActSaving, setEditActSaving] = useState(false);

  // New note
  const [newNote, setNewNote] = useState("");
  const [noteSending, setNoteSending] = useState(false);

  // Mandatory tratativa: enforced for non-admin users on edit mode
  const [tratativaRegistrada, setTratativaRegistrada] = useState(false);
  const [contactDirty, setContactDirty] = useState(false);
  const requiresTratativa = isEditing && !isAdmin;
  const reassignOptions = assignableProfiles ?? profiles;

  useEffect(() => {
    if (open) {
      setShowPreview(false);
      setShowNewActivity(false);
      setTimelineFilter("all");
      setTratativaRegistrada(false);
      supabase
        .from("crm_form_fields")
        .select("*")
        .order("position")
        .then(({ data }) => setFields((data || []) as unknown as FormField[]));
      supabase
        .from("user_roles")
        .select("user_id, role")
        .then(({ data }) => {
          const map: Record<string, string> = {};
          (data || []).forEach((r) => { map[r.user_id] = r.role; });
          setProfileRoles(map);
        });
      if (isEditing && leadId) {
        fetchActivities();
        fetchNotes();
        // Track card open for daily salesperson report
        if (user?.id) {
          recordCardOpen({ userId: user.id, cardType: "lead", leadId });
        }
      }
    }
  }, [open, leadId]);

  // Wrap onOpenChange to block close when there's an unsaved tratativa or required tratativa
  const handleOpenChange = (next: boolean) => {
    if (!next && contactDirty) {
      toast.error("Você iniciou uma tratativa. Clique em \"Salvar contato\" para concluir antes de fechar.");
      return;
    }
    if (!next && requiresTratativa && !tratativaRegistrada) {
      toast.error("Registre uma tratativa antes de fechar este lead.");
      return;
    }
    onOpenChange(next);
  };


  useEffect(() => {
    if (!open || fields.length === 0) return;
    const normalizedData = normalizeLeadDataForFields(formData, fields);
    if (JSON.stringify(normalizedData) !== JSON.stringify(formData)) {
      setFormData(normalizedData);
    }
  }, [open, fields, leadId, formData, setFormData]);

  const fetchActivities = async () => {
    if (!leadId) return;
    const { data } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    setActivities((data || []) as Activity[]);
  };

  const fetchNotes = async () => {
    if (!leadId) return;
    const { data } = await supabase
      .from("crm_lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    setNotes((data || []) as Note[]);
  };

  // Build timeline
  const timeline: TimelineItem[] = (() => {
    let items: TimelineItem[] = [];
    if (timelineFilter === "all" || timelineFilter === "activity") {
      items = items.concat(activities.map(a => ({ id: a.id, type: "activity" as const, date: a.created_at, data: a })));
    }
    if (timelineFilter === "all" || timelineFilter === "note") {
      items = items.concat(notes.map(n => ({ id: n.id, type: "note" as const, date: n.created_at, data: n })));
    }
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  })();

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

  const visibleFields = useMemo(
    () => buildVisibleFormFieldOrder(fields, isFieldVisible),
    [fields, isFieldVisible],
  );

  const renderFormField = (field: FormField) => {
    if (!isFieldVisible(field)) return null;
    const fieldKey = `field_${field.id}`;
    const rawValue = formData[fieldKey];
    const value = typeof rawValue === "string" ? rawValue : rawValue == null ? "" : String(rawValue);
    const checkboxValues = normalizeCheckboxValue(rawValue);
    const selectedDate = parseStoredDate(rawValue);

    return (
      <div key={field.id} className={`space-y-2 ${field.parent_field_id ? "ml-4 pl-3 border-l-2 border-primary/20" : ""}`}>
        <Label className="text-xs">
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>

        {field.field_type === "select" && field.options && (() => {
          const opts = field.options!;
          const hasValueInOptions = !value || opts.includes(value);
          return (
            <Select value={value} onValueChange={(v) => set(fieldKey, v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {!hasValueInOptions && value && (
                  <SelectItem key={`__saved_${value}`} value={value}>{value}</SelectItem>
                )}
                {opts.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}

        {field.field_type === "checkbox_group" && field.options && (
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((opt) => {
              const checked = checkboxValues.includes(opt);
              return (
                <label
                  key={opt}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                    checked ? "bg-primary/10 border-primary text-primary" : "bg-muted/50 border-border text-foreground hover:bg-muted"
                  }`}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggleArray(fieldKey, opt)} className="h-3 w-3" />
                  {opt}
                </label>
              );
            })}
          </div>
        )}

        {field.field_type === "textarea" && (
          <Textarea value={value} onChange={(e) => set(fieldKey, e.target.value)} rows={5} className="text-sm min-h-[120px]" />
        )}

        {(field.field_type === "phone" || field.is_phone_field) && (
          <Input
            type="tel"
            inputMode="numeric"
            placeholder="(00) 00000-0000"
            value={formatPhoneBR(normalizePhoneDigits(rawValue))}
            onChange={(e) => set(fieldKey, normalizePhoneDigits(e.target.value))}
            required={field.is_required}
            maxLength={16}
            className="h-9 text-sm"
          />
        )}

        {field.field_type === "visual_acuity" && (
          <VisualAcuityInput
            compact
            value={formData[fieldKey]}
            onChange={(v) => set(fieldKey, v)}
          />
        )}

        {field.field_type === "cidade_estado" && (
          <CidadeEstadoInput compact value={value} onChange={(v) => set(fieldKey, v)} />
        )}

        {field.field_type === "date" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-9 text-sm", !value && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4 text-destructive" />
                {value ? formatStoredDateLabel(rawValue) : "Selecionar data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => set(fieldKey, d ? format(d, "yyyy-MM-dd") : "")}
                locale={ptBR}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        )}

        {["text", "number", "email"].includes(field.field_type) && !field.is_phone_field && (
          <Input
            type={field.field_type}
            value={value}
            onChange={(e) => set(fieldKey, e.target.value)}
            required={field.is_required}
            className="h-9 text-sm"
          />
        )}

        {!['select', 'checkbox_group', 'textarea', 'phone', 'text', 'number', 'date', 'email', 'visual_acuity', 'cidade_estado'].includes(field.field_type) && !field.is_phone_field && (
          <Input
            type="text"
            value={value}
            onChange={(e) => set(fieldKey, e.target.value)}
            required={field.is_required}
            className="h-9 text-sm"
          />
        )}
      </div>
    );
  };

  const rootFields = fields.filter((f) => !f.parent_field_id).sort((a, b) => a.position - b.position);

  const renderFieldTree = (field: FormField): React.ReactNode => {
    const children = fields
      .filter((f) => f.parent_field_id === field.id)
      .sort((a, b) => a.position - b.position);
    return (
      <div key={field.id}>
        {renderFormField(field)}
        {children.map((child) => renderFieldTree(child))}
      </div>
    );
  };

  const hasMappingField = fields.some(f => (f.status_mapping && Object.keys(f.status_mapping).length > 0) || f.date_status_ranges);

  const getVisibleAnswers = () => {
    return visibleFields.map((field) => {
      const fieldKey = `field_${field.id}`;
      const raw = formData[fieldKey];
      let display = "";
      if (field.field_type === "visual_acuity" || (raw && typeof raw === "object" && !Array.isArray(raw))) {
        display = formatVisualAcuityReview(raw);
      } else if (Array.isArray(raw)) {
        display = raw.length > 0 ? raw.join(", ") : "—";
      } else {
        display = raw ? String(raw) : "—";
      }
      return { label: field.label, value: display };
    });
  };

  const handlePreview = () => setShowPreview(true);
  const handleBackToForm = () => setShowPreview(false);
  const handleConfirmSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(e); };

  // Activity handlers
  const handleCreateActivity = async () => {
    if (!actTitle.trim() || !actDatePart || !leadId || !user) {
      console.log("Missing data:", { actTitle, actDatePart, leadId, userId: user?.id });
      if (!actTitle.trim()) toast.error("Preencha o título");
      if (!actDatePart) toast.error("Preencha a data");
      return;
    }
    setActSaving(true);
    const [hh, mm] = actTimePart.split(":").map(Number);
    const scheduledDate = new Date(actDatePart);
    scheduledDate.setHours(hh || 0, mm || 0, 0, 0);
    const { error } = await supabase.from("lead_activities").insert({
      lead_id: leadId,
      title: actTitle.trim(),
      description: actDescription.trim() || null,
      scheduled_date: scheduledDate.toISOString(),
      created_by: user.id,
    } as any);
    if (error) { console.error("Activity insert error:", error); toast.error("Erro ao criar atividade: " + error.message); }
    else {
      toast.success("Atividade criada!");
      setActTitle(""); setActDescription(""); setActDatePart(undefined); setActTimePart("09:00");
      setShowNewActivity(false);
      fetchActivities();
      onActivityChange?.();
      setTratativaRegistrada(true);
    }
    setActSaving(false);
  };

  const handleToggleComplete = async (activity: Activity) => {
    const newVal = activity.completed_at ? null : new Date().toISOString();
    const { error } = await supabase.from("lead_activities").update({ completed_at: newVal }).eq("id", activity.id);
    if (error) toast.error("Erro ao atualizar atividade");
    else { fetchActivities(); onActivityChange?.(); if (newVal) setTratativaRegistrada(true); }
  };

  const handleDeleteActivity = async (id: string) => {
    const { error } = await supabase.from("lead_activities").delete().eq("id", id);
    if (error) toast.error("Erro ao remover");
    else { fetchActivities(); onActivityChange?.(); }
  };

  const startEditActivity = (act: Activity) => {
    setEditingActivityId(act.id);
    setEditActTitle(act.title);
    setEditActDescription(act.description || "");
    try {
      const d = new Date(act.scheduled_date);
      setEditActDatePart(d);
      setEditActTimePart(format(d, "HH:mm"));
    } catch {
      setEditActDatePart(undefined);
      setEditActTimePart("09:00");
    }
  };

  const handleUpdateActivity = async () => {
    if (!editingActivityId || !editActTitle.trim() || !editActDatePart) return;
    setEditActSaving(true);
    const [hh, mm] = editActTimePart.split(":").map(Number);
    const scheduledDate = new Date(editActDatePart);
    scheduledDate.setHours(hh || 0, mm || 0, 0, 0);
    const { error } = await supabase.from("lead_activities").update({
      title: editActTitle.trim(),
      description: editActDescription.trim() || null,
      scheduled_date: scheduledDate.toISOString(),
    }).eq("id", editingActivityId);
    if (error) toast.error("Erro ao atualizar: " + error.message);
    else {
      toast.success("Atividade atualizada!");
      setEditingActivityId(null);
      fetchActivities();
      onActivityChange?.();
      setTratativaRegistrada(true);
    }
    setEditActSaving(false);
  };

  // Note handlers
  const handleSendNote = async () => {
    if (!newNote.trim() || !leadId || !user) {
      console.log("Note missing data:", { newNote: newNote.trim(), leadId, userId: user?.id });
      return;
    }
    setNoteSending(true);
    const { error } = await supabase.from("crm_lead_notes").insert({
      lead_id: leadId, user_id: user.id, content: newNote.trim(),
    });
    if (error) { console.error("Note insert error:", error); toast.error("Erro ao adicionar comentário: " + error.message); }
    else {
      toast.success("Comentário adicionado!");
      setNewNote("");
      fetchNotes();
      onActivityChange?.();
    }
    setNoteSending(false);
  };

  const handleDeleteNote = async (id: string) => {
    const { error } = await supabase.from("crm_lead_notes").delete().eq("id", id);
    if (error) toast.error("Erro ao remover");
    else { fetchNotes(); onActivityChange?.(); }
  };

  const getActivityStatus = (act: Activity) => {
    if (act.completed_at) return "completed";
    const now = new Date();
    const scheduled = new Date(act.scheduled_date);
    if (scheduled < now) return "overdue";
    if (scheduled.toDateString() === now.toDateString()) return "today";
    return "pending";
  };

  const getProfile = (userId: string) => profiles.find(p => p.user_id === userId);

  const formatTimelineDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd/MM/yyyy, HH:mm", { locale: ptBR });
    } catch { return dateStr; }
  };

  const formatRelative = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ptBR });
    } catch { return ""; }
  };

  // ========== RENDER ==========

  // CREATE MODE — simple dialog
  if (!isEditing) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{showPreview ? "📋 Revisão das Respostas" : "Novo Lead"}</DialogTitle>
          </DialogHeader>

          {showPreview ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Confira as respostas antes de salvar o lead:</p>
              <div className="rounded-lg border bg-muted/30 divide-y divide-border">
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-sm font-medium text-muted-foreground">Empresa</span>
                  <span className="text-sm text-foreground font-medium">{assignedCompanyName}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-sm font-medium text-muted-foreground">Vendedor</span>
                  <span className="text-sm text-foreground font-medium">{currentUserName || "—"}</span>
                </div>
                {!hasMappingField && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm font-medium text-muted-foreground">Coluna</span>
                    <span className="text-sm text-foreground font-medium">{statusLabels[formStatus] || formStatus}</span>
                  </div>
                )}
                {getVisibleAnswers().map((item, i) => (
                  <div key={i} className="flex justify-between items-start px-4 py-2.5 gap-4">
                    <span className="text-sm font-medium text-muted-foreground shrink-0">{item.label}</span>
                    <span className="text-sm text-foreground font-medium text-right whitespace-pre-line">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={handleBackToForm}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Button type="button" className="flex-1" disabled={saving} onClick={handleConfirmSubmit}>
                  {saving ? "Salvando..." : <><Check className="h-4 w-4 mr-1" /> Confirmar</>}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (fields.length > 0) handlePreview(); else onSubmit(e); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Empresa</Label>
                <Input value={assignedCompanyName} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Vendedor Responsável</Label>
                <Input value={currentUserName || "—"} readOnly className="bg-muted" />
              </div>
              {!hasMappingField && (
                <div className="space-y-2">
                  <Label>Coluna (Status) <span className="text-destructive">*</span></Label>
                  <Select value={formStatus} onValueChange={setFormStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {hasMappingField && (
                <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                  ℹ️ A coluna será definida automaticamente com base nas respostas.
                </p>
              )}
              {visibleFields.map((field) => renderFormField(field))}
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma pergunta configurada. Vá em "Formulário" no menu para criar perguntas.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={saving}>
                {fields.length > 0 ? <><Eye className="h-4 w-4 mr-1" /> Revisar Respostas</> : "Enviar"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // EDIT MODE — split layout
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[1100px] p-0 flex flex-col overflow-y-auto md:overflow-hidden">
        <div className="flex flex-col md:flex-row flex-1 md:overflow-hidden">
          {/* LEFT PANEL — Lead Data */}
          <div className="md:w-[420px] md:min-w-[420px] md:border-r border-b md:border-b-0 flex flex-col md:overflow-hidden bg-card">
            <div className="px-5 py-4 border-b">
              <DialogTitle className="text-lg font-bold">Editar Lead</DialogTitle>
            </div>
            <ScrollArea className="md:flex-1 px-5 py-4">
              <form id="lead-edit-form" onSubmit={(e) => {
                e.preventDefault();
                if (requiresTratativa && !tratativaRegistrada) {
                  toast.error("Registre uma tratativa antes de salvar este lead.");
                  return;
                }
                onSubmit(e);
              }} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Empresa</Label>
                  <Input value={assignedCompanyName} readOnly className="bg-muted h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Vendedor Responsável</Label>
                  <Input value={currentUserName || "—"} readOnly className="bg-muted h-9 text-sm" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Coluna (Status)</Label>
                  <Select value={formStatus} onValueChange={setFormStatus}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {canReassign && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Atribuído a</Label>
                    <Select value={formAssigned || "__none__"} onValueChange={(v) => setFormAssigned(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Ninguém" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Ninguém</SelectItem>
                        {reassignOptions.map((p) => {
                          const roleLabel = profileRoles[p.user_id] ? ` (${profileRoles[p.user_id]})` : "";
                          return (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {(p.full_name || p.email)}{roleLabel}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="border-t pt-3 mt-3" />
                {visibleFields.map((field) => renderFormField(field))}

                <Button type="submit" className="w-full mt-4" disabled={saving}>
                  {saving ? "Salvando..." : "Atualizar"}
                </Button>
              </form>
            </ScrollArea>
          </div>

          {/* RIGHT PANEL — Timeline */}
          <div className="flex-1 flex flex-col md:overflow-hidden">
            {/* Tabs */}
            <div className="px-5 py-3 border-b flex items-center gap-1 flex-wrap">
              {[
                { key: "all", label: "Atividade" },
                { key: "note", label: "Comentário" },
                { key: "activity", label: "Tarefa" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setTimelineFilter(tab.key as any)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    timelineFilter === tab.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Contact attempt form */}
            {leadId && user && (
              <div className="px-5 py-3 border-b">
                {requiresTratativa && !tratativaRegistrada && (
                  <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>É obrigatório registrar uma tratativa antes de fechar ou salvar este lead.</span>
                  </div>
                )}
                <ContactAttemptForm
                  leadId={leadId}
                  userId={user.id}
                  leadStatus={formStatus}
                  leadSnapshot={(() => {
                    const identity = resolveLeadIdentity(formData, fields as any);
                    return {
                      nome: identity.nome || "Lead",
                      telefone: identity.telefone || "",
                      idade: identity.idade || "",
                    };
                  })()}
                  onSaved={async () => {
                    setTratativaRegistrada(true);
                    setContactDirty(false);
                    fetchNotes();

                    const previousStatus = formStatus;

                    // Após registrar uma tratativa, se o lead está em uma coluna
                    // definida pela "Forma de captação" (ex.: Recomendação), reavalia
                    // o status usando as demais regras do funil — sem alterar o valor
                    // do campo de captação no formulário.
                    try {
                      if (!leadId) return;

                      let newStatus = resolveLeadStatusFromData(
                        formData,
                        fields as any,
                        { excludeFieldsMappingTo: [previousStatus], fallbackStatus: undefined },
                      );

                      if (!newStatus) {
                        const { data: statuses } = await supabase
                          .from("crm_statuses")
                          .select("key, position")
                          .order("position", { ascending: true });
                        const first = (statuses ?? []).find((s: any) => s.key !== previousStatus);
                        if (first) newStatus = (first as any).key;
                      }

                      if (newStatus && newStatus !== previousStatus) {
                        // A tratativa marcou data.tratativa_status_key = previousStatus
                        // (ContactAttemptForm). Como o status mudou aqui, isso ficaria
                        // desatualizado e o card pareceria "não tratado" na nova coluna
                        // (sortKanbanByExamAndTratativa exige tratativa_status_key ===
                        // status atual) — por isso atualizamos os dois juntos.
                        const { data: curRow } = await supabase
                          .from("crm_leads")
                          .select("data")
                          .eq("id", leadId)
                          .maybeSingle();
                        const curData = (curRow?.data as Record<string, unknown>) || {};
                        const { error: upErr } = await supabase
                          .from("crm_leads")
                          .update({
                            status: newStatus,
                            data: { ...curData, tratativa_status_key: newStatus },
                          })
                          .eq("id", leadId);
                        if (!upErr) setFormStatus(newStatus);
                      }

                      const { data: fresh } = await supabase
                        .from("crm_leads")
                        .select("id, data, status, assigned_to, created_by, created_at, scheduled_date, comprou")
                        .eq("id", leadId)
                        .maybeSingle();

                      if (fresh) {
                        const resolvedStatus = (fresh.status as string) || newStatus || previousStatus;
                        // Sempre notifica o pai — mesmo quando o status nao muda — para
                        // que o card seja repatchado com data.tratativa_em e reordene
                        // para o fim da coluna (sem isso, o card tratado ficava parado
                        // no topo, pois o estado local nunca era atualizado).
                        onLeadStatusChange?.(previousStatus, resolvedStatus, fresh as Record<string, unknown>);
                      }
                    } catch (e) {
                      console.error("[tratativa] falha ao reavaliar status:", e);
                    }

                    onActivityChange?.();
                  }}
                  onDirtyChange={setContactDirty}
                />

              </div>
            )}

            {/* New activity / comment input */}
            <div className="px-5 py-3 border-b space-y-3">
              {!showNewActivity ? (

                <div className="flex gap-2">
                  <Input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Adicionar comentário..."
                    className="h-9 text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendNote(); } }}
                  />
                  <Button size="sm" onClick={handleSendNote} disabled={noteSending || !newNote.trim()} className="shrink-0">
                    Enviar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowNewActivity(true)} className="shrink-0">
                    <Plus className="h-4 w-4 mr-1" /> Tarefa
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <CalendarClock className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Nova Atividade</span>
                  </div>
                  <Input
                    value={actTitle}
                    onChange={(e) => setActTitle(e.target.value)}
                    placeholder="Título da atividade..."
                    className="h-9 text-sm"
                  />
                  <Textarea
                    value={actDescription}
                    onChange={(e) => setActDescription(e.target.value)}
                    placeholder="Descrição (opcional)..."
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="flex-1 justify-start text-left h-9 text-sm">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {actDatePart ? format(actDatePart, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={actDatePart} onSelect={setActDatePart} locale={ptBR} className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    <div className="relative">
                      <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="time" value={actTimePart} onChange={(e) => setActTimePart(e.target.value)} className="h-9 text-sm pl-9 w-[120px]" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowNewActivity(false)}>Cancelar</Button>
                    <Button size="sm" onClick={handleCreateActivity} disabled={actSaving || !actTitle.trim() || !actDatePart}>
                      {actSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Timeline */}
            <ScrollArea className="md:flex-1">
              <div className="px-5 py-4">
                {timeline.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-12">
                    Nenhuma atividade registrada ainda.
                  </p>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

                    <div className="space-y-4">
                      {timeline.map((item) => {
                        if (item.type === "activity") {
                          const act = item.data as Activity;
                          const status = getActivityStatus(act);
                          const profile = getProfile(act.created_by);
                          const canDelete = act.created_by === user?.id || isAdmin;

                          let iconBg = "bg-muted text-muted-foreground";
                          let statusBadge: React.ReactNode = null;

                          if (status === "completed") {
                            iconBg = "bg-emerald-100 text-emerald-600";
                            statusBadge = <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">CONCLUÍDA</span>;
                          } else if (status === "overdue") {
                            iconBg = "bg-red-100 text-red-600";
                            statusBadge = <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">ATRASADA</span>;
                          } else if (status === "today") {
                            iconBg = "bg-amber-100 text-amber-600";
                            statusBadge = <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">HOJE</span>;
                          } else {
                            iconBg = "bg-blue-100 text-blue-600";
                            statusBadge = <span className="text-[10px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">PENDENTE</span>;
                          }

                          let scheduledFormatted = "";
                          try {
                            scheduledFormatted = format(new Date(act.scheduled_date), "EEE, dd 'de' MMM, HH:mm", { locale: ptBR });
                          } catch { scheduledFormatted = act.scheduled_date; }

                          return (
                            <div key={item.id} className="relative pl-10 group">
                              {/* Timeline dot */}
                              <div className={`absolute left-1.5 top-1 w-5 h-5 rounded-full flex items-center justify-center ${iconBg}`}>
                                {status === "completed" ? <CheckCircle2 className="h-3 w-3" /> : 
                                 status === "overdue" ? <AlertTriangle className="h-3 w-3" /> :
                                 <CalendarClock className="h-3 w-3" />}
                              </div>

                              <div className={`rounded-lg border p-3 ${
                                status === "overdue" ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" :
                                status === "today" ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" :
                                status === "completed" ? "border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10" :
                                "border-border bg-card"
                              }`}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-foreground">Tarefa</span>
                                    {statusBadge}
                                    <span className="text-xs text-muted-foreground">{formatTimelineDate(act.created_at)}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {profile && (
                                      <Avatar className="h-5 w-5">
                                        <AvatarImage src={profile.avatar_url ?? undefined} />
                                        <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                          {(profile.full_name || "?").slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                    )}
                                    {canDelete && (
                                      <>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => startEditActivity(act)}>
                                          <Pencil className="h-3 w-3 text-muted-foreground" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => handleDeleteActivity(act.id)}>
                                          <Trash2 className="h-3 w-3 text-destructive" />
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {editingActivityId === act.id ? (
                                  <div className="mt-2 rounded-md bg-background/50 p-2.5 space-y-2">
                                    <Input
                                      value={editActTitle}
                                      onChange={(e) => setEditActTitle(e.target.value)}
                                      placeholder="Título..."
                                      className="h-8 text-sm"
                                    />
                                    <Textarea
                                      value={editActDescription}
                                      onChange={(e) => setEditActDescription(e.target.value)}
                                      placeholder="Descrição (opcional)..."
                                      rows={2}
                                      className="text-sm"
                                    />
                                    <div className="flex gap-2">
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <Button variant="outline" className="flex-1 justify-start text-left h-8 text-sm">
                                            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                            {editActDatePart ? format(editActDatePart, "dd/MM/yyyy", { locale: ptBR }) : "Data"}
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                          <Calendar mode="single" selected={editActDatePart} onSelect={setEditActDatePart} locale={ptBR} className="p-3 pointer-events-auto" />
                                        </PopoverContent>
                                      </Popover>
                                      <div className="relative">
                                        <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                        <Input type="time" value={editActTimePart} onChange={(e) => setEditActTimePart(e.target.value)} className="h-8 text-sm pl-8 w-[110px]" />
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingActivityId(null)}>Cancelar</Button>
                                      <Button size="sm" className="text-xs h-7" onClick={handleUpdateActivity} disabled={editActSaving || !editActTitle.trim() || !editActDatePart}>
                                        {editActSaving ? "Salvando..." : "Salvar"}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="mt-2 rounded-md bg-background/50 p-2.5">
                                      <div className="flex items-center gap-4 text-sm">
                                        <div>
                                          <span className="text-muted-foreground text-xs">Prazo</span>
                                          <p className={`font-medium text-xs ${status === "overdue" ? "text-red-600" : ""}`}>
                                            {scheduledFormatted}
                                          </p>
                                        </div>
                                        <div>
                                          <span className="text-muted-foreground text-xs">Título</span>
                                          <p className={`font-medium text-xs ${status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                                            {act.title}
                                          </p>
                                        </div>
                                      </div>
                                      {act.description && (
                                        <p className="text-xs text-muted-foreground mt-1.5">{act.description}</p>
                                      )}
                                      {profile && (
                                        <div className="mt-1.5">
                                          <span className="text-muted-foreground text-xs">Responsável</span>
                                          <p className="text-xs font-medium text-primary">{profile.full_name}</p>
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex gap-2 mt-2">
                                      <Button
                                        size="sm"
                                        variant={status === "completed" ? "outline" : "default"}
                                        className="text-xs h-7"
                                        onClick={() => handleToggleComplete(act)}
                                      >
                                        {status === "completed" ? "Reabrir" : "Concluir"}
                                      </Button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // Note item
                        const note = item.data as Note;
                        const profile = getProfile(note.user_id);
                        const canDelete = note.user_id === user?.id || isAdmin;

                        return (
                          <div key={item.id} className="relative pl-10 group">
                            <div className="absolute left-1.5 top-1 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                              <FileText className="h-3 w-3" />
                            </div>
                            <div className="rounded-lg border border-border bg-card p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">Comentário</span>
                                  <span className="text-xs text-muted-foreground">{formatTimelineDate(note.created_at)}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  {profile && (
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={profile.avatar_url ?? undefined} />
                                      <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                        {(profile.full_name || "?").slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                  {canDelete && (
                                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => handleDeleteNote(note.id)}>
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm text-foreground whitespace-pre-wrap mt-2">{note.content}</p>
                              {profile && (
                                <p className="text-xs text-muted-foreground mt-1.5">
                                  — {profile.full_name}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
