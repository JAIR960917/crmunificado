import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  Loader2,
  Plug,
  RefreshCw,
  History,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Power,
  Building2,
  Clock,
  Plug2,
  Users,
  StopCircle,
} from "lucide-react";
import { UserMappingDialog } from "@/components/ssotica/UserMappingDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Company {
  id: string;
  name: string;
  cnpj: string | null;
}

interface Integration {
  id: string;
  company_id: string;
  cnpj: string;
  license_code: string | null;
  bearer_token: string;
  is_active: boolean;
  initial_sync_done: boolean;
  last_sync_vendas_at: string | null;
  last_sync_receber_at: string | null;
  sync_status: string;
  last_error: string | null;
  backfill_status?: string | null;
  backfill_chunk_index?: number | null;
  backfill_total_chunks?: number | null;
  backfill_phase?: string | null;
  backfill_next_run_at?: string | null;
  updated_at?: string | null;
}

interface SyncLog {
  id: string;
  sync_type: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_processed: number;
  items_created: number;
  items_updated: number;
  error_message: string | null;
  details: any;
}

function getBackfillVisualProgress(integration?: Pick<Integration, "backfill_status" | "backfill_chunk_index" | "backfill_total_chunks"> | null) {
  const total = integration?.backfill_total_chunks ?? 32;
  const completed = integration?.backfill_chunk_index ?? 0;
  const status = integration?.backfill_status ?? "idle";
  const isActive = status === "running" || status === "scheduled";
  const isDone = status === "done";
  const currentChunk = isActive && completed < total ? completed + 1 : completed;

  return {
    total,
    completed,
    status,
    isActive,
    isDone,
    currentChunk,
    percent: total > 0 ? Math.round((currentChunk / total) * 100) : 0,
  };
}

