import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, ArrowRight, ArrowLeft, Check, AlertTriangle, FileSpreadsheet, Trash2, RefreshCw, Search } from "lucide-react";
import { resolveLeadIdentity } from "@/lib/leadIdentity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Step = "upload" | "columns" | "status" | "users" | "preview" | "importing";

const IGNORE_VALUE = "__ignore__";
const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseCsvLine = (line: string, separator = ";") => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === separator && !inQuotes) {
      cells.push(current.replace(/^\uFEFF/, "").trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.replace(/^\uFEFF/, "").trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
};

const parseCsvText = (text: string, separator = ";") => {
  const rows: string[][] = [];
  let currentLine = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentLine += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        currentLine += char;
      }
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (currentLine.trim()) rows.push(parseCsvLine(currentLine, separator));
      currentLine = "";
      if (char === "\r" && next === "\n") i += 1;
      continue;
    }

    currentLine += char;
  }

  if (currentLine.trim()) rows.push(parseCsvLine(currentLine, separator));
  return rows;
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

export default function ImportLeadsPage() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // Cross-check leads vs renovacoes by phone
  type DuplicateMatch = {
    leadId: string;
    leadName: string;
    leadPhone: string;
    renovacaoId: string;
    renovacaoName: string;
  };
  const [scanning, setScanning] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const extractPhones = (data: Record<string, any>): string[] => {
    const phones: string[] = [];
    const walk = (v: any) => {
      if (v == null) return;
      if (typeof v === "string" || typeof v === "number") {
        const digits = String(v).replace(/\D/g, "");
        if (digits.length >= 8) phones.push(digits.slice(-8));
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (typeof v === "object") {
        Object.values(v).forEach(walk);
      }
    };
    walk(data);
    return phones;
  };

  const scanDuplicates = async () => {
    setScanning(true);
    try {
      const [leadsRes, renovsRes, leadFieldsRes, renovFieldsRes] = await Promise.all([
        supabase.from("crm_leads").select("id, data").limit(10000),
        supabase.from("crm_renovacoes").select("id, data").limit(10000),
        supabase.from("crm_form_fields").select("id, label, is_name_field, is_phone_field"),
        supabase.from("crm_renovacao_form_fields").select("id, label, is_name_field, is_phone_field"),
      ]);
      if (leadsRes.error) throw leadsRes.error;
      if (renovsRes.error) throw renovsRes.error;

      const leadFields = (leadFieldsRes.data || []) as any[];
      const renovFields = (renovFieldsRes.data || []) as any[];

      // Build renovacao phone index: suffix(8) -> { id, name }
      const renovIndex = new Map<string, { id: string; name: string }>();
      (renovsRes.data || []).forEach((r: any) => {
        const data = (r.data || {}) as Record<string, any>;
        const identity = resolveLeadIdentity(data, renovFields);
        const phones = extractPhones(data);
        phones.forEach((suffix) => {
          if (!renovIndex.has(suffix)) {
            renovIndex.set(suffix, { id: r.id, name: identity.nome || "Sem nome" });
          }
        });
      });

      const matches: DuplicateMatch[] = [];
      const seen = new Set<string>();
      (leadsRes.data || []).forEach((l: any) => {
        const data = (l.data || {}) as Record<string, any>;
        const identity = resolveLeadIdentity(data, leadFields);
        const phones = extractPhones(data);
        for (const suffix of phones) {
          const ren = renovIndex.get(suffix);
          if (ren && !seen.has(l.id)) {
            seen.add(l.id);
            matches.push({
              leadId: l.id,
              leadName: identity.nome || "Sem nome",
              leadPhone: identity.telefone || suffix,
              renovacaoId: ren.id,
              renovacaoName: ren.name,
            });
            break;
          }
        }
      });

      setDuplicates(matches);
      toast.success(`${matches.length} lead(s) com telefone também em Renovações.`);
    } catch (err: any) {
      toast.error(`Erro ao verificar: ${err.message || err}`);
    } finally {
      setScanning(false);
    }
  };

  const deleteLeadById = async (leadId: string) => {
    setDeletingId(leadId);
    try {
      // Cascade-clean dependent tables first
      await Promise.all([
        supabase.from("crm_lead_notes").delete().eq("lead_id", leadId),
        supabase.from("lead_activities").delete().eq("lead_id", leadId),
        supabase.from("crm_appointments").delete().eq("lead_id", leadId),
        supabase.from("notifications").delete().eq("lead_id", leadId),
        supabase.from("scheduled_whatsapp_messages").delete().eq("lead_id", leadId),
      ]);
      const { error } = await supabase.from("crm_leads").delete().eq("id", leadId);
      if (error) throw error;
      setDuplicates((prev) => (prev ? prev.filter((d) => d.leadId !== leadId) : prev));
      toast.success("Lead excluído.");
    } catch (err: any) {
      toast.error(`Erro ao excluir: ${err.message || err}`);
    } finally {
      setDeletingId(null);
    }
  };

  const [deletingAll, setDeletingAll] = useState(false);
  const deleteAllDuplicates = async () => {
    if (!duplicates || duplicates.length === 0) return;
    setDeletingAll(true);
    try {
      const ids = duplicates.map((d) => d.leadId);
      const leadIdChunks = chunkArray(ids, 100);

      for (const leadIds of leadIdChunks) {
        const { error } = await supabase.from("crm_leads").delete().in("id", leadIds);
        if (error) throw error;
      }

      setDuplicates([]);
      toast.success(`${ids.length} lead(s) duplicado(s) excluído(s).`);
    } catch (err: any) {
      toast.error(`Erro ao excluir todos: ${err.message || err}`);
    } finally {
      setDeletingAll(false);
    }
  };


  const { data: formFields = [] } = useQuery({
    queryKey: ["import-form-fields"],
    queryFn: async () => {
      const { data } = await supabase.from("crm_form_fields").select("id, label, field_type, is_name_field, is_phone_field").order("position");
      return data || [];
    },
  });

  const { data: crmColumns = [] } = useQuery({
    queryKey: ["import-crm-columns"],
    queryFn: async () => {
      const { data } = await supabase.from("crm_columns").select("id, name, field_key, field_type").order("position");
      return data || [];
    },
  });

  const { data: statuses = [] } = useQuery({
    queryKey: ["import-statuses"],
    queryFn: async () => {
      const { data } = await supabase.from("crm_statuses").select("id, key, label").order("position");
      return data || [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["import-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return data || [];
    },
  });

  const nameField = useMemo(() => {
    const nameFields = formFields.filter((f) => f.is_name_field);
    return (
      nameFields.find((f) => {
        const label = norm(f.label);
        return label.includes("nome do lead") || label === "nome" || label.includes("lead");
      }) || nameFields[0]
    );
  }, [formFields]);

  const phoneField = useMemo(() => {
    const phoneFields = formFields.filter((f) => f.is_phone_field || f.field_type === "phone");
    return (
      phoneFields.find((f) => {
        const label = norm(f.label);
        return label.includes("telefone") || label.includes("celular") || label.includes("whatsapp");
      }) || phoneFields[0]
    );
  }, [formFields]);

  const mappedStatusHeader = useMemo(
    () => Object.entries(columnMap).find(([, value]) => value === "__status__")?.[0] || null,
    [columnMap],
  );

  const mappedAssignedHeader = useMemo(
    () => Object.entries(columnMap).find(([, value]) => value === "__assigned__")?.[0] || null,
    [columnMap],
  );

  const mappedCreatedAtHeader = useMemo(
    () => Object.entries(columnMap).find(([, value]) => value === "__created_at__")?.[0] || null,
    [columnMap],
  );

  const setColumnTarget = useCallback((header: string, value: string) => {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (value === IGNORE_VALUE) delete next[header];
      else next[header] = value;
      return next;
    });
  }, []);

  // Parse CSV with ; separator
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;

      const parsedRows = parseCsvText(text, ";");
      if (parsedRows.length < 2) { toast.error("Arquivo vazio ou inválido"); return; }

      const headers = parsedRows[0];
      const rows = parsedRows.slice(1).map((cols) => {
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = cols[i] || ""; });
        return row;
      });

      setCsvHeaders(headers.filter((h) => h));
      setCsvRows(rows);

      // Auto-map columns by label similarity (case + accent insensitive)
      const autoMap: Record<string, string> = {};
      formFields.forEach((ff) => {
        const target = norm(ff.label);
        const match = headers.find((h) => norm(h) === target);
        if (match) autoMap[match] = ff.id;
      });

      // Auto-map system columns: Etapa -> __status__, Responsável -> __assigned__, Criado -> __created_at__
      headers.forEach((h) => {
        const n = norm(h);
        if (!autoMap[h]) {
          if (n === "etapa" || n === "status") autoMap[h] = "__status__";
          else if (n === "responsavel" || n === "responsavel atual") autoMap[h] = "__assigned__";
          else if (n === "criado" || n === "data de criacao" || n === "criado em") autoMap[h] = "__created_at__";
        }
      });

      // Auto-map name field
      if (nameField) {
        const nomeHeader = headers.find((h) => {
          const n = norm(h);
          return n === "nome do lead" || n === "nome" || n === "nome cliente" || n === "nome do cliente" || n === "cliente";
        });
        if (nomeHeader && !autoMap[nomeHeader]) autoMap[nomeHeader] = nameField.id;
      }

      // Auto-map phone field
      if (phoneField) {
        const telHeader = headers.find((h) => {
          const n = norm(h);
          return n === "celular" || n === "telefone" || n === "whatsapp" || n === "fone" || n === "outro numero de telefone";
        });
        if (telHeader && !autoMap[telHeader]) autoMap[telHeader] = phoneField.id;
      }

      setColumnMap(autoMap);

      // Auto-map statuses
      const detectedStatusHeader = headers.find((h) => {
        const n = norm(h);
        return n === "etapa" || n === "status" || n === "status etapa";
      });
      const uniqueStatuses = detectedStatusHeader
        ? [...new Set(rows.map((r) => r[detectedStatusHeader]).filter(Boolean))]
        : [];
      const autoStatusMap: Record<string, string> = {};
      uniqueStatuses.forEach((s) => {
        const match = statuses.find((st) => st.label.toLowerCase() === s.toLowerCase());
        if (match) autoStatusMap[s] = match.key;
      });
      setStatusMap(autoStatusMap);

      // Auto-map users
      const detectedAssignedHeader = headers.find((h) => {
        const n = norm(h);
        return n === "responsavel" || n === "responsavel atual" || n === "vendedor" || n === "consultor";
      });
      const uniqueUsers = detectedAssignedHeader
        ? [...new Set(rows.map((r) => r[detectedAssignedHeader]).filter(Boolean))]
        : [];
      const autoUserMap: Record<string, string> = {};
      uniqueUsers.forEach((u) => {
        const match = profiles.find(
          (p) => p.full_name?.toLowerCase().trim() === u.toLowerCase().trim()
        );
        if (match) autoUserMap[u] = match.user_id;
      });
      setUserMap(autoUserMap);

      setStep("columns");
      toast.success(`${rows.length} leads encontrados no arquivo`);
    };
    reader.readAsText(file, "UTF-8");
  }, [formFields, statuses, profiles, nameField, phoneField]);

  // Unique CSV statuses and users
  const csvStatuses = useMemo(() => {
    if (!mappedStatusHeader) return [];
    return [...new Set(csvRows.map((r) => r[mappedStatusHeader]).filter(Boolean))];
  }, [csvRows, mappedStatusHeader]);

  const csvUsers = useMemo(() => {
    if (!mappedAssignedHeader) return [];
    return [...new Set(csvRows.map((r) => r[mappedAssignedHeader]).filter(Boolean))];
  }, [csvRows, mappedAssignedHeader]);

  // Build field options for column mapping (add special entries)
  const fieldOptions = useMemo(() => {
    const essentialIds = new Set([nameField?.id, phoneField?.id].filter(Boolean));
    const essentialOpts = [nameField, phoneField]
      .filter(Boolean)
      .map((f) => ({
        value: f.id,
        label: `⭐ ${f.label}${f.is_name_field ? " (Nome)" : ""}${f.is_phone_field ? " (Telefone)" : ""}`,
        group: "Essenciais",
      }));
    const formOpts = formFields
      .filter((f) => !essentialIds.has(f.id))
      .map((f) => ({ value: f.id, label: `📝 ${f.label}`, group: "Campos do Formulário" }));
    const colOpts = crmColumns.map((c) => ({ value: `col__${c.field_key}`, label: `📊 ${c.name}`, group: "Colunas CRM" }));
    const userOpts = profiles.map((p) => ({ value: `user__${p.user_id}`, label: `👤 ${p.full_name || p.email}`, group: "Usuários" }));
    const statusOpts = statuses.map((s) => ({ value: `status__${s.key}`, label: `🏷️ ${s.label}`, group: "Status" }));
    return [
      { value: "__status__", label: "⚙️ Status/Etapa", group: "Sistema" },
      { value: "__assigned__", label: "⚙️ Responsável", group: "Sistema" },
      { value: "__created_at__", label: "⚙️ Data de criação", group: "Sistema" },
      ...essentialOpts,
      ...formOpts,
      ...colOpts,
      ...statusOpts,
      ...userOpts,
    ];
  }, [formFields, crmColumns, profiles, statuses, nameField, phoneField]);

  // Validation: detect missing essential mappings (Name, Phone, Status, Assigned)
  const validation = useMemo(() => {
    const mappedTargets = new Set(Object.values(columnMap));
    const hasName = nameField ? mappedTargets.has(nameField.id) : false;
    const hasPhone = phoneField ? mappedTargets.has(phoneField.id) : false;
    const hasStatus = mappedTargets.has("__status__");
    const hasAssigned = mappedTargets.has("__assigned__");

    const issues: string[] = [];
    if (!hasName) issues.push("Nome do Lead");
    if (!hasPhone) issues.push("Telefone");
    if (!hasStatus) issues.push("Status/Etapa");
    if (!hasAssigned) issues.push("Responsável");

    return { hasName, hasPhone, hasStatus, hasAssigned, issues, valid: issues.length === 0 };
  }, [columnMap, nameField, phoneField]);

  // Import logic
  const startImport = async () => {
    setStep("importing");
    setImportProgress(0);
    setImportErrors([]);
    const total = csvRows.length;
    setImportTotal(total);
    const BATCH_SIZE = 50;
    const errors: string[] = [];
    let imported = 0;

    // Build reverse maps
    const formFieldIds = new Set(formFields.map((field) => field.id));
    const colToFieldId: Record<string, string> = {};
    const specialCols: Record<string, string> = {}; // csvHeader -> special key
    Object.entries(columnMap).forEach(([csvCol, target]) => {
      if (target === "__status__" || target === "__assigned__" || target === "__created_at__") {
        specialCols[csvCol] = target;
      } else if (target !== IGNORE_VALUE && !target.startsWith("user__") && !target.startsWith("status__")) {
        colToFieldId[csvCol] = target;
      }
    });

    // Find status column and assigned column
    const statusCol = Object.entries(specialCols).find(([, v]) => v === "__status__")?.[0] || mappedStatusHeader || "Etapa";
    const assignedCol = Object.entries(specialCols).find(([, v]) => v === "__assigned__")?.[0] || mappedAssignedHeader || "Responsável";
    const createdAtCol = Object.entries(specialCols).find(([, v]) => v === "__created_at__")?.[0] || mappedCreatedAtHeader || "Criado";

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = csvRows.slice(i, i + BATCH_SIZE);
      const inserts = batch.map((row) => {
        const data: Record<string, string> = {};

        // Map CSV columns to form field IDs or CRM column keys
        // When multiple CSV columns map to the same field, merge values (comma-separated)
        Object.entries(colToFieldId).forEach(([csvCol, target]) => {
          const value = row[csvCol];
          if (!value) return;

          if (target.startsWith("col__")) {
            const colKey = target.replace("col__", "");
            if (data[colKey]) {
              data[colKey] = data[colKey] + ", " + value;
            } else {
              data[colKey] = value;
            }
            return;
          }

          const normalizedKey = formFieldIds.has(target)
            ? `field_${target}`
            : target.startsWith("field_")
              ? target
              : `field_${target}`;

          // Merge multiple CSV columns into the same field
          if (data[normalizedKey]) {
            data[normalizedKey] = data[normalizedKey] + ", " + value;
          } else {
            data[normalizedKey] = value;
          }
        });

        const csvStatus = row[statusCol] || "";
        const status = statusMap[csvStatus] || "novo";
        const csvUser = row[assignedCol] || "";
        const assignedTo = userMap[csvUser] || null;

        // Parse created_at
        let createdAt: string = new Date().toISOString();
        const rawDate = row[createdAtCol];
        if (rawDate) {
          const match = rawDate.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
          if (match) {
            createdAt = `${match[3]}-${match[2]}-${match[1]}T${match[4]}`;
          }
        }

        return {
          data,
          status,
          assigned_to: assignedTo,
          created_by: user?.id || null,
          created_at: createdAt,
        };
      });

      const { error } = await supabase.from("crm_leads").insert(inserts);
      if (error) {
        errors.push(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      }
      imported += batch.length;
      setImportProgress(Math.round((imported / total) * 100));
    }

    setImportErrors(errors);
    if (errors.length === 0) {
      toast.success(`${total} leads importados com sucesso!`);
    } else {
      toast.error(`Importação concluída com ${errors.length} erro(s)`);
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-muted-foreground">Acesso restrito a administradores.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Importar Leads</h1>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-sm">
          {(["upload", "columns", "status", "users", "preview"] as Step[]).map((s, i) => {
            const labels = ["Upload", "Colunas", "Status", "Usuários", "Preview"];
            const isActive = s === step;
            const isDone =
              (["upload", "columns", "status", "users", "preview"] as Step[]).indexOf(step) > i ||
              step === "importing";
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                <Badge variant={isActive ? "default" : isDone ? "secondary" : "outline"}>
                  {isDone && !isActive ? <Check className="mr-1 h-3 w-3" /> : null}
                  {labels[i]}
                </Badge>
              </div>
            );
          })}
        </div>

        {/* STEP: Upload */}
        {step === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle>Upload do arquivo CSV</CardTitle>
              <CardDescription>Selecione o arquivo de backup do Bitrix (formato CSV com separador ;)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 transition-colors hover:border-primary/50">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Clique para selecionar o arquivo .csv</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              </label>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir todos os leads do sistema
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação irá excluir permanentemente TODOS os leads da tela de Leads, junto com suas notas, atividades, agendamentos e mensagens de WhatsApp vinculadas. Os dados de Renovações e Cobranças NÃO serão afetados. Essa ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        const toastId = toast.loading("Excluindo leads...");
                        try {
                          const { data, error } = await supabase.rpc("delete_all_leads_cascade");
                          if (error) throw error;
                          const count = typeof data === "object" && data && "deleted_leads" in data
                            ? Number((data as { deleted_leads?: number }).deleted_leads ?? 0)
                            : 0;
                          toast.success(`${count} leads excluídos! Renovações e cobranças preservadas.`, { id: toastId });
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : "Erro ao excluir";
                          toast.error(`Erro ao excluir: ${message}`, { id: toastId });
                        }
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Sim, excluir leads
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}

        {/* Duplicate check: leads vs renovacoes */}
        {step === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle>Verificar leads duplicados em Renovações</CardTitle>
              <CardDescription>
                Compara o telefone dos leads com os clientes da tela de Renovações. Se o mesmo telefone
                existir nos dois lugares, você pode excluir o card da tela de Leads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={scanDuplicates} disabled={scanning} variant="secondary">
                {scanning ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Verificando...</>
                ) : (
                  <><Search className="mr-2 h-4 w-4" /> Verificar agora</>
                )}
              </Button>

              {duplicates && duplicates.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum lead encontrado com telefone também em Renovações.
                </p>
              )}

              {duplicates && duplicates.length > 0 && (
                <div className="flex justify-end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={deletingAll}>
                        <Trash2 className="mr-1 h-3 w-3" />
                        {deletingAll ? "Excluindo..." : `Excluir todos os ${duplicates.length} duplicados`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir todos os duplicados?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {duplicates.length} card(s) serão removidos da tela de Leads. As renovações correspondentes NÃO serão afetadas.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={deleteAllDuplicates}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Sim, excluir todos
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              {duplicates && duplicates.length > 0 && (
                <div className="max-h-[400px] overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Renovação</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {duplicates.map((d) => (
                        <TableRow key={d.leadId}>
                          <TableCell className="text-xs">{d.leadName}</TableCell>
                          <TableCell className="text-xs">{d.leadPhone}</TableCell>
                          <TableCell className="text-xs">{d.renovacaoName}</TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="destructive" disabled={deletingId === d.leadId}>
                                  <Trash2 className="mr-1 h-3 w-3" />
                                  Excluir lead
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    O card "{d.leadName}" será removido da tela de Leads. A renovação correspondente NÃO será afetada.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteLeadById(d.leadId)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Sim, excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* STEP: Column mapping */}
        {step === "columns" && (
          <Card>
            <CardHeader>
              <CardTitle>Mapeamento de Colunas</CardTitle>
              <CardDescription>
                Vincule cada coluna do CSV a um campo do CRM. Colunas sem vínculo serão ignoradas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Validation banner */}
              <div className={`rounded-lg border p-3 text-sm ${validation.valid ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-400"}`}>
                <div className="flex items-start gap-2">
                  {validation.valid ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="space-y-1">
                    {validation.valid ? (
                      <p className="font-medium">Todos os campos essenciais estão mapeados.</p>
                    ) : (
                      <>
                        <p className="font-medium">Mapeie os campos essenciais antes de continuar:</p>
                        <ul className="list-disc pl-5">
                          {validation.issues.map((i) => (<li key={i}>{i}</li>))}
                        </ul>
                        <p className="text-xs opacity-80">Sem esses mapeamentos os leads aparecerão sem nome, telefone ou responsável na tela de Leads.</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Campos do CRM carregados:</span>
                  <Badge variant="secondary">{formFields.length} campos</Badge>
                  <Badge variant="outline">{crmColumns.length} colunas CRM</Badge>
                  <Badge variant="outline">{statuses.length} status</Badge>
                  <Badge variant="outline">{profiles.length} usuários</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formFields.map((field) => (
                    <Badge key={field.id} variant="outline" className="max-w-full text-xs">
                      <span className="truncate">
                        {field.label}
                        {field.is_name_field ? " • Nome" : ""}
                        {field.is_phone_field ? " • Telefone" : ""}
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>

              {(nameField || phoneField) && (
                <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
                  {nameField && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Campo essencial: Nome</p>
                      <Select
                        value={Object.entries(columnMap).find(([, value]) => value === nameField.id)?.[0] || IGNORE_VALUE}
                        onValueChange={(selectedHeader) => {
                          const currentHeader = Object.entries(columnMap).find(([, value]) => value === nameField.id)?.[0];
                          if (currentHeader && currentHeader !== selectedHeader) setColumnTarget(currentHeader, IGNORE_VALUE);
                          if (selectedHeader !== IGNORE_VALUE) setColumnTarget(selectedHeader, nameField.id);
                        }}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Selecione a coluna do nome" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE_VALUE}>Selecione a coluna do nome</SelectItem>
                          {csvHeaders.map((header) => (
                            <SelectItem key={`name-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {phoneField && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Campo essencial: Telefone</p>
                      <Select
                        value={Object.entries(columnMap).find(([, value]) => value === phoneField.id)?.[0] || IGNORE_VALUE}
                        onValueChange={(selectedHeader) => {
                          const currentHeader = Object.entries(columnMap).find(([, value]) => value === phoneField.id)?.[0];
                          if (currentHeader && currentHeader !== selectedHeader) setColumnTarget(currentHeader, IGNORE_VALUE);
                          if (selectedHeader !== IGNORE_VALUE) setColumnTarget(selectedHeader, phoneField.id);
                        }}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Selecione a coluna do telefone" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE_VALUE}>Selecione a coluna do telefone</SelectItem>
                          {csvHeaders.map((header) => (
                            <SelectItem key={`phone-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <div className="max-h-[55vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coluna CSV</TableHead>
                      <TableHead>Exemplo</TableHead>
                      <TableHead>Campo CRM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvHeaders.map((header) => {
                      const sample = csvRows.find((r) => r[header])?.[header] || "";
                      const current = columnMap[header];
                      const isMapped = !!current && current !== IGNORE_VALUE;
                      return (
                        <TableRow key={header} className={!isMapped ? "opacity-70" : ""}>
                          <TableCell className="font-medium text-xs">{header}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {sample.slice(0, 60)}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={columnMap[header] || IGNORE_VALUE}
                              onValueChange={(v) => setColumnTarget(header, v)}
                            >
                              <SelectTrigger className={`w-[240px] text-xs ${isMapped ? "" : "border-yellow-500/50"}`}>
                                <SelectValue placeholder="— Ignorar —" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={IGNORE_VALUE}>— Ignorar —</SelectItem>
                                {fieldOptions.map((o) => (
                            <SelectItem key={`${header}-${o.value}`} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
            <div className="flex justify-between p-4 pt-0">
              <Button variant="outline" onClick={() => setStep("upload")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button
                onClick={() => setStep("status")}
                disabled={!validation.valid}
                title={!validation.valid ? `Faltando: ${validation.issues.join(", ")}` : undefined}
              >
                Próximo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* STEP: Status mapping */}
        {step === "status" && (
          <Card>
            <CardHeader>
              <CardTitle>Mapeamento de Status</CardTitle>
              <CardDescription>Vincule cada etapa do Bitrix a um status do CRM</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {csvStatuses.map((csvStatus) => (
                <div key={csvStatus} className="flex items-center gap-4">
                  <span className="min-w-[200px] text-sm font-medium">{csvStatus}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select
                    value={statusMap[csvStatus] || ""}
                    onValueChange={(v) => setStatusMap((prev) => ({ ...prev, [csvStatus]: v }))}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {csvStatuses.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma etapa encontrada no CSV.</p>
              )}
            </CardContent>
            <div className="flex justify-between p-4 pt-0">
              <Button variant="outline" onClick={() => setStep("columns")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => setStep("users")}>
                Próximo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* STEP: User mapping */}
        {step === "users" && (
          <Card>
            <CardHeader>
              <CardTitle>Mapeamento de Usuários</CardTitle>
              <CardDescription>Vincule cada responsável do Bitrix a um usuário do CRM</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {csvUsers.map((csvUser) => (
                <div key={csvUser} className="flex items-center gap-4">
                  <span className="min-w-[200px] text-sm font-medium">{csvUser}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select
                    value={userMap[csvUser] || ""}
                    onValueChange={(v) => setUserMap((prev) => ({ ...prev, [csvUser]: v }))}
                  >
                    <SelectTrigger className="w-[250px]">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.full_name || p.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {csvUsers.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum responsável encontrado no CSV.</p>
              )}
            </CardContent>
            <div className="flex justify-between p-4 pt-0">
              <Button variant="outline" onClick={() => setStep("status")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => setStep("preview")}>
                Próximo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* STEP: Preview */}
        {step === "preview" && (
          <Card>
            <CardHeader>
              <CardTitle>Resumo da Importação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div className="rounded-lg bg-muted p-3 text-center">
                  <div className="text-2xl font-bold">{csvRows.length}</div>
                  <div className="text-muted-foreground">Total de leads</div>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <div className="text-2xl font-bold">{Object.keys(columnMap).length}</div>
                  <div className="text-muted-foreground">Colunas mapeadas</div>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <div className="text-2xl font-bold">{Object.keys(statusMap).length}/{csvStatuses.length}</div>
                  <div className="text-muted-foreground">Status mapeados</div>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <div className="text-2xl font-bold">{Object.keys(userMap).length}/{csvUsers.length}</div>
                  <div className="text-muted-foreground">Usuários mapeados</div>
                </div>
              </div>

              {(csvStatuses.some((s) => !statusMap[s]) || csvUsers.some((u) => !userMap[u])) && (
                <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {csvStatuses.some((s) => !statusMap[s]) && (
                      <p>Alguns status não mapeados usarão o status padrão "novo".</p>
                    )}
                    {csvUsers.some((u) => !userMap[u]) && (
                      <p>Leads de usuários não mapeados ficarão sem responsável.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Sample preview */}
              <div className="max-h-[300px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Responsável</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvRows.slice(0, 10).map((row, i) => {
                      const nameField = formFields.find((f) => f.is_name_field);
                      const nameCol = nameField
                        ? Object.entries(columnMap).find(([, v]) => v === nameField.id)?.[0]
                        : null;
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{i + 1}</TableCell>
                          <TableCell className="text-xs">{nameCol ? row[nameCol] : row["Nome do Lead"] || "—"}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline">{(mappedStatusHeader && statusMap[row[mappedStatusHeader]]) || "novo"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {(mappedAssignedHeader && userMap[row[mappedAssignedHeader]])
                              ? profiles.find((p) => p.user_id === userMap[row[mappedAssignedHeader]])?.full_name
                              : (mappedAssignedHeader ? row[mappedAssignedHeader] : "") || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
            <div className="flex justify-between p-4 pt-0">
              <Button variant="outline" onClick={() => setStep("users")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={startImport}>
                <Upload className="mr-2 h-4 w-4" /> Importar {csvRows.length} leads
              </Button>
            </div>
          </Card>
        )}

        {/* STEP: Importing */}
        {step === "importing" && (
          <Card>
            <CardHeader>
              <CardTitle>Importando...</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={importProgress} />
              <p className="text-center text-sm text-muted-foreground">
                {importProgress < 100
                  ? `Processando... ${Math.round((importProgress / 100) * importTotal)} de ${importTotal}`
                  : "Importação concluída!"}
              </p>
              {importErrors.length > 0 && (
                <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  {importErrors.map((err, i) => (
                    <p key={i} className="text-destructive">{err}</p>
                  ))}
                </div>
              )}
              {importProgress >= 100 && (
                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={() => { setStep("upload"); setCsvRows([]); setCsvHeaders([]); }}>
                    Nova importação
                  </Button>
                  <Button onClick={() => navigate("/")}>Ver leads</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
