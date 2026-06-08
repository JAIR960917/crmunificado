/**
 * Configuração de dias com exame de vista por empresa, especialistas e cores por loja.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import EyeExamDaySpecialistDialog from "@/components/settings/EyeExamDaySpecialistDialog";
import {
  resolveCompanyExamColor,
  toExamDateKey,
  type CompanyWithExamColor,
  type EyeExamSpecialist,
} from "@/lib/eyeExamSchedule";

type ExamDayRow = {
  id: string;
  exam_date: string;
  specialistIds: string[];
  specialistNames: string[];
};

export default function CompanyEyeExamDaysManager() {
  const [companies, setCompanies] = useState<CompanyWithExamColor[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [focusMonth, setFocusMonth] = useState(() => new Date());
  const [examDays, setExamDays] = useState<ExamDayRow[]>([]);
  const [specialists, setSpecialists] = useState<EyeExamSpecialist[]>([]);
  const [newSpecialistName, setNewSpecialistName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingColor, setSavingColor] = useState(false);
  const [addingSpecialist, setAddingSpecialist] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<string>("");
  const [dialogDayId, setDialogDayId] = useState<string | null>(null);
  const [dialogAssignedIds, setDialogAssignedIds] = useState<string[]>([]);

  const loadCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, exam_schedule_color")
      .order("name");
    if (error) {
      toast.error("Erro ao carregar empresas");
      return;
    }
    const list = (data || []) as CompanyWithExamColor[];
    setCompanies(list);
    if (list.length > 0) setCompanyId((prev) => prev || list[0].id);
  }, []);

  const loadSpecialists = useCallback(async () => {
    const { data, error } = await supabase
      .from("eye_exam_specialists")
      .select("id, name, active")
      .order("name");
    if (error) {
      toast.error("Erro ao carregar especialistas");
      return;
    }
    setSpecialists((data || []) as EyeExamSpecialist[]);
  }, []);

  const loadExamDays = useCallback(async (cid: string) => {
    if (!cid) {
      setExamDays([]);
      return;
    }
    const { data, error } = await supabase
      .from("company_eye_exam_days")
      .select(`
        id,
        exam_date,
        company_eye_exam_day_specialists (
          specialist_id,
          eye_exam_specialists ( name )
        )
      `)
      .eq("company_id", cid);
    if (error) {
      toast.error("Erro ao carregar dias de exame");
      return;
    }
    const rows: ExamDayRow[] = (data || []).map((row) => {
      const links = (row as {
        company_eye_exam_day_specialists?: {
          specialist_id: string;
          eye_exam_specialists: { name: string } | null;
        }[];
      }).company_eye_exam_day_specialists || [];
      return {
        id: row.id,
        exam_date: String(row.exam_date).slice(0, 10),
        specialistIds: links.map((l) => l.specialist_id),
        specialistNames: links.map((l) => l.eye_exam_specialists?.name || "—"),
      };
    });
    setExamDays(rows);
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await Promise.all([loadCompanies(), loadSpecialists()]);
      setLoading(false);
    })();
  }, [loadCompanies, loadSpecialists]);

  useEffect(() => {
    if (companyId) void loadExamDays(companyId);
  }, [companyId, loadExamDays]);

  const selectedCompany = companies.find((c) => c.id === companyId);
  const companyColorIndex = useMemo(
    () => new Map(companies.map((c, i) => [c.id, i])),
    [companies],
  );
  const companyColor = selectedCompany
    ? resolveCompanyExamColor(selectedCompany, companyColorIndex.get(selectedCompany.id) ?? 0)
    : "#3B82F6";

  const examDateKeys = useMemo(() => new Set(examDays.map((d) => d.exam_date)), [examDays]);
  const selectedDates = useMemo(
    () => [...examDateKeys].map((d) => parseISO(`${d}T12:00:00`)),
    [examDateKeys],
  );
  const sortedDays = useMemo(
    () => [...examDays].sort((a, b) => a.exam_date.localeCompare(b.exam_date)),
    [examDays],
  );

  const openDayDialog = (date: Date | undefined) => {
    if (!date || !companyId) return;
    const key = toExamDateKey(date);
    const existing = examDays.find((d) => d.exam_date === key);
    setDialogDate(key);
    setDialogDayId(existing?.id ?? null);
    setDialogAssignedIds(existing?.specialistIds ?? []);
    setDialogOpen(true);
  };

  const handleColorChange = async (color: string) => {
    if (!companyId) return;
    setSavingColor(true);
    try {
      const { error } = await supabase
        .from("companies")
        .update({ exam_schedule_color: color })
        .eq("id", companyId);
      if (error) throw error;
      setCompanies((prev) =>
        prev.map((c) => (c.id === companyId ? { ...c, exam_schedule_color: color } : c)),
      );
      toast.success("Cor da loja atualizada");
    } catch {
      toast.error("Erro ao salvar cor");
    } finally {
      setSavingColor(false);
    }
  };

  const addSpecialist = async () => {
    const name = newSpecialistName.trim();
    if (!name) return;
    setAddingSpecialist(true);
    try {
      const { error } = await supabase.from("eye_exam_specialists").insert({ name });
      if (error) throw error;
      setNewSpecialistName("");
      await loadSpecialists();
      toast.success("Especialista adicionado");
    } catch {
      toast.error("Erro ao adicionar especialista");
    } finally {
      setAddingSpecialist(false);
    }
  };

  const removeSpecialist = async (id: string) => {
    try {
      const { error } = await supabase.from("eye_exam_specialists").delete().eq("id", id);
      if (error) throw error;
      await loadSpecialists();
      if (companyId) await loadExamDays(companyId);
      toast.success("Especialista removido");
    } catch {
      toast.error("Erro ao remover especialista (pode estar em dias marcados)");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Cadastre empresas antes de configurar os dias de exame.</p>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Dias de exame de vista
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Cadastre os especialistas, defina a cor de cada loja e marque os dias de atendimento escolhendo quem
          atenderá. Na tela de Agendamentos, use a escala de especialistas para visualizar.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <Label className="flex items-center gap-2 text-sm font-semibold">
          <UserRound className="h-4 w-4" />
          Especialistas
        </Label>
        <div className="flex gap-2">
          <Input
            value={newSpecialistName}
            onChange={(e) => setNewSpecialistName(e.target.value)}
            placeholder="Nome do especialista"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addSpecialist();
              }
            }}
          />
          <Button type="button" size="sm" onClick={() => void addSpecialist()} disabled={addingSpecialist}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {specialists.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum especialista cadastrado.</p>
        ) : (
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {specialists.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm px-2 py-1 rounded hover:bg-muted/50">
                <span>{s.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => void removeSpecialist(s.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label>Empresa</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a empresa" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Cor da loja no calendário</Label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={companyColor}
            disabled={savingColor || !companyId}
            onChange={(e) => void handleColorChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded border border-input bg-transparent p-1"
          />
          <span className="text-xs text-muted-foreground">
            Especialistas nesta loja aparecem com esta cor na escala.
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Calendário — clique no dia para escolher especialistas
          </Label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setFocusMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setFocusMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Calendar
          month={focusMonth}
          onMonthChange={setFocusMonth}
          onDayClick={(day) => openDayDialog(day)}
          locale={ptBR}
          className="p-0 pointer-events-auto"
          modifiers={{ examDay: selectedDates }}
          modifiersClassNames={{
            examDay: "!text-white hover:!text-white rounded-md",
          }}
          modifiersStyles={{
            examDay: { backgroundColor: companyColor },
          }}
        />
      </div>

      {sortedDays.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{sortedDays.length} dia(s) na escala</Label>
          <ul className="max-h-48 overflow-y-auto space-y-1 rounded-lg border divide-y">
            {sortedDays.map((day) => (
              <li key={day.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p>{format(parseISO(`${day.exam_date}T12:00:00`), "dd/MM/yyyy (EEEE)", { locale: ptBR })}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {day.specialistNames.length > 0 ? day.specialistNames.join(", ") : "Sem especialistas"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => {
                    setDialogDate(day.exam_date);
                    setDialogDayId(day.id);
                    setDialogAssignedIds(day.specialistIds);
                    setDialogOpen(true);
                  }}
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <EyeExamDaySpecialistDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        examDate={dialogDate}
        specialists={specialists}
        assignedIds={dialogAssignedIds}
        eyeExamDayId={dialogDayId}
        onSaved={() => {
          if (companyId) void loadExamDays(companyId);
        }}
      />
    </div>
  );
}