export default function SSoticaIntegrationsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [editing, setEditing] = useState<{
    company: Company;
    integration?: Integration;
  } | null>(null);
  const [form, setForm] = useState({ cnpj: "", license_code: "", bearer_token: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [logsFor, setLogsFor] = useState<Integration | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [syncHour, setSyncHour] = useState<string>("6");
  const [savingHour, setSavingHour] = useState(false);
  const [mappingFor, setMappingFor] = useState<Company | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [resyncingAll, setResyncingAll] = useState(false);

  async function handleResyncAll() {
    const active = integrations.filter((i) => i.is_active);
    if (active.length === 0) {
      toast({ title: "Nenhuma loja ativa", description: "Ative ao menos uma integração antes de ressincronizar.", variant: "destructive" });
      return;
    }
    if (!confirm(
      `Ressincronizar TUDO em ${active.length} loja(s)?\n\n` +
      `• A 1ª loja inicia o Backfill 96m agora (32 lotes de ~3 meses).\n` +
      `• As demais serão agendadas em sequência, espaçadas 30 min entre cada.\n` +
      `• Tempo total estimado: ~${Math.round((active.length * 30))} min.\n\n` +
      `Continuar?`
    )) return;

    setResyncingAll(true);
    try {
      // Agenda as lojas 2..N escalonadas (30min entre cada início)
      const SPACING_MIN = 30;
      for (let i = 1; i < active.length; i++) {
        const runAt = new Date(Date.now() + i * SPACING_MIN * 60 * 1000).toISOString();
        await supabase
          .from("ssotica_integrations")
          .update({
            backfill_status: "scheduled",
            backfill_next_run_at: runAt,
            backfill_chunk_index: 0,
            backfill_started_at: new Date().toISOString(),
          })
          .eq("id", active[i].id);
      }

      // Dispara a 1ª loja imediatamente
      const first = active[0];
      const { error } = await supabase.functions.invoke("ssotica-sync", {
        body: { mode: "start_backfill", integration_id: first.id },
      });
      if (error) throw error;

      toast({
        title: "Ressincronização iniciada",
        description: `${active.length} loja(s) na fila. A 1ª está rodando agora; as demais começam a cada ${SPACING_MIN} min.`,
      });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Erro ao ressincronizar tudo", description: e.message, variant: "destructive" });
    } finally {
      setResyncingAll(false);
    }
  }

  async function handleStopAllBackfills() {
    if (!confirm("Parar TODOS os backfills em andamento?\n\nIsso vai interromper todas as importações que estão rodando no momento. Você poderá retomar manualmente, uma loja por vez, depois.")) return;
    setStoppingAll(true);
    try {
      const { error, count } = await supabase
        .from("ssotica_integrations")
        .update({
          backfill_status: "idle",
          backfill_next_run_at: null,
          sync_status: "idle",
        }, { count: "exact" })
        .or("backfill_status.in.(running,scheduled),sync_status.eq.running");
      if (error) throw error;
      toast({
        title: "Backfills interrompidos",
        description: `${count ?? 0} loja(s) tiveram o backfill parado. Agora dispare manualmente uma de cada vez.`,
      });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Erro ao parar backfills", description: e.message, variant: "destructive" });
    } finally {
      setStoppingAll(false);
    }
  }

  async function handleStopBackfill(integ: Integration) {
    if (!confirm("Parar o backfill desta loja?")) return;
    setStoppingId(integ.id);
    try {
      const { error } = await supabase
        .from("ssotica_integrations")
        .update({
          backfill_status: "idle",
          backfill_next_run_at: null,
          sync_status: "idle",
        })
        .eq("id", integ.id);
      if (error) throw error;
      toast({ title: "Backfill interrompido" });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setStoppingId(null);
    }
  }

  async function fetchAll() {
    setLoading(true);
    const [{ data: comps }, { data: integs }, { data: setting }] = await Promise.all([
      supabase.from("companies").select("id, name, cnpj").order("name"),
      supabase.from("ssotica_integrations").select("*"),
      supabase.from("system_settings").select("setting_value").eq("setting_key", "ssotica_sync_hour").maybeSingle(),
    ]);
    setCompanies(comps ?? []);
    setIntegrations(integs ?? []);
    if (setting?.setting_value) setSyncHour(setting.setting_value);
    setLoading(false);
  }

  async function handleSaveHour() {
    setSavingHour(true);
    try {
      const { data: existing } = await supabase
        .from("system_settings")
        .select("id")
        .eq("setting_key", "ssotica_sync_hour")
        .maybeSingle();
      if (existing) {
        await supabase.from("system_settings").update({ setting_value: syncHour }).eq("id", existing.id);
      } else {
        await supabase.from("system_settings").insert({ setting_key: "ssotica_sync_hour", setting_value: syncHour });
      }
      const { error } = await supabase.rpc("manage_ssotica_cron" as any);
      if (error) throw error;
      const h = parseInt(syncHour, 10);
      const horarios = [h, (h + 6) % 24, (h + 12) % 24, (h + 18) % 24]
        .map((x) => String(x).padStart(2, "0") + "h")
        .join(", ");
      toast({ title: "Horário salvo", description: `Sincronização agendada a cada 6h: ${horarios} (Brasília).` });
    } catch (e: any) {
      toast({ title: "Erro ao salvar horário", description: e.message, variant: "destructive" });
    } finally {
      setSavingHour(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;

    fetchAll();

    const interval = window.setInterval(() => {
      fetchAll();
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchAll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAdmin]);

  if (authLoading) return <div className="p-8">Carregando...</div>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const integrationByCompany = new Map(integrations.map((i) => [i.company_id, i]));

  async function openEdit(company: Company) {
    const integration = integrationByCompany.get(company.id);
    setEditing({ company, integration });

    // Por segurança o bearer_token NUNCA é trazido para o navegador (fica criptografado no banco).
    // O admin deixa em branco para manter o atual ou digita um novo para substituir.
    // O license_code é descriptografado via RPC apenas para edição.
    let licenseDecrypted = integration?.license_code ?? "";
    if (integration && licenseDecrypted.startsWith("enc:")) {
      const { data } = await supabase.rpc("admin_decrypt_license", { _integration_id: integration.id });
      if (typeof data === "string") licenseDecrypted = data;
    }

    setForm({
      cnpj: integration?.cnpj ?? company.cnpj ?? "",
      license_code: licenseDecrypted,
      bearer_token: "",
      is_active: integration?.is_active ?? true,
    });
  }

  async function handleSave() {
    if (!editing) return;
    const isNewIntegration = !editing.integration;
    if (!form.cnpj.trim() || (isNewIntegration && !form.bearer_token.trim())) {
      toast({ title: "Preencha CNPJ e Token", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // CNPJ: limpa pontuação se for um CNPJ numérico de 14 dígitos.
      const rawCnpj = form.cnpj.trim();
      const onlyDigits = rawCnpj.replace(/\D/g, "");
      const isCnpj = !/[a-zA-Z]/.test(rawCnpj) && onlyDigits.length === 14;
      const cnpjToSave = isCnpj ? onlyDigits : rawCnpj;

      const basePayload: any = {
        company_id: editing.company.id,
        cnpj: cnpjToSave,
        license_code: form.license_code.trim() || null,
        is_active: form.is_active,
      };

      if (editing.integration) {
        // Em edição: só atualiza o token se um novo foi informado
        if (form.bearer_token.trim()) {
          basePayload.bearer_token = form.bearer_token.trim();
        }
        const { error } = await supabase
          .from("ssotica_integrations")
          .update(basePayload)
          .eq("id", editing.integration.id);
        if (error) throw error;
      } else {
        basePayload.bearer_token = form.bearer_token.trim();
        const { error } = await supabase.from("ssotica_integrations").insert(basePayload);
        if (error) throw error;
      }
      toast({ title: "Integração salva" });
      setEditing(null);
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow(integ: Integration, forceFull = false) {
    setSyncingId(integ.id);
    try {
      const body = forceFull
        ? { mode: "start_backfill", integration_id: integ.id }
        : { integration_id: integ.id, manual_recent: true };
      const { data, error } = await supabase.functions.invoke("ssotica-sync", { body });
      if (error) throw error;

      if (forceFull) {
        toast({
          title: "Backfill de 96 meses iniciado",
          description: "O progresso será atualizado automaticamente nesta tela conforme os próximos lotes forem concluídos.",
        });
      } else {
        const result = data?.results?.[0];
        if (result?.ok) {
          const cr = result.contas_receber;
          const v = result.vendas;
          const removidas = cr.removed ?? 0;
          toast({
            title: "Sincronização concluída",
            description: `Cobranças: +${cr.created} novas, ${cr.updated} atualizadas, ${removidas} quitadas/removidas. Renovações: +${v.created} novas, ${v.updated} atualizadas.`,
          });
        } else {
          toast({
            title: "Erro na sincronização",
            description: result?.error ?? "Erro desconhecido",
            variant: "destructive",
          });
        }
      }
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleTestConnection(integ: Integration) {
    setTestingId(integ.id);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ssotica-test-connection", {
        body: { integration_id: integ.id },
      });
      if (error) throw error;
      setTestResult({ ...data, _company: companies.find((c) => c.id === integ.company_id)?.name });
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message, _company: companies.find((c) => c.id === integ.company_id)?.name });
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleActive(integ: Integration) {
    const { error } = await supabase
      .from("ssotica_integrations")
      .update({ is_active: !integ.is_active })
      .eq("id", integ.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: integ.is_active ? "Integração desativada" : "Integração ativada" });
      await fetchAll();
    }
  }

  async function openLogs(integ: Integration) {
    setLogsFor(integ);
    const { data } = await supabase
      .from("ssotica_sync_logs")
      .select("*")
      .eq("integration_id", integ.id)
      .order("started_at", { ascending: false })
      .limit(50);
    setLogs(data ?? []);
  }

  function statusBadge(integ?: Integration) {
    if (!integ) return <Badge variant="outline">Não configurada</Badge>;
    if (!integ.is_active) return <Badge variant="secondary">Desativada</Badge>;
    if (integ.backfill_status === "scheduled") {
      const progress = getBackfillVisualProgress(integ);
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Na fila · lote {progress.currentChunk}/{progress.total}</Badge>;
    }
    if (integ.backfill_status === "running") {
      const progress = getBackfillVisualProgress(integ);
      const phaseLabel = integ.backfill_phase === "vendas" ? "vendas" : "cobranças";
      return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Backfill lote {progress.currentChunk}/{progress.total} · {phaseLabel}</Badge>;
    }
    if (integ.sync_status === "running")
      return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Sincronizando</Badge>;
    if (integ.sync_status === "error" || integ.last_error)
      return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Erro</Badge>;
    return <Badge className="bg-primary text-primary-foreground"><CheckCircle2 className="h-3 w-3 mr-1" />Conectada</Badge>;
  }

  return (
    <AppLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Plug className="h-6 w-6" /> Integrações SSótica
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure o token de acesso de cada loja. A sincronização automática está desativada — cada loja só sincroniza ao clicar em <strong>Sincronizar</strong> ou <strong>Backfill 96m</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopAllBackfills}
              disabled={stoppingAll}
            >
              {stoppingAll ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4 mr-2" />
              )}
              Parar todos os backfills
            </Button>
          </div>
        </div>

        {/* Aviso: sincronização automática desativada — agora é só manual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Sincronização manual
            </CardTitle>
            <CardDescription>
              A sincronização automática está <strong>desativada</strong>. Cada loja só sincroniza
              quando você clicar em <strong>Sincronizar</strong> no card dela abaixo. Assim, você
              evita disputa de recursos entre as lojas e garante que a atualização da loja escolhida
              vá até o fim.
            </CardDescription>
          </CardHeader>
        </Card>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando...</div>
        ) : companies.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Nenhuma empresa cadastrada. Vá em <strong>Empresas</strong> para cadastrar as 9 lojas primeiro.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => {
              const integ = integrationByCompany.get(company.id);
              return (
                <Card key={company.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base flex items-center gap-2 truncate">
                          <Building2 className="h-4 w-4 shrink-0" />
                          {company.name}
                        </CardTitle>
                        <CardDescription className="truncate text-xs">
                          CNPJ: {integ?.cnpj || company.cnpj || "—"}
                          {integ?.license_code && <> · Lic: ••••</>}
                        </CardDescription>
                      </div>
                      {statusBadge(integ)}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    {integ ? (
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>
                          Última venda sync:{" "}
                          {integ.last_sync_vendas_at
                            ? format(new Date(integ.last_sync_vendas_at), "dd/MM HH:mm", { locale: ptBR })
                            : "nunca"}
                        </div>
                        <div>
                          Última cobrança sync:{" "}
                          {integ.last_sync_receber_at
                            ? format(new Date(integ.last_sync_receber_at), "dd/MM HH:mm", { locale: ptBR })
                            : "nunca"}
                        </div>
                        {integ.last_error && (
                          <div className="text-destructive break-words">⚠ {integ.last_error.slice(0, 120)}</div>
                        )}
                        {(() => {
                          const progress = getBackfillVisualProgress(integ);
                          const total = progress.total;
                          const done = progress.completed;
                          const status = progress.status;
                          const phase = (integ as any).backfill_phase === "vendas" ? "vendas" : "cobranças";
                          const remaining = Math.max(0, total - done);
                          const pct = progress.percent;
                          const isActive = progress.isActive;
                          const isDone = progress.isDone;
                          if (!isActive && !isDone && done === 0) return null;
                          return (
                            <div className="pt-1 space-y-1">
                              <div className="flex items-center justify-between text-foreground">
                                <span className="font-medium">
                                  Backfill: {isActive ? progress.currentChunk : done}/{total}
                                  {isActive && remaining > 0 && (
                                    <span className="text-muted-foreground font-normal"> · {status === "running" ? `processando ${phase}` : `na fila`} · {done} concluídos</span>
                                  )}
                                  {isDone && <span className="text-emerald-600 font-normal"> · concluído</span>}
                                </span>
                                <span className="text-muted-foreground">{pct}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all ${isDone ? "bg-emerald-500" : "bg-primary"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Configure CNPJ e Bearer Token desta loja para começar.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-auto pt-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(company)}>
                        <Pencil className="h-3 w-3 mr-1" />
                        {integ ? "Editar" : "Conectar"}
                      </Button>
                      {integ && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleSyncNow(integ)}
                            disabled={syncingId === integ.id || !integ.is_active}
                          >
                            {syncingId === integ.id ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            Sincronizar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (confirm("Iniciar backfill de 96 meses (8 anos)?\n\nO processamento roda em 32 lotes de ~3 meses. O progresso será atualizado automaticamente nesta tela.\n\nFaça uma loja por vez para evitar sobrecarga.")) {
                                handleSyncNow(integ, true);
                              }
                            }}
                            disabled={syncingId === integ.id || !integ.is_active}
                            title="Backfill completo de 96 meses em 32 lotes de ~3 meses"
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Backfill 96m
                          </Button>
                          {((integ as any).backfill_status === "running" || (integ as any).backfill_status === "scheduled") && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleStopBackfill(integ)}
                              disabled={stoppingId === integ.id}
                              title="Cancelar o backfill em andamento desta loja"
                            >
                              {stoppingId === integ.id ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <StopCircle className="h-3 w-3 mr-1" />
                              )}
                              Parar backfill
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTestConnection(integ)}
                            disabled={testingId === integ.id}
                          >
                            {testingId === integ.id ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Plug2 className="h-3 w-3 mr-1" />
                            )}
                            Testar conexão
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openLogs(integ)}>
                            <History className="h-3 w-3 mr-1" />
                            Logs
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setMappingFor(company)}>
                            <Users className="h-3 w-3 mr-1" />
                            Vendedores
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggleActive(integ)}>
                            <Power className="h-3 w-3 mr-1" />
                            {integ.is_active ? "Desativar" : "Ativar"}
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialog de edição */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.integration ? "Editar integração" : "Conectar loja"}: {editing?.company.name}
            </DialogTitle>
            <DialogDescription>
              CNPJ é usado para puxar Vendas. Código de Licença é usado para puxar Contas a Receber. Os dois são fornecidos pelo SSótica.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cnpj">CNPJ da loja <span className="text-destructive">*</span></Label>
              <Input
                id="cnpj"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                placeholder="00000000000000"
              />
              <p className="text-xs text-muted-foreground mt-1">
                CNPJ puro (14 dígitos). Usado no endpoint de <strong>Vendas</strong>.
              </p>
            </div>
            <div>
              <Label htmlFor="license_code">Código de Licença SSótica</Label>
              <Input
                id="license_code"
                value={form.license_code}
                onChange={(e) => setForm({ ...form, license_code: e.target.value })}
                placeholder="Ex: SXGP-CQM3"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Código alfanumérico fornecido pelo SSótica. Usado no endpoint de <strong>Contas a Receber</strong>. Se vazio, usa o CNPJ.
              </p>
            </div>
            <div>
              <Label htmlFor="token">
                Bearer Token {!editing?.integration && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="token"
                type="password"
                value={form.bearer_token}
                onChange={(e) => setForm({ ...form, bearer_token: e.target.value })}
                placeholder={editing?.integration ? "Deixe em branco para manter o atual" : "XXXyyyXXXyXXXXXXXXXXyXXXyXXXyXXX"}
                autoComplete="new-password"
              />
              {editing?.integration && (
                <p className="text-xs text-muted-foreground mt-1">
                  🔒 O token atual está criptografado no servidor e não pode ser exibido. Digite um novo token apenas se quiser substituir.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label htmlFor="active">Ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet de logs */}
      <Sheet open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Logs de sincronização</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 mt-4">
            {logs.length === 0 ? (
              <div className="text-muted-foreground text-sm">Nenhum log ainda.</div>
            ) : (
              logs.map((log) => (
                <Card key={log.id}>
                  <CardContent className="py-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {format(new Date(log.started_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </span>
                      <Badge
                        variant={
                          log.status === "success"
                            ? "default"
                            : log.status === "error"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {log.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Processados: {log.items_processed} · Criados: {log.items_created} · Atualizados:{" "}
                      {log.items_updated}
                    </div>
                    {log.error_message && (
                      <div className="text-xs text-destructive break-words">{log.error_message}</div>
                    )}
                    {log.details && (
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Dialog de resultado do teste de conexão */}
      <Dialog open={!!testResult} onOpenChange={(o) => !o && setTestResult(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {testResult?.ok ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  Conexão OK
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Falha na conexão
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {testResult?._company && <span className="font-medium">{testResult._company} · </span>}
              Receber: <code className="bg-muted px-1 rounded">{testResult?.empresa_param}</code>
              {testResult?.cnpj_vendas && (
                <> · Vendas: <code className="bg-muted px-1 rounded">{testResult.cnpj_vendas}</code></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {testResult?.error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
                {testResult.error}
              </div>
            )}
            {testResult?.results?.map((r: any, i: number) => (
              <Card key={i}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{r.endpoint}</span>
                    <Badge variant={r.ok ? "default" : "destructive"}>HTTP {r.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div>
                    <div className="font-medium text-muted-foreground mb-1">URL chamada:</div>
                    <code className="block bg-muted p-2 rounded break-all">{r.url}</code>
                  </div>
                  <div>
                    <div className="font-medium text-muted-foreground mb-1">Resposta do SSótica:</div>
                    <pre className="bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                      {r.response}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!testResult?.ok && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded space-y-1">
                <div className="font-medium text-foreground">Possíveis causas:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>O parâmetro <code>empresa</code> precisa ser o <strong>código de licença</strong> da loja, não o CNPJ — confirme no painel SSótica.</li>
                  <li>Token bearer pode estar vinculado a outra loja.</li>
                  <li>Token pode não ter permissão para o módulo Financeiro/Vendas.</li>
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestResult(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {mappingFor && (
        <UserMappingDialog
          open={!!mappingFor}
          onOpenChange={(o) => !o && setMappingFor(null)}
          companyId={mappingFor.id}
          companyName={mappingFor.name}
        />
      )}
    </AppLayout>
  );
}
