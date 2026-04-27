import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, GripVertical, ChevronRight, CornerDownRight, CalendarHeart } from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

type FormField = {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
  position: number;
  is_required: boolean;
  parent_field_id: string | null;
  parent_trigger_value: string | null;
  is_name_field: boolean;
  is_phone_field: boolean;
  is_last_visit_field: boolean;
  show_on_card: boolean;
};

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "phone", label: "Telefone" },
  { value: "date", label: "Data" },
  { value: "email", label: "Email" },
  { value: "select", label: "Seleção" },
  { value: "checkbox_group", label: "Múltipla escolha" },
  { value: "textarea", label: "Texto longo" },
];

export default function RenovacaoFormBuilderPage() {
  const { isAdmin } = useAuth();
  const [fields, setFields] = useState<FormField[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormField | null>(null);

  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [options, setOptions] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [isNameField, setIsNameField] = useState(false);
  const [isPhoneField, setIsPhoneField] = useState(false);
  const [isLastVisitField, setIsLastVisitField] = useState(false);
  const [showOnCard, setShowOnCard] = useState(false);
  const [parentFieldId, setParentFieldId] = useState<string>("__none__");
  const [parentTriggerValues, setParentTriggerValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchFields = async () => {
    const { data } = await supabase
      .from("crm_renovacao_form_fields")
      .select("*")
      .order("position");
    setFields((data || []) as unknown as FormField[]);
  };

  useEffect(() => { fetchFields(); }, []);

  const resetForm = () => {
    setLabel("");
    setFieldType("text");
    setOptions("");
    setIsRequired(false);
    setIsNameField(false);
    setIsPhoneField(false);
    setIsLastVisitField(false);
    setShowOnCard(false);
    setParentFieldId("__none__");
    setParentTriggerValues([]);
    setEditingField(null);
  };

  const openCreate = (parentId?: string) => {
    resetForm();
    if (parentId) setTimeout(() => setParentFieldId(parentId), 0);
    setDialogOpen(true);
  };

  const parseTriggerValues = (val: string | null): string[] => {
    if (!val) return [];
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return val ? [val] : [];
  };

  const openEdit = (field: FormField) => {
    setEditingField(field);
    setLabel(field.label);
    setFieldType(field.field_type);
    setOptions(field.options ? field.options.join(", ") : "");
    setIsRequired(field.is_required);
    setIsNameField(field.is_name_field);
    setIsPhoneField(field.is_phone_field);
    setIsLastVisitField(field.is_last_visit_field);
    setShowOnCard(field.show_on_card);
    setParentFieldId(field.parent_field_id || "__none__");
    setParentTriggerValues(parseTriggerValues(field.parent_trigger_value));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!label.trim()) return;
    setSaving(true);
    const autoIsPhoneField = fieldType === "phone" ? true : isPhoneField;
    const autoFieldType = isLastVisitField ? "date" : fieldType;

    const parsedOptions = ["select", "checkbox_group"].includes(autoFieldType)
      ? options.split(",").map((o) => o.trim()).filter(Boolean)
      : null;

    const payload = {
      label: label.trim(),
      field_type: autoFieldType,
      options: parsedOptions,
      is_required: isRequired,
      is_name_field: isNameField,
      is_phone_field: autoIsPhoneField,
      is_last_visit_field: isLastVisitField,
      show_on_card: showOnCard || isLastVisitField,
      parent_field_id: parentFieldId === "__none__" ? null : parentFieldId,
      parent_trigger_value: parentFieldId === "__none__" ? null : (parentTriggerValues.length > 0 ? JSON.stringify(parentTriggerValues) : null),
    };

    if (editingField) {
      const { error } = await supabase.from("crm_renovacao_form_fields").update(payload).eq("id", editingField.id);
      if (error) toast.error("Erro ao atualizar"); else toast.success("Pergunta atualizada");
    } else {
      const maxPos = fields.length > 0 ? Math.max(...fields.map((f) => f.position)) + 1 : 0;
      const { error } = await supabase.from("crm_renovacao_form_fields").insert({ ...payload, position: maxPos });
      if (error) toast.error("Erro ao criar"); else toast.success("Pergunta criada");
    }

    setSaving(false);
    setDialogOpen(false);
    resetForm();
    fetchFields();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("crm_renovacao_form_fields").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Pergunta excluída"); fetchFields(); }
  };

  /**
   * Drag-and-drop handler. Suporta reordenação de perguntas raiz e de subperguntas
   * condicionais agrupadas por trigger value.
   * droppableId: "root" | "child::<parentId>::<trigger>" | "child::<parentId>::__notrigger__"
   */
  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    if (result.source.droppableId !== result.destination.droppableId) return;

    const dropId = result.source.droppableId;
    let group: FormField[] = [];

    if (dropId === "root") {
      group = fields.filter((f) => !f.parent_field_id).sort((a, b) => a.position - b.position);
    } else if (dropId.startsWith("child::")) {
      const [, parentId, trigger] = dropId.split("::");
      group = fields
        .filter((f) => f.parent_field_id === parentId)
        .filter((f) => {
          const vals = parseTriggerValues(f.parent_trigger_value);
          if (trigger === "__notrigger__") return vals.length === 0;
          return vals.includes(trigger);
        })
        .sort((a, b) => a.position - b.position);
    } else {
      return;
    }

    const reordered = [...group];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    const updates = reordered.map((f, i) => ({ id: f.id, position: i }));
    setFields((prev) => {
      const copy = [...prev];
      updates.forEach((u) => {
        const idx = copy.findIndex((f) => f.id === u.id);
        if (idx !== -1) copy[idx] = { ...copy[idx], position: u.position };
      });
      return copy.sort((a, b) => a.position - b.position);
    });

    for (const u of updates) {
      await supabase.from("crm_renovacao_form_fields").update({ position: u.position }).eq("id", u.id);
    }
  };

  const rootFields = fields.filter((f) => !f.parent_field_id).sort((a, b) => a.position - b.position);
  const getChildren = (parentId: string) => fields.filter((f) => f.parent_field_id === parentId).sort((a, b) => a.position - b.position);
  const parentCandidates = fields.filter((f) => ["select", "checkbox_group"].includes(f.field_type) && f.options && f.options.length > 0);
  const getParentOptions = (parentId: string): string[] => fields.find((f) => f.id === parentId)?.options || [];
  const typeLabel = (t: string) => FIELD_TYPES.find((ft) => ft.value === t)?.label || t;

  /** Renderiza o card visual de uma pergunta. */
  const renderFieldCard = (field: FormField, depth: number, dragHandleProps?: any) => {
    const hasOptions = ["select", "checkbox_group"].includes(field.field_type) && field.options && field.options.length > 0;
    return (
      <div className={`flex items-center gap-2 p-3 rounded-lg border bg-card mb-2 group ${depth > 0 ? "ml-6 sm:ml-10 border-l-2 border-l-primary/30" : ""}`}>
        <span {...(dragHandleProps || {})} className="shrink-0 cursor-grab active:cursor-grabbing">
          {depth === 0 ? (
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          ) : (
            <CornerDownRight className="h-4 w-4 text-primary/50" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {field.label}
            {field.is_required && <span className="text-destructive ml-1">*</span>}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{typeLabel(field.field_type)}</span>
            {field.is_name_field && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">📛 Nome</span>}
            {field.is_phone_field && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">📞 Telefone</span>}
            {field.is_last_visit_field && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">📅 Última receita</span>}
            {field.show_on_card && !field.is_last_visit_field && !field.is_name_field && !field.is_phone_field && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">No card</span>
            )}
            {field.parent_trigger_value && (() => {
              const vals = parseTriggerValues(field.parent_trigger_value);
              return <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Quando: {vals.map(v => `"${v}"`).join(", ")}</span>;
            })()}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-1 shrink-0">
            {hasOptions && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Sub-pergunta" onClick={() => openCreate(field.id)}>
                <Plus className="h-3.5 w-3.5 text-primary" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(field)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(field.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
          </div>
        )}
      </div>
    );
  };

  /**
   * Renderiza recursivamente uma pergunta e seus filhos. Cada grupo de filhos
   * (por trigger value) vira um Droppable separado, permitindo reordená-los.
   */
  const renderField = (field: FormField, depth: number = 0, dragHandleProps?: any) => {
    const children = getChildren(field.id);
    const hasOptions = ["select", "checkbox_group"].includes(field.field_type) && field.options && field.options.length > 0;
    const noTriggerChildren = children.filter((c) => !c.parent_trigger_value);

    return (
      <div key={field.id}>
        {renderFieldCard(field, depth, dragHandleProps)}

        {hasOptions && field.options!.map((opt) => {
          const optChildren = children.filter((c) => parseTriggerValues(c.parent_trigger_value).includes(opt));
          if (optChildren.length === 0) return null;
          const dropId = `child::${field.id}::${opt}`;
          return (
            <div key={opt}>
              <div className="ml-6 sm:ml-10 mb-1 flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Se "{opt}":</span>
              </div>
              <Droppable droppableId={dropId}>
                {(prov) => (
                  <div ref={prov.innerRef} {...prov.droppableProps}>
                    {optChildren.map((child, idx) => (
                      <Draggable key={child.id} draggableId={child.id} index={idx}>
                        {(p) => (
                          <div ref={p.innerRef} {...p.draggableProps}>
                            {renderField(child, depth + 1, p.dragHandleProps)}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {prov.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}

        {noTriggerChildren.length > 0 && (
          <Droppable droppableId={`child::${field.id}::__notrigger__`}>
            {(prov) => (
              <div ref={prov.innerRef} {...prov.droppableProps}>
                {noTriggerChildren.map((child, idx) => (
                  <Draggable key={child.id} draggableId={child.id} index={idx}>
                    {(p) => (
                      <div ref={p.innerRef} {...p.draggableProps}>
                        {renderField(child, depth + 1, p.dragHandleProps)}
                      </div>
                    )}
                  </Draggable>
                ))}
                {prov.placeholder}
              </div>
            )}
          </Droppable>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="mb-3 sm:mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <CalendarHeart className="h-5 w-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Formulário de Renovação</h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">{fields.length} pergunta{fields.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => openCreate()}><Plus className="mr-1 h-4 w-4" /> Nova Pergunta</Button>
        )}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="root">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
              {rootFields.map((field, index) => (
                <Draggable key={field.id} draggableId={field.id} index={index}>
                  {(prov) => (
                    <div ref={prov.innerRef} {...prov.draggableProps}>
                      {renderField(field, 0, prov.dragHandleProps)}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {fields.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhuma pergunta criada ainda.</p>
          <p className="text-sm mt-1">Clique em "Nova Pergunta" para começar.</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingField ? "Editar Pergunta" : "Nova Pergunta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pergunta</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Tipo de lente atual" />
            </div>

            <div className="space-y-2">
              <Label>Tipo de campo</Label>
              <Select value={fieldType} onValueChange={setFieldType} disabled={isLastVisitField}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {isLastVisitField && <p className="text-xs text-muted-foreground">Tipo fixo em "Data" para o campo de última receita.</p>}
            </div>

            {["select", "checkbox_group"].includes(fieldType) && !isLastVisitField && (
              <div className="space-y-2">
                <Label>Opções (separadas por vírgula)</Label>
                <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Sim, Não, Talvez" />
              </div>
            )}

            <div className="flex items-center gap-2"><Switch checked={isRequired} onCheckedChange={setIsRequired} /><Label>Obrigatório</Label></div>
            <div className="flex items-center gap-2"><Switch checked={isNameField} onCheckedChange={(v) => { setIsNameField(v); if (v) { setIsPhoneField(false); setIsLastVisitField(false); } }} /><Label>Este campo é o nome do cliente</Label></div>
            <div className="flex items-center gap-2"><Switch checked={isPhoneField} onCheckedChange={(v) => { setIsPhoneField(v); if (v) { setIsNameField(false); setIsLastVisitField(false); } }} /><Label>Este campo é o telefone</Label></div>
            <div className="flex items-center gap-2">
              <Switch checked={isLastVisitField} onCheckedChange={(v) => { setIsLastVisitField(v); if (v) { setIsNameField(false); setIsPhoneField(false); setFieldType("date"); } }} />
              <Label>Este é o campo principal: <strong>Data da última receita</strong></Label>
            </div>
            <div className="flex items-center gap-2"><Switch checked={showOnCard} onCheckedChange={setShowOnCard} /><Label>Mostrar resposta no card</Label></div>

            <div className="space-y-2">
              <Label>Condicional (aparece dentro de outra pergunta)</Label>
              <Select value={parentFieldId} onValueChange={(v) => { setParentFieldId(v); setParentTriggerValues([]); }}>
                <SelectTrigger><SelectValue placeholder="Nenhuma (pergunta raiz)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhuma (pergunta raiz)</SelectItem>
                  {parentCandidates.filter((f) => f.id !== editingField?.id).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {parentFieldId !== "__none__" && (
              <div className="space-y-2">
                <Label>Aparece quando a resposta for</Label>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border rounded-md bg-muted/30">
                  {getParentOptions(parentFieldId).map((opt) => {
                    const checked = parentTriggerValues.includes(opt);
                    return (
                      <label key={opt} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${checked ? "bg-primary/10 border-primary text-primary" : "bg-background border-border text-foreground hover:bg-muted"}`}>
                        <Checkbox checked={checked} onCheckedChange={() => setParentTriggerValues(prev => prev.includes(opt) ? prev.filter(v => v !== opt) : [...prev, opt])} className="h-3.5 w-3.5" />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <Button onClick={handleSave} disabled={saving || !label.trim()} className="w-full">
              {saving ? "Salvando..." : editingField ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
