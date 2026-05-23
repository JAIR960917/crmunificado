/**
 * RolePermissionsManager — UI para gerenciar funções e permissões de página.
 * Renderizada dentro de SettingsPage (acesso apenas para admin).
 *
 * Agora gerencia também as colunas (status) visíveis por função em Leads e Renovação.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { APP_PAGES } from "@/lib/pagePermissions";
import { Plus, Trash2, Save, Shield } from "lucide-react";

type RoleDef = {
  key: string;
  label: string;
  is_system: boolean;
  base_role: "admin" | "gerente" | "vendedor" | "financeiro";
};
type Permission = { role_key: string; page_key: string; allowed: boolean };
type StatusPerm = { role_key: string; module: "leads" | "renovacao"; status_key: string; visible: boolean };
type StatusItem = { key: string; label: string; is_system_excluded?: boolean };

const BASE_ROLE_OPTIONS = [
  { value: "admin",      label: "Admin (acesso total)" },
  { value: "gerente",    label: "Gerente" },
  { value: "vendedor",   label: "Vendedor" },
  { value: "financeiro", label: "Financeiro" },
];

function slugify(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function RolePermissionsManager() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [statusPerms, setStatusPerms] = useState<StatusPerm[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<StatusItem[]>([]);
  const [renovStatuses, setRenovStatuses] = useState<StatusItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [openCreate, setOpenCreate] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newBaseRole, setNewBaseRole] = useState("vendedor");

  const [editingLabel, setEditingLabel] = useState<string>("");

  const fetchAll = async () => {
    setLoading(true);
    const [r, p, sp, ls, rs] = await Promise.all([
      supabase.from("role_definitions").select("*").order("is_system", { ascending: false }).order("label"),
      supabase.from("role_page_permissions").select("*"),
      supabase.from("role_status_permissions" as any).select("*"),
      supabase.from("crm_statuses").select("key, label, is_system_excluded").order("position"),
      supabase.from("crm_renovacao_statuses").select("key, label, is_system_excluded").order("position"),
    ]);
    const rs2 = (r.data || []) as RoleDef[];
    setRoles(rs2);
    setPerms((p.data || []) as Permission[]);
    setStatusPerms(((sp.data || []) as unknown) as StatusPerm[]);
    setLeadStatuses((ls.data || []) as StatusItem[]);
    setRenovStatuses((rs.data || []) as StatusItem[]);
    if (rs2.length && !selectedKey) setSelectedKey(rs2[0].key);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    const r = roles.find((x) => x.key === selectedKey);
    setEditingLabel(r?.label ?? "");
  }, [selectedKey, roles]);

  const selected = roles.find((r) => r.key === selectedKey) || null;
  const isAdminNative = selected?.key === "admin";

  const isAllowed = (pageKey: string) => {
    if (isAdminNative) return true;
    if (!selectedKey) return false;
    const found = perms.find((p) => p.role_key === selectedKey && p.page_key === pageKey);
    return !!found?.allowed;
  };

  const togglePage = (pageKey: string, value: boolean) => {
    if (!selectedKey || isAdminNative) return;
    setPerms((prev) => {
      const idx = prev.findIndex((p) => p.role_key === selectedKey && p.page_key === pageKey);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], allowed: value };
        return next;
      }
      return [...prev, { role_key: selectedKey, page_key: pageKey, allowed: value }];
    });
  };

  const isStatusVisible = (mod: "leads" | "renovacao", statusKey: string, isExcluded: boolean) => {
    if (isExcluded) return isAdminNative; // coluna "Excluídos" só para admin
    if (isAdminNative) return true;
    if (!selectedKey) return false;
    const found = statusPerms.find(
      (s) => s.role_key === selectedKey && s.module === mod && s.status_key === statusKey,
    );
    // padrão: visível se não houver registro
    return found ? found.visible : true;
  };

  const toggleStatus = (mod: "leads" | "renovacao", statusKey: string, value: boolean) => {
    if (!selectedKey || isAdminNative) return;
    setStatusPerms((prev) => {
      const idx = prev.findIndex(
        (s) => s.role_key === selectedKey && s.module === mod && s.status_key === statusKey,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], visible: value };
        return next;
      }
      return [...prev, { role_key: selectedKey, module: mod, status_key: statusKey, visible: value }];
    });
  };

  const handleSavePermissions = async () => {
    if (!selected || isAdminNative) return;
    setSaving(true);
    try {
      if (editingLabel.trim() && editingLabel.trim() !== selected.label) {
        await supabase.from("role_definitions").update({ label: editingLabel.trim() }).eq("key", selected.key);
      }
      const pageRows = APP_PAGES.map((pg) => ({
        role_key: selected.key,
        page_key: pg.key,
        allowed: isAllowed(pg.key),
      }));
      const { error: pErr } = await supabase
        .from("role_page_permissions")
        .upsert(pageRows, { onConflict: "role_key,page_key" });
      if (pErr) throw pErr;

      const statusRows: any[] = [];
      leadStatuses.forEach((s) => {
        if (s.is_system_excluded) return; // não editável
        statusRows.push({
          role_key: selected.key,
          module: "leads",
          status_key: s.key,
          visible: isStatusVisible("leads", s.key, false),
        });
      });
      renovStatuses.forEach((s) => {
        if (s.is_system_excluded) return;
        statusRows.push({
          role_key: selected.key,
          module: "renovacao",
          status_key: s.key,
          visible: isStatusVisible("renovacao", s.key, false),
        });
      });
      if (statusRows.length > 0) {
        const { error: sErr } = await supabase
          .from("role_status_permissions" as any)
          .upsert(statusRows, { onConflict: "role_key,module,status_key" });
        if (sErr) throw sErr;
      }

      toast.success("Permissões salvas");
      await fetchAll();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar permissões");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const label = newLabel.trim();
    if (!label) return toast.error("Informe o nome da função");
    let key = slugify(label);
    if (!key) return toast.error("Nome inválido");
    if (roles.some((r) => r.key === key)) key = `${key}_${Date.now().toString(36).slice(-4)}`;

    const { error } = await supabase.from("role_definitions").insert([{
      key, label, is_system: false, base_role: newBaseRole as any,
    }]);
    if (error) return toast.error(error.message);

    const rows = APP_PAGES.map((pg) => ({ role_key: key, page_key: pg.key, allowed: false }));
    await supabase.from("role_page_permissions").insert(rows);

    toast.success("Função criada");
    setOpenCreate(false);
    setNewLabel("");
    setNewBaseRole("vendedor");
    await fetchAll();
    setSelectedKey(key);
  };

  const handleDelete = async () => {
    if (!selected || selected.is_system) return;
    if (!confirm(`Excluir a função "${selected.label}"?`)) return;
    await supabase.from("user_roles").update({ role_key: selected.base_role }).eq("role_key", selected.key);
    const { error } = await supabase.from("role_definitions").delete().eq("key", selected.key);
    if (error) return toast.error(error.message);
    toast.success("Função excluída");
    setSelectedKey("admin");
    await fetchAll();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Carregando funções...</div>;
  }

  const renderStatusList = (mod: "leads" | "renovacao", list: StatusItem[]) => (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {list.map((s) => {
        const isExcl = !!s.is_system_excluded;
        return (
          <label
            key={s.key}
            className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
              isAdminNative || isExcl ? "opacity-60" : "cursor-pointer hover:bg-muted/50"
            }`}
          >
            <Checkbox
              checked={isStatusVisible(mod, s.key, isExcl)}
              onCheckedChange={(v) => toggleStatus(mod, s.key, !!v)}
              disabled={isAdminNative || isExcl}
            />
            <span className="flex-1">{s.label}</span>
            {isExcl && <code className="text-[10px] text-muted-foreground">só admin</code>}
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" /> Funções e Permissões
          </h2>
          <p className="text-xs text-muted-foreground">
            Defina quais páginas e colunas cada função pode visualizar.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpenCreate(true)}>
          <Plus className="mr-1 h-4 w-4" /> Nova função
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        <div className="space-y-1 border rounded-md p-2 max-h-[480px] overflow-y-auto">
          {roles.map((r) => (
            <button
              key={r.key}
              onClick={() => setSelectedKey(r.key)}
              className={`w-full text-left rounded px-2.5 py-2 text-sm transition-colors ${
                selectedKey === r.key ? "bg-primary/15 text-primary" : "hover:bg-muted"
              }`}
            >
              <div className="font-medium truncate">{r.label}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {r.is_system ? "nativa" : `custom · base: ${r.base_role}`}
              </div>
            </button>
          ))}
        </div>

        <div className="border rounded-md p-4 space-y-4">
          {!selected ? (
            <div className="text-sm text-muted-foreground">Selecione uma função</div>
          ) : (
            <>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-xs">Nome da função</Label>
                  <Input
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    disabled={selected.is_system}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Chave: <code>{selected.key}</code> · Base RLS: <code>{selected.base_role}</code>
                </div>
                {!selected.is_system && (
                  <Button variant="destructive" size="sm" onClick={handleDelete}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
                  </Button>
                )}
              </div>

              {isAdminNative && (
                <div className="text-xs rounded bg-muted px-3 py-2">
                  A função <strong>Admin nativo</strong> tem acesso total e não pode ter restrições.
                </div>
              )}

              <Tabs defaultValue="pages">
                <TabsList>
                  <TabsTrigger value="pages">Páginas</TabsTrigger>
                  <TabsTrigger value="leads">Colunas — Leads</TabsTrigger>
                  <TabsTrigger value="renov">Colunas — Renovação</TabsTrigger>
                </TabsList>
                <TabsContent value="pages">
                  <Label className="text-xs">Páginas permitidas</Label>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {APP_PAGES.map((pg) => (
                      <label
                        key={pg.key}
                        className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                          isAdminNative ? "opacity-60" : "cursor-pointer hover:bg-muted/50"
                        }`}
                      >
                        <Checkbox
                          checked={isAllowed(pg.key)}
                          onCheckedChange={(v) => togglePage(pg.key, !!v)}
                          disabled={isAdminNative}
                        />
                        <span className="flex-1">{pg.label}</span>
                        <code className="text-[10px] text-muted-foreground">{pg.path}</code>
                      </label>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="leads">
                  <Label className="text-xs">Colunas visíveis em Leads</Label>
                  {renderStatusList("leads", leadStatuses)}
                </TabsContent>
                <TabsContent value="renov">
                  <Label className="text-xs">Colunas visíveis em Renovação</Label>
                  {renderStatusList("renovacao", renovStatuses)}
                </TabsContent>
              </Tabs>

              <Button onClick={handleSavePermissions} disabled={saving || isAdminNative}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Salvar alterações"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova função</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex: Supervisor de Loja"
              />
            </div>
            <div>
              <Label>Função base (define permissões de dados)</Label>
              <Select value={newBaseRole} onValueChange={setNewBaseRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASE_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
