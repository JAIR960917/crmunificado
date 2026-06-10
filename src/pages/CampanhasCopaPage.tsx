import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ExternalLink, Pencil, RefreshCw, Search, Share2, Trophy } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import CampanhaCopaSubmissionDialog, {
  type CampanhaCopaSubmission,
} from "@/components/campanha-copa/CampanhaCopaSubmissionDialog";
import CampanhaCopaJogoConfigCard from "@/components/campanha-copa/CampanhaCopaJogoConfigCard";
import CampanhaCopaPixelConfigCard from "@/components/campanha-copa/CampanhaCopaPixelConfigCard";
import CampanhaCopaFormularioConfigCard from "@/components/campanha-copa/CampanhaCopaFormularioConfigCard";
import CampanhaCopaCidadeLojaConfigCard from "@/components/campanha-copa/CampanhaCopaCidadeLojaConfigCard";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMPANHA_COPA_BANNER_URL_KEY,
  CAMPANHA_COPA_JOGO_SETTING_KEY,
  CAMPANHA_COPA_PIXEL_FORM_KEY,
  CAMPANHA_COPA_PIXEL_SUCCESS_KEY,
} from "@/lib/campanha-copa-jogo";
import {
  CAMPANHA_COPA_PERIODO_FIM_KEY,
  CAMPANHA_COPA_PERIODO_INICIO_KEY,
} from "@/lib/campanha-copa-periodo";
import {
  distributeUsersEqually,
  matchCityToRoute,
  resolveCompanyForCity,
  type CidadeLojaRoute,
} from "@/lib/campanha-copa-cidade";
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

type Profile = {
  user_id: string;
  full_name: string;
  email?: string;
  company_id: string | null;
};

type UserRole = { user_id: string; role: string };

const ALL = "__all__";
const NONE = "__none__";

