import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, UserPlus } from "lucide-react";

type MetaInstance = { id: string; name: string; display_phone: string | null };
type ProfileRow = { user_id: string; full_name: string | null; email: string | null };
type AssignmentRow = { id: string; instance_id: string; user_id: string };

export default function WhatsAppInstanceAssignments({
  instances,
}: {
  instances: MetaInstance[];
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [pickInstance, setPickInstance] = useState("");
  const [pickUser, setPickUser] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profRes, assignRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, email").order("full_name"),
        supabase.from("whatsapp_instance_assignments").select("id, instance_id, user_id"),
      ]);
      if (profRes.error) throw profRes.error;
      if (assignRes.error) throw assignRes.error;
      setProfiles((profRes.data || []) as ProfileRow[]);
      setAssignments((assignRes.data || []) as AssignmentRow[]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar atribuições");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getUserLabel = (userId: string) => {
    const p = profiles.find((x) => x.user_id === userId);
    return p?.full_name || p?.email || userId.slice(0, 8);
  };

  const getInstanceLabel = (instanceId: string) => {
    const i = instances.find((x) => x.id === instanceId);
    return i ? `${i.name}${i.display_phone ? ` (${i.display_phone})` : ""}` : instanceId.slice(0, 8);
  };

  const handleAdd = async () => {
    if (!pickInstance || !pickUser) {
      toast.error("Selecione o número e o usuário");
      return;
    }
    if (assignments.some((a) => a.instance_id === pickInstance && a.user_id === pickUser)) {
      toast.error("Este usuário já está atribuído a este número");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("whatsapp_instance_assignments").insert({
        instance_id: pickInstance,
        user_id: pickUser,
      });
      if (error) throw error;
      toast.success("Atribuição salva");
      setPickUser("");
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("whatsapp_instance_assignments").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover");
    } finally {
      setSaving(false);
    }
  };

  if (instances.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">Atribuir números a usuários</h3>
        <p className="text-[10px] text-muted-foreground mt-1">
          Cada vendedor/financeiro só vê conversas dos números atribuídos. Admin e gerente veem todos.
          Vários usuários podem usar o mesmo número.
        </p>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Número WhatsApp</Label>
              <Select value={pickInstance} onValueChange={setPickInstance}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usuário</Label>
              <Select value={pickUser} onValueChange={setPickUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email || p.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="button" size="sm" onClick={handleAdd} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
            Adicionar atribuição
          </Button>

          <ul className="space-y-2 text-sm border-t pt-3">
            {assignments.length === 0 ? (
              <li className="text-muted-foreground text-xs">Nenhuma atribuição — vendedores não verão conversas até cadastrar.</li>
            ) : (
              assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                  <span>
                    <strong>{getUserLabel(a.user_id)}</strong>
                    <span className="text-muted-foreground"> → </span>
                    {getInstanceLabel(a.instance_id)}
                  </span>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={saving} onClick={() => void handleRemove(a.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
