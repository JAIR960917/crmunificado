import { useEffect, useState } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, Pencil, Settings, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";

type CrmStatus = {
  id: string;
  key: string;
  label: string;
  position: number;
  color: string;
  financeiro_visible?: boolean;
};

type ChecklistItem = {
  id: string;
  status_id: string;
  label: string;
  position: number;
};

const COLORS = [
  { value: "blue", label: "Azul" },
  { value: "amber", label: "Amarelo" },
  { value: "violet", label: "Violeta" },
  { value: "cyan", label: "Ciano" },
  { value: "emerald", label: "Verde" },
  { value: "red", label: "Vermelho" },
];

const colorDot: Record<string, string> = {
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  cyan: "bg-cyan-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
};

type SectionType = "leads" | "cobrancas" | "renovacoes";

const sectionConfig: Record<SectionType, { statusTable: string; dataTable: string; title: string }> = {
  leads:      { statusTable: "crm_statuses",            dataTable: "crm_leads",      title: "Colunas de Leads" },
  cobrancas:  { statusTable: "crm_cobranca_statuses",   dataTable: "crm_cobrancas",  title: "Colunas de Cobranças" },
  renovacoes: { statusTable: "crm_renovacao_statuses",  dataTable: "crm_renovacoes", title: "Colunas de Renovação" },
};