export default function CampanhasCopaPage() {
  const { isAdmin, user } = useAuth();
  const [rows, setRows] = useState<CampanhaCopaSubmission[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [cityRoutes, setCityRoutes] = useState<CidadeLojaRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState(ALL);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [detailRow, setDetailRow] = useState<CampanhaCopaSubmission | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [jogoConfigRaw, setJogoConfigRaw] = useState<string | null>(null);
  const [pixelForm, setPixelForm] = useState("");
  const [pixelSuccess, setPixelSuccess] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFim, setPeriodoFim] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");

  const profileName = useCallback(
    (id: string | null) => {
      if (!id) return "Sem responsável";
      const p = profiles.find((x) => x.user_id === id);
      return p?.full_name || p?.email || id.slice(0, 8);
    },
    [profiles],
  );

  const currentUserName = useMemo(() => {
    if (!user?.id) return "Usuário";
    const p = profiles.find((x) => x.user_id === user.id);
    return p?.full_name || p?.email || "Usuário";
  }, [profiles, user?.id]);

  const eligibleUserIds = useCallback(
    (companyId: string) => {
      const ids = profiles.filter((p) => p.company_id === companyId).map((p) => p.user_id);
      return userRoles
        .filter((r) => ids.includes(r.user_id) && (r.role === "vendedor" || r.role === "gerente"))
        .map((r) => r.user_id);
    },
    [profiles, userRoles],
  );

  const eligibleForSubmission = useCallback(
    (submission: CampanhaCopaSubmission) => {
      const route = resolveCompanyForCity(submission.cidade, cityRoutes);
      if (!route) return [];
      const ids = new Set(eligibleUserIds(route.company_id));
      return profiles.filter((p) => ids.has(p.user_id));
    },
    [cityRoutes, eligibleUserIds, profiles],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        subRes,
        profRes,
        rolesRes,
        routesRes,
        jogoRes,
        pixelFormRes,
        pixelSuccessRes,
        periodoInicioRes,
        periodoFimRes,
        bannerRes,
      ] = await Promise.all([
          supabase
            .from("campanha_copa_submissions")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(2000),
          supabase
            .from("profiles")
            .select("user_id, full_name, email, company_id")
            .order("full_name"),
          supabase.from("user_roles").select("user_id, role"),
          supabase
            .from("campanha_copa_cidade_lojas" as never)
            .select("id, cidade_label, company_id"),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_JOGO_SETTING_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_PIXEL_FORM_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_PIXEL_SUCCESS_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_PERIODO_INICIO_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_PERIODO_FIM_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          isAdmin
            ? supabase
                .from("system_settings")
                .select("setting_value")
                .eq("setting_key", CAMPANHA_COPA_BANNER_URL_KEY)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

      if (subRes.error) throw subRes.error;
      setRows((subRes.data || []) as CampanhaCopaSubmission[]);
      setProfiles((profRes.data || []) as Profile[]);
      setUserRoles((rolesRes.data || []) as UserRole[]);
      setCityRoutes((routesRes.data || []) as CidadeLojaRoute[]);
      if (jogoRes.data?.setting_value) setJogoConfigRaw(jogoRes.data.setting_value);
      if (pixelFormRes.data?.setting_value != null) setPixelForm(pixelFormRes.data.setting_value);
      if (pixelSuccessRes.data?.setting_value != null) {
        setPixelSuccess(pixelSuccessRes.data.setting_value);
      }
      if (periodoInicioRes.data?.setting_value != null) {
        setPeriodoInicio(periodoInicioRes.data.setting_value);
      }
      if (periodoFimRes.data?.setting_value != null) {
        setPeriodoFim(periodoFimRes.data.setting_value);
      }
      if (bannerRes.data?.setting_value != null) {
        setBannerUrl(bannerRes.data.setting_value);
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

  const cityOptions = useMemo(() => {
    const labels = new Set<string>();
    cityRoutes.forEach((r) => labels.add(r.cidade_label));
    rows.forEach((r) => {
      if (r.cidade?.trim()) labels.add(r.cidade.trim());
    });
    return [...labels].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows, cityRoutes]);

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.nome, r.telefone, r.cidade, r.cpf, r.palpite_texto, r.jogo_label, profileName(r.assigned_to)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search, profileName]);

  const filtered = useMemo(() => {
    if (cityFilter === ALL) return searchFiltered;
    return searchFiltered.filter(
      (r) => r.cidade && matchCityToRoute(r.cidade, cityFilter),
    );
  }, [searchFiltered, cityFilter]);

  const unassignedInFilter = useMemo(
    () => filtered.filter((r) => !r.assigned_to),
    [filtered],
  );

  const openDetail = (row: CampanhaCopaSubmission) => {
    setDetailRow(row);
    setDetailOpen(true);
  };

  const reassign = async (submission: CampanhaCopaSubmission, newUserId: string) => {
    const targetId = newUserId === NONE ? null : newUserId;
    if (targetId === submission.assigned_to) return;

    const oldName = profileName(submission.assigned_to);
    const newName = profileName(targetId);

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

      const { error: histErr } = await supabase.from("campanha_copa_history" as never).insert({
        submission_id: submission.id,
        user_id: user?.id ?? null,
        action: "reassigned",
        summary: `${currentUserName} redirecionou de ${oldName} para ${newName}.`,
      } as never);
      if (histErr) throw histErr;

      setRows((prev) =>
        prev.map((r) => (r.id === submission.id ? { ...r, assigned_to: targetId } : r)),
      );
      if (detailRow?.id === submission.id) {
        setDetailRow({ ...submission, assigned_to: targetId });
        setHistoryRefreshKey((k) => k + 1);
      }
      toast.success("Lead redirecionado com sucesso.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao redirecionar");
    } finally {
      setReassigning(null);
    }
  };

  const distributeEqually = async () => {
    if (cityFilter === ALL) {
      toast.error("Selecione uma cidade para distribuir os leads.");
      return;
    }

    const route = resolveCompanyForCity(cityFilter, cityRoutes);
    if (!route) {
      toast.error("Esta cidade não está vinculada a uma loja. Configure em Cidades e lojas.");
      return;
    }

    const eligible = eligibleUserIds(route.company_id);
    if (eligible.length === 0) {
      toast.error("Não há vendedores ou gerentes cadastrados nesta loja.");
      return;
    }

    const targets = [...unassignedInFilter].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    if (targets.length === 0) {
      toast.info("Não há inscrições sem responsável nesta cidade.");
      return;
    }

    const assignments = distributeUsersEqually(
      targets.map((t) => t.id),
      eligible,
    );

    setDistributing(true);
    try {
      for (const submission of targets) {
        const targetId = assignments.get(submission.id);
        if (!targetId) continue;

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

        await supabase.from("campanha_copa_history" as never).insert({
          submission_id: submission.id,
          user_id: user?.id ?? null,
          action: "reassigned",
          summary: `${currentUserName} distribuiu igualmente para ${profileName(targetId)} (${cityFilter}).`,
        } as never);
      }

      const lastId = assignments.get(targets[targets.length - 1].id);
      if (lastId) {
        await supabase.from("campanha_copa_round_robin" as never).upsert({
          company_id: route.company_id,
          last_user_id: lastId,
          updated_at: new Date().toISOString(),
        } as never);
      }

      toast.success(`${targets.length} inscrição(ões) distribuída(s) entre ${eligible.length} responsável(is).`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao distribuir leads");
    } finally {
      setDistributing(false);
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
              Inscrições do formulário público — distribuídas por cidade e loja.
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
          <CampanhaCopaCidadeLojaConfigCard onSaved={() => void load()} />
        )}

        {isAdmin && (
          <CampanhaCopaJogoConfigCard initialRaw={jogoConfigRaw} onSaved={() => void load()} />
        )}

        {isAdmin && (
          <CampanhaCopaFormularioConfigCard
            initialPeriodoInicio={periodoInicio}
            initialPeriodoFim={periodoFim}
            initialBannerUrl={bannerUrl}
            onSaved={() => void load()}
          />
        )}

        {isAdmin && (
          <CampanhaCopaPixelConfigCard
            initialFormPixel={pixelForm}
            initialSuccessPixel={pixelSuccess}
            onSaved={() => void load()}
          />
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <CardTitle className="text-base">Inscrições</CardTitle>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar nome, CPF, telefone..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Cidade:</span>
                  <Select value={cityFilter} onValueChange={setCityFilter}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                      <SelectValue placeholder="Todas as cidades" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as cidades</SelectItem>
                      {cityOptions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={distributing || cityFilter === ALL}
                  onClick={() => void distributeEqually()}
                  className="w-full sm:w-auto"
                >
                  <Share2 className="h-4 w-4 mr-1" />
                  {distributing
                    ? "Distribuindo..."
                    : `Distribuir ${unassignedInFilter.length} sem responsável`}
                </Button>
              </div>
              {cityFilter !== ALL && (
                <CardDescription>
                  {filtered.length} inscrição(ões) nesta cidade
                  {unassignedInFilter.length > 0
                    ? ` · ${unassignedInFilter.length} aguardando distribuição`
                    : ""}
                </CardDescription>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Data</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Idade</TableHead>
                    <TableHead>Jogo</TableHead>
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
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                        Nenhuma inscrição encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const storeStaff = eligibleForSubmission(r);
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Ver inscrição"
                              onClick={() => openDetail(r)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                          </TableCell>
                          <TableCell className="font-medium">{r.nome}</TableCell>
                          <TableCell>{r.telefone}</TableCell>
                          <TableCell>{r.cidade || "—"}</TableCell>
                          <TableCell>{r.idade || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">
                            {r.jogo_label || r.jogo || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {r.palpite_texto ||
                                `${r.palpite_brasil ?? "?"} x ${r.palpite_marrocos ?? "?"}`}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.usa_oculos === "sim" ? "Sim" : r.usa_oculos === "nao" ? "Não" : "—"}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate text-xs">
                            {r.ultimo_exame_vista || "—"}
                          </TableCell>
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
                                {storeStaff.map((p) => (
                                  <SelectItem key={p.user_id} value={p.user_id}>
                                    {p.full_name || p.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <CampanhaCopaSubmissionDialog
        submission={detailRow}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        profiles={profiles}
        profileName={profileName}
        historyRefreshKey={historyRefreshKey}
      />
    </AppLayout>
  );
}
