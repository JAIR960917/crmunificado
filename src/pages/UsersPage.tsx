import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, User, Pencil, Trash2, KeyRound, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Company = { id: string; name: string };
type Profile = { id: string; user_id: string; full_name: string; email: string; company_id: string | null };
type UserRole = { user_id: string; role: string; role_key: string | null };
type ManagerCompany = { user_id: string; company_id: string };
type RoleDef = { key: string; label: string; is_system: boolean; base_role: string };

export default function UsersPage() {
  const { isAdmin, isGerente, user } = useAuth();
  const canManage = isAdmin || isGerente;

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [managerCompanies, setManagerCompanies] = useState<ManagerCompany[]>([]);
  const [roleDefs, setRoleDefs] = useState<RoleDef[]>([]);

  // Create dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("vendedor");
  const [createCompanyId, setCreateCompanyId] = useState<string>("__none__");
  const [createExtraCompanyIds, setCreateExtraCompanyIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createPassword, setCreatePassword] = useState("");

  const generateSecurePassword = () => {
    const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  };

  // Edit dialog
  const [openEdit, setOpenEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editCompanyId, setEditCompanyId] = useState<string>("__none__");
  const [editExtraCompanyIds, setEditExtraCompanyIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset password dialog
  const [openResetPw, setOpenResetPw] = useState(false);
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPw, setResettingPw] = useState(false);

  // Delete dialog
  const [openDelete, setOpenDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    const [{ data: p }, { data: r }, { data: c }, { data: mc }, { data: rd }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("user_roles").select("user_id, role, role_key"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("manager_companies").select("user_id, company_id"),
      supabase.from("role_definitions").select("*").order("is_system", { ascending: false }).order("label"),
    ]);
    setProfiles(p || []);
    setUserRoles((r || []) as UserRole[]);
    setCompanies(c || []);
    setManagerCompanies(mc || []);
    setRoleDefs((rd || []) as RoleDef[]);
  };

  useEffect(() => { fetchData(); }, []);

  const getRoles = (userId: string) =>
    userRoles.filter((r) => r.user_id === userId).map((r) => r.role_key || r.role);

  const getExtraCompanies = (userId: string) =>
    managerCompanies.filter((mc) => mc.user_id === userId).map((mc) => mc.company_id);

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "default";
      case "gerente": return "secondary";
      case "financeiro": return "secondary";
      default: return "outline";
    }
  };

  const roleOptions = isAdmin
    ? roleDefs.map((r) => ({ value: r.key, label: r.label }))
    : roleDefs
        .filter((r) => r.base_role === "gerente" || r.base_role === "vendedor")
        .map((r) => ({ value: r.key, label: r.label }));

  const toggleCompanyInList = (list: string[], setList: (v: string[]) => void, companyId: string) => {
    setList(list.includes(companyId) ? list.filter((id) => id !== companyId) : [...list, companyId]);
  };

  // ── CREATE ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const emailExists = profiles.some((p) => p.email.toLowerCase() === email.trim().toLowerCase());
    if (emailExists) {
      toast.error("Este email já está cadastrado no sistema");
      return;
    }
    const password = createPassword.trim();
    if (password.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres");
      return;
    }
    setCreating(true);
    const body: Record<string, any> = { email, password, full_name: name, role };
    if (isAdmin && createCompanyId !== "__none__") {
      body.company_id = createCompanyId;
    }
    if (isAdmin && role === "gerente" && createExtraCompanyIds.length > 0) {
      body.extra_company_ids = createExtraCompanyIds;
    }
    const { data, error } = await supabase.functions.invoke("create-user", { body });
    const errMsg = data?.error || (error as any)?.context?.body ? JSON.parse((error as any)?.context?.body)?.error : error?.message;
    if (error || data?.error) {
      toast.error(errMsg || "Erro ao criar usuário");
      setCreating(false);
      return;
    }

    // Sync manager_companies diretamente se o novo usuario for gerente com empresas extras
    if (isAdmin && role === "gerente" && createExtraCompanyIds.length > 0 && data?.user_id) {
      await supabase.from("manager_companies").insert(
        createExtraCompanyIds.map((cid) => ({ user_id: data.user_id as string, company_id: cid }))
      );
    }

    toast.success("Usuário criado com sucesso. Copie a senha antes de fechar.", { duration: 8000 });
    setOpenCreate(false);
    setName(""); setEmail(""); setRole("vendedor"); setCreatePassword(""); setCreateCompanyId("__none__"); setCreateExtraCompanyIds([]);
    fetchData();
    setCreating(false);
  };

  // ── EDIT ──
  const openEditDialog = (p: Profile) => {
    setEditTarget(p);
    setEditName(p.full_name);
    setEditEmail(p.email);
    const roles = getRoles(p.user_id);
    setEditRole(roles[0] || "vendedor");
    setEditCompanyId(p.company_id || "__none__");
    setEditExtraCompanyIds(getExtraCompanies(p.user_id));
    setOpenEdit(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    const body: Record<string, any> = {
      action: "update",
      target_user_id: editTarget.user_id,
      full_name: editName,
      email: editEmail,
      role: editRole,
    };
    if (isAdmin) {
      body.company_id = editCompanyId === "__none__" ? null : editCompanyId;
      body.extra_company_ids = editRole === "gerente" ? editExtraCompanyIds : [];
    }
    const { data, error } = await supabase.functions.invoke("manage-user", { body });
    if (error || data?.error) {
      toast.error(data?.error || "Erro ao atualizar");
      setSaving(false);
      return;
    }

    // Sync manager_companies directly via client (admin has full RLS access).
    // This guarantees the data is correct regardless of edge function version.
    if (isAdmin) {
      await supabase.from("manager_companies").delete().eq("user_id", editTarget.user_id);
      const extraIds = editRole === "gerente" ? editExtraCompanyIds : [];
      if (extraIds.length > 0) {
        await supabase.from("manager_companies").insert(
          extraIds.map((cid) => ({ user_id: editTarget.user_id, company_id: cid }))
        );
      }
    }

    toast.success("Usuário atualizado");
    setOpenEdit(false);
    fetchData();
    setSaving(false);
  };

  // ── RESET PASSWORD ──
  const openResetDialog = (p: Profile) => { setResetTarget(p); setNewPassword(""); setOpenResetPw(true); };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResettingPw(true);
    const { data, error } = await supabase.functions.invoke("manage-user", {
      body: { action: "reset_password", target_user_id: resetTarget.user_id, new_password: newPassword },
    });
    if (error || data?.error) { toast.error(data?.error || "Erro ao alterar senha"); }
    else { toast.success("Senha alterada com sucesso"); setOpenResetPw(false); }
    setResettingPw(false);
  };

  // ── DELETE ──
  const openDeleteDialog = (p: Profile) => { setDeleteTarget(p); setOpenDelete(true); };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("manage-user", {
      body: { action: "delete", target_user_id: deleteTarget.user_id },
    });
    if (error || data?.error) { toast.error(data?.error || "Erro ao excluir"); }
    else { toast.success("Usuário excluído"); setOpenDelete(false); fetchData(); }
    setDeleting(false);
  };

  const rolePriority: Record<string, number> = { admin: 0, gerente: 1, financeiro: 2, vendedor: 3 };

  const sortedProfiles = [...profiles].sort((a, b) => {
    const aRoles = getRoles(a.user_id);
    const bRoles = getRoles(b.user_id);
    const aPri = Math.min(...aRoles.map((r) => rolePriority[r] ?? 3));
    const bPri = Math.min(...bRoles.map((r) => rolePriority[r] ?? 3));
    if (aPri !== bPri) return aPri - bPri;
    return (a.full_name || "").localeCompare(b.full_name || "", "pt-BR");
  });

  const canManageUser = (p: Profile) => {
    if (p.user_id === user?.id) return false;
    return isAdmin;
  };

  const getUserCompanyNames = (p: Profile) => {
    const names: string[] = [];
    if (p.company_id) {
      const main = companies.find((c) => c.id === p.company_id);
      if (main) names.push(main.name);
    }
    const extras = getExtraCompanies(p.user_id);
    extras.forEach((cid) => {
      if (cid !== p.company_id) {
        const c = companies.find((co) => co.id === cid);
        if (c) names.push(c.name);
      }
    });
    return names;
  };

  const ExtraCompaniesCheckboxes = ({
    selectedIds, onToggle, excludeId
  }: { selectedIds: string[]; onToggle: (id: string) => void; excludeId?: string }) => (
    <div className="space-y-2">
      <Label>Empresas extras (gerente)</Label>
      <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-2">
        {companies.filter((c) => c.id !== excludeId).map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={selectedIds.includes(c.id)}
              onCheckedChange={() => onToggle(c.id)}
            />
            {c.name}
          </label>
        ))}
        {companies.filter((c) => c.id !== excludeId).length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma empresa disponível</p>
        )}
      </div>
    </div>
  );

  const ActionMenu = ({ profile }: { profile: Profile }) => {
    if (!canManageUser(profile)) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEditDialog(profile)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openResetDialog(profile)}><KeyRound className="mr-2 h-4 w-4" />Alterar Senha</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => openDeleteDialog(profile)}><Trash2 className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (!canManage) {
    return <AppLayout><p className="text-muted-foreground">Acesso restrito a administradores e gerentes.</p></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Usuários</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {isGerente && !isAdmin ? "Usuários da sua empresa" : "Gerencie os usuários do sistema"} — {profiles.length} usuário{profiles.length !== 1 ? "s" : ""} cadastrado{profiles.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isAdmin && (
        <Dialog open={openCreate} onOpenChange={(open) => {
          setOpenCreate(open);
          if (open && !createPassword) setCreatePassword(generateSecurePassword());
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" />Novo Usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar Usuário</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Papel</Label>
                <Select value={role} onValueChange={(v) => { setRole(v); if (v !== "gerente") setCreateExtraCompanyIds([]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Empresa principal</Label>
                  <Select value={createCompanyId} onValueChange={setCreateCompanyId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isAdmin && role === "gerente" && (
                <ExtraCompaniesCheckboxes
                  selectedIds={createExtraCompanyIds}
                  onToggle={(id) => toggleCompanyInList(createExtraCompanyIds, setCreateExtraCompanyIds, id)}
                  excludeId={createCompanyId !== "__none__" ? createCompanyId : undefined}
                />
              )}
              <div className="space-y-2">
                <Label>Senha inicial</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <Button type="button" variant="outline" onClick={() => setCreatePassword(generateSecurePassword())}>
                    Gerar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Anote a senha e repasse ao usuário de forma segura. Mínimo 8 caracteres.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? "Criando..." : "Criar Usuário"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block rounded-xl border bg-card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Nome</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Email</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Papel</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Empresa</th>
              <th className="text-right p-3 text-sm font-medium text-muted-foreground">Ações</th>
            </tr>
          </thead>
          <tbody>
            {sortedProfiles.map((p) => {
              const companyNames = getUserCompanyNames(p);
              return (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{p.full_name || "—"}</td>
                  <td className="p-3 text-muted-foreground text-sm">{p.email}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {getRoles(p.user_id).map((r) => (
                        <Badge key={r} variant={roleBadgeVariant(r) as any}>{r}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">
                    {companyNames.length > 0 ? companyNames.join(", ") : "—"}
                  </td>
                  <td className="p-3 text-right"><ActionMenu profile={p} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {sortedProfiles.map((p) => {
          const companyNames = getUserCompanyNames(p);
          return (
            <div key={p.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{p.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.email}</p>
                  </div>
                </div>
                <ActionMenu profile={p} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {getRoles(p.user_id).map((r) => (
                  <Badge key={r} variant={roleBadgeVariant(r) as any} className="text-xs">{r}</Badge>
                ))}
                {companyNames.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto truncate">
                    {companyNames.join(", ")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={editRole} onValueChange={(v) => { setEditRole(v); if (v !== "gerente") setEditExtraCompanyIds([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>Empresa principal</Label>
                <Select value={editCompanyId} onValueChange={setEditCompanyId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Nenhuma</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && editRole === "gerente" && (
              <ExtraCompaniesCheckboxes
                selectedIds={editExtraCompanyIds}
                onToggle={(id) => toggleCompanyInList(editExtraCompanyIds, setEditExtraCompanyIds, id)}
                excludeId={editCompanyId !== "__none__" ? editCompanyId : undefined}
              />
            )}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={openResetPw} onOpenChange={setOpenResetPw}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alterar Senha</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Definir nova senha para <strong>{resetTarget?.full_name || resetTarget?.email}</strong>
          </p>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} placeholder="Mínimo 8 caracteres" />
            </div>
            <Button type="submit" className="w-full" disabled={resettingPw}>
              {resettingPw ? "Alterando..." : "Alterar Senha"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={openDelete} onOpenChange={setOpenDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir Usuário</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpenDelete(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
