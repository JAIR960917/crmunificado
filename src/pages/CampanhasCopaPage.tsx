import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ExternalLink, RefreshCw, Search, Trophy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Submission = {
  id: string;
  lead_id: string | null;
  nome: string;
  idade: string | null;
  cidade: string | null;
  telefone: string;
  usa_oculos: string | null;
  ultimo_exame_vista: string | null;
  palpite_brasil: number | null;
  palpite_marrocos: number | null;
  palpite_texto: string | null;
  assigned_to: string | null;
  created_at: string;
};

type Profile = { user_id: string; full_name: string; email?: string };

const NONE = "__none__";

export default function CampanhasCopaPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Submission[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [defaultUserId, setDefaultUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDefault, setSavingDefault] = useState(false);
  const [search, setSearch] = useState("");
  const [reassigning, setReassigning] = useState<string | null>(null);

  const profileName = useCallback(
    (id: string | null) => {
      if (!id) return "—";
      const p = profiles.find((x) => x.user_id === id);
      return p?.full_name || p?.email || id.slice(0, 8);
    },
    [profiles],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, profRes, settingRes] = await Promise.all([
        supabase
          .from("campanha_copa_submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.from("profiles").select("user_id, full_name, email").order("full_name"),
        isAdmin
          ? supabase
              .from("system_settings")
              .select("setting_value")
              .eq("setting_key", "campanha_copa_default_user_id")
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (subRes.error) throw subRes.error;
      setRows((subRes.data || []) as Submission[]);
      setProfiles((profRes.data || []) as Profile[]);
      if (settingRes.data?.setting_value) {
        setDefaultUserId(settingRes.data.setting_value);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar inscrições");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.nome, r.telefone, r.cidade, r.palpite_texto, profileName(r.assigned_to)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search, profileName]);

  const saveDefaultUser = async () => {
    if (!isAdmin) return;
    setSavingDefault(true);
    try {
      const { error } = await supabase.from("system_settings").upsert(
        {
          setting_key: "campanha_copa_default_user_id",
          setting_value: defaultUserId === NONE ? "" : defaultUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      );
      if (error) throw error;
      toast.success("Responsável padrão das novas inscrições atualizado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingDefault(false);
    }
  };

  const reassign = async (submission: Submission, newUserId: string) => {
    const targetId = newUserId === NONE ? null : newUserId;
    setReassigning(submission.id);
    try {
      const { error: subErr } = await supabase
        .from("campanha_copa_submissions")
        .update({ assigned_to: targetId })
        .eq("id", submission.id);
      if (subErr) throw subErr;

      if (submission.lead_id) {
        const { error: leadErr } = await supabase
          .from("crm_leads")
          .update({ assigned_to: targetId })
          .eq("id", submission.lead_id);
        if (leadErr) throw leadErr;
      }

      setRows((prev) =>
        prev.map((r) => (r.id === submission.id ? { ...r, assigned_to: targetId } : r)),
      );
      toast.success("Lead redirecionado com sucesso.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redirecionar");
    } finally {
      setReassigning(null);
    }
  };

  const formUrl = `${window.location.origin}/campanha-copa`;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Trophy className="h-7 w-7 text-amber-500" />
              Campanhas Copa
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Inscrições do formulário público da campanha Copa.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/campanha-copa" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                Abrir formulário
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de inscrições</CardDescription>
              <CardTitle className="text-3xl">{rows.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Link do formulário</CardDescription>
              <CardTitle className="text-sm font-mono break-all">{formUrl}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sem responsável</CardDescription>
              <CardTitle className="text-3xl">
                {rows.filter((r) => !r.assigned_to).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Responsável padrão (novas inscrições)
              </CardTitle>
              <CardDescription>
                Leads do formulário público entram atribuídos a este usuário. Depois você pode
                redirecionar para gerentes ou vendedores na tabela abaixo.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-3">
              <Select value={defaultUserId || NONE} onValueChange={setDefaultUserId}>
                <SelectTrigger className="sm:max-w-md">
                  <SelectValue placeholder="Selecione o usuário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum (sem atribuição)</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => void saveDefaultUser()} disabled={savingDefault}>
                {savingDefault ? "Salvando..." : "Salvar padrão"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <CardTitle className="text-base">Inscrições</CardTitle>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar nome, telefone, cidade..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Idade</TableHead>
                    <TableHead>Palpite</TableHead>
                    <TableHead>Óculos</TableHead>
                    <TableHead>Último exame</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Redirecionar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        Nenhuma inscrição encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="font-medium">{r.nome}</TableCell>
                        <TableCell>{r.telefone}</TableCell>
                        <TableCell>{r.cidade || "—"}</TableCell>
                        <TableCell>{r.idade || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {r.palpite_texto || `${r.palpite_brasil ?? "?"} x ${r.palpite_marrocos ?? "?"}`}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.usa_oculos === "sim" ? "Sim" : r.usa_oculos === "nao" ? "Não" : "—"}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs">{r.ultimo_exame_vista || "—"}</TableCell>
                        <TableCell className="text-sm">{profileName(r.assigned_to)}</TableCell>
                        <TableCell>
                          <Select
                            value={r.assigned_to || NONE}
                            onValueChange={(v) => void reassign(r, v)}
                            disabled={reassigning === r.id}
                          >
                            <SelectTrigger className="h-8 w-[160px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Sem responsável</SelectItem>
                              {profiles.map((p) => (
                                <SelectItem key={p.user_id} value={p.user_id}>
                                  {p.full_name || p.email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