export default function ColumnsPage() {
  const { isAdmin } = useAuth();
  const [leadStatuses, setLeadStatuses] = useState<CrmStatus[]>([]);
  const [cobrancaStatuses, setCobrancaStatuses] = useState<CrmStatus[]>([]);
  const [renovacaoStatuses, setRenovacaoStatuses] = useState<CrmStatus[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<CrmStatus | null>(null);
  const [dialogSection, setDialogSection] = useState<SectionType>("leads");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("blue");
  const [saving, setSaving] = useState(false);

  // Financeiro config dialog state
  const [finDialogOpen, setFinDialogOpen] = useState(false);
  const [finStatus, setFinStatus] = useState<CrmStatus | null>(null);
  const [finVisible, setFinVisible] = useState(true);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newChecklistLabel, setNewChecklistLabel] = useState("");
  const [savingFin, setSavingFin] = useState(false);

  const fetchStatuses = async () => {
    const [{ data: leads }, { data: cobrancas }, { data: renovacoes }] = await Promise.all([
      supabase.from("crm_statuses").select("*").order("position"),
      supabase.from("crm_cobranca_statuses").select("*").order("position"),
      supabase.from("crm_renovacao_statuses").select("*").order("position"),
    ]);
    setLeadStatuses((leads || []) as CrmStatus[]);
    setCobrancaStatuses((cobrancas || []) as CrmStatus[]);
    setRenovacaoStatuses((renovacoes || []) as CrmStatus[]);
  };

  useEffect(() => { fetchStatuses(); }, []);

  const resetForm = () => { setLabel(""); setColor("blue"); setEditingStatus(null); };

  const openCreate = (section: SectionType) => { resetForm(); setDialogSection(section); setDialogOpen(true); };

  const openEdit = (status: CrmStatus, section: SectionType) => {
    setEditingStatus(status); setLabel(status.label); setColor(status.color);
    setDialogSection(section); setDialogOpen(true);
  };

  const getStatuses = (section: SectionType) =>
    section === "leads" ? leadStatuses : section === "cobrancas" ? cobrancaStatuses : renovacaoStatuses;

  const handleSave = async () => {
    if (!label.trim()) return;
    setSaving(true);
    const table = sectionConfig[dialogSection].statusTable;

    if (editingStatus) {
      const { error } = await supabase.from(table as any).update({ label: label.trim(), color } as any).eq("id", editingStatus.id);
      if (error) toast.error("Erro ao atualizar"); else toast.success("Coluna atualizada");
    } else {
      const statuses = getStatuses(dialogSection);
      const key = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const maxPos = statuses.length > 0 ? Math.max(...statuses.map(s => s.position)) + 1 : 0;
      const { error } = await supabase.from(table as any).insert({ key, label: label.trim(), color, position: maxPos } as any);
      if (error) toast.error("Erro ao criar coluna"); else toast.success("Coluna criada");
    }
    setSaving(false); setDialogOpen(false); resetForm(); fetchStatuses();
  };

  const handleDelete = async (status: CrmStatus, section: SectionType) => {
    const dataTable = sectionConfig[section].dataTable;
    const { count } = await (supabase.from(dataTable as any) as any).select("id", { count: "exact", head: true }).eq("status", status.key);
    if (count && count > 0) { toast.error("Remova os registros desta coluna antes de excluí-la"); return; }
    const table = sectionConfig[section].statusTable;
    const { error } = await supabase.from(table as any).delete().eq("id", status.id);
    if (error) toast.error("Erro ao excluir"); else { toast.success("Coluna excluída"); fetchStatuses(); }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const section = result.source.droppableId as SectionType;
    const table = sectionConfig[section].statusTable;
    const statuses = [...getStatuses(section)];
    const [moved] = statuses.splice(result.source.index, 1);
    statuses.splice(result.destination.index, 0, moved);

    if (section === "leads") setLeadStatuses(statuses);
    else if (section === "cobrancas") setCobrancaStatuses(statuses);
    else setRenovacaoStatuses(statuses);

    await Promise.all(statuses.map((s, i) => supabase.from(table as any).update({ position: i } as any).eq("id", s.id)));
  };

  const openFinanceiroConfig = async (status: CrmStatus) => {
    setFinStatus(status);
    setFinVisible(status.financeiro_visible !== false);
    const { data } = await supabase
      .from("crm_cobranca_status_checklist" as any)
      .select("*")
      .eq("status_id", status.id)
      .order("position");
    setChecklistItems(((data || []) as unknown) as ChecklistItem[]);
    setNewChecklistLabel("");
    setFinDialogOpen(true);
  };

  const toggleFinVisible = async (value: boolean) => {
    if (!finStatus) return;
    setFinVisible(value);
    await supabase
      .from("crm_cobranca_statuses")
      .update({ financeiro_visible: value } as any)
      .eq("id", finStatus.id);
    setCobrancaStatuses(prev => prev.map(s => s.id === finStatus.id ? { ...s, financeiro_visible: value } : s));
  };

  const addChecklistItem = async () => {
    if (!finStatus || !newChecklistLabel.trim()) return;
    setSavingFin(true);
    const maxPos = checklistItems.length > 0 ? Math.max(...checklistItems.map(i => i.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("crm_cobranca_status_checklist" as any)
      .insert({ status_id: finStatus.id, label: newChecklistLabel.trim(), position: maxPos } as any)
      .select()
      .single();
    if (error) toast.error("Erro ao adicionar item");
    else {
      setChecklistItems(prev => [...prev, (data as unknown) as ChecklistItem]);
      setNewChecklistLabel("");
    }
    setSavingFin(false);
  };

  const removeChecklistItem = async (id: string) => {
    const { error } = await supabase.from("crm_cobranca_status_checklist" as any).delete().eq("id", id);
    if (error) toast.error("Erro ao remover");
    else setChecklistItems(prev => prev.filter(i => i.id !== id));
  };

  if (!isAdmin) {
    return <AppLayout><p className="text-muted-foreground">Acesso restrito a administradores.</p></AppLayout>;
  }

  const renderStatusList = (statuses: CrmStatus[], section: SectionType) => (
    <Droppable droppableId={section}>
      {(provided) => (
        <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
          {statuses.length === 0 && (
            <div className="text-center text-muted-foreground py-8 border rounded-xl bg-card">Nenhuma coluna criada ainda</div>
          )}
          {statuses.map((status, index) => (
            <Draggable key={status.id} draggableId={status.id} index={index}>
              {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.draggableProps}
                  className={`rounded-xl border bg-card p-3 sm:p-4 transition-shadow ${snapshot.isDragging ? "shadow-lg ring-2 ring-primary/20" : ""}`}>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0">
                      <GripVertical className="h-5 w-5" />
                    </div>
                    <div className={`h-3 w-3 rounded-full shrink-0 ${colorDot[status.color] || colorDot.blue}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{status.label}</span>
                        <span className="text-xs text-muted-foreground">({status.key})</span>
                        {section === "cobrancas" && status.financeiro_visible === false && (
                          <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            <EyeOff className="h-3 w-3" />Oculta para financeiro
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {section === "cobrancas" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Configurar acesso do financeiro" onClick={() => openFinanceiroConfig(status)}>
                          <Settings className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(status, section)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(status, section)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );

  const sectionLabel = dialogSection === "leads" ? "Leads" : dialogSection === "cobrancas" ? "Cobranças" : "Renovação";

  return (
    <AppLayout>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Colunas do CRM</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Gerencie as colunas do kanban. Arraste para reordenar.</p>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        {/* Leads */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Colunas de Leads</h2>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => openCreate("leads")}><Plus className="mr-2 h-4 w-4" />Nova Coluna</Button>
        </div>
        {renderStatusList(leadStatuses, "leads")}

        <Separator className="my-8" />

        {/* Cobranças */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Colunas de Cobranças</h2>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => openCreate("cobrancas")}><Plus className="mr-2 h-4 w-4" />Nova Coluna</Button>
        </div>
        {renderStatusList(cobrancaStatuses, "cobrancas")}

        <Separator className="my-8" />

        {/* Renovação */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Colunas de Renovação</h2>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => openCreate("renovacoes")}><Plus className="mr-2 h-4 w-4" />Nova Coluna</Button>
        </div>
        {renderStatusList(renovacaoStatuses, "renovacoes")}
      </DragDropContext>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingStatus ? "Editar Coluna" : "Nova Coluna"}{" "}
              <span className="text-muted-foreground text-sm font-normal">({sectionLabel})</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da coluna</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Em negociação" />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <Select value={color} onValueChange={setColor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLORS.map(c => (
                    <SelectItem key={c.value} value={c.value}>
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${colorDot[c.value]}`} />
                        {c.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving || !label.trim()}>
              {saving ? "Salvando..." : editingStatus ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={finDialogOpen} onOpenChange={setFinDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar acesso do financeiro</DialogTitle>
          </DialogHeader>
          {finStatus && (
            <div className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Coluna</p>
                <p className="font-medium text-sm">{finStatus.label}</p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="flex-1">
                  <Label className="text-sm">Visível para o usuário financeiro</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Quando desativado, esta coluna não aparece para usuários do financeiro.
                  </p>
                </div>
                <Switch checked={finVisible} onCheckedChange={toggleFinVisible} />
              </div>

              <div className="space-y-2">
                <Label className="text-sm flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Critérios para liberar o lead
                </Label>
                <p className="text-xs text-muted-foreground">
                  O financeiro precisa marcar todos os itens abaixo antes de mover um lead desta coluna para outra.
                  Se nenhum item for cadastrado, o lead pode ser movido livremente pelo financeiro.
                </p>

                <div className="space-y-1.5 mt-2">
                  {checklistItems.length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">Nenhum critério cadastrado.</p>
                  )}
                  {checklistItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                      <span className="flex-1 text-sm">{item.label}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeChecklistItem(item.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Ex: Cliente foi contactado"
                    value={newChecklistLabel}
                    onChange={e => setNewChecklistLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                  />
                  <Button onClick={addChecklistItem} disabled={savingFin || !newChecklistLabel.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
