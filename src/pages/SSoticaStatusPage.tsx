import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import {
  Loader2,
  RefreshCw,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface IntegrationStatus {
  id: string;
  company_id: string;
  company_name: string;
  is_active: boolean;
  sync_status: string;
  backfill_status: string | null;
  backfill_chunk_index: number | null;
  backfill_total_chunks: number | null;
  last_sync_vendas_at: string | null;
  last_sync_receber_at: string | null;
  updated_at: string;
  last_error: string | null;
}

// Considera "travado" se sync_status = 'running' há mais de STUCK_MINUTES minutos
const STUCK_MINUTES = 30;

type Health = "ok" | "warning" | "stuck" | "error" | "inactive" | "never";

function getBackfillVisualProgress(item: Pick<IntegrationStatus, "backfill_status" | "backfill_chunk_index" | "backfill_total_chunks">) {
  const total = item.backfill_total_chunks ?? 32;
  const completed = item.backfill_chunk_index ?? 0;
  const status = item.backfill_status ?? "idle";
  const isActive = status === "running" || status === "scheduled";
  const currentChunk = isActive && completed < total ? completed + 1 : completed;

  return {
    total,
    completed,
    currentChunk,
    percent: total > 0 ? Math.round((currentChunk / total) * 100) : 0,
  };
}

function getHealth(i: IntegrationStatus): { health: Health; label: string } {
  if (!i.is_active) return { health: "inactive", label: "Inativa" };

  const last = i.last_sync_vendas_at
    ? new Date(i.last_sync_vendas_at).getTime()
    : 0;
  const updatedMs = new Date(i.updated_at).getTime();
  const ageMin = (Date.now() - updatedMs) / 60000;

  const backfillActive =
    i.backfill_status === "running" || i.backfill_status === "scheduled";

  if (i.sync_status === "running" && ageMin > STUCK_MINUTES) {
    return { health: "stuck", label: `Travada (${Math.round(ageMin)}min)` };
  }
  if (i.sync_status === "running" || backfillActive) {
    return { health: "warning", label: "Sincronizando" };
  }
  if (i.sync_status === "error" || (i.last_error && i.last_error.length > 0)) {
    return { health: "error", label: "Com erro" };
  }
  if (!last) return { health: "never", label: "Nunca sincronizou" };

  const sinceLastH = (Date.now() - last) / 3600000;
  if (sinceLastH > 24) {
    return { health: "warning", label: `Atrasada (${Math.round(sinceLastH)}h)` };
  }
  return { health: "ok", label: "OK" };
}

function HealthBadge({ health, label }: { health: Health; label: string }) {
  const map: Record<Health, { variant: any; icon: any; className: string }> = {
    ok: {
      variant: "default",
      icon: CheckCircle2,
      className: "bg-emerald-600 hover:bg-emerald-600",
    },
    warning: {
      variant: "default",
      icon: Clock,
      className: "bg-amber-500 hover:bg-amber-500",
    },
    stuck: {
      variant: "destructive",
      icon: AlertTriangle,
      className: "",
    },
    error: {
      variant: "destructive",
      icon: AlertTriangle,
      className: "",
    },
    inactive: {
      variant: "secondary",
      icon: Clock,
      className: "",
    },
    never: {
      variant: "outline",
      icon: Clock,
      className: "",
    },
  };
  const { variant, icon: Icon, className } = map[health];
  return (
    <Badge variant={variant} className={`gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default function SSoticaStatusPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ssotica_integrations")
      .select(
        "id, company_id, is_active, sync_status, backfill_status, backfill_chunk_index, backfill_total_chunks, last_sync_vendas_at, last_sync_receber_at, updated_at, last_error, companies:company_id(name)"
      )
      .order("updated_at", { ascending: false });
    if (error) {
      toast({
        title: "Erro ao carregar status",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    const mapped: IntegrationStatus[] = (data || []).map((row: any) => ({
      id: row.id,
      company_id: row.company_id,
      company_name: row.companies?.name?.trim() || "(sem nome)",
      is_active: row.is_active,
      sync_status: row.sync_status,
      backfill_status: row.backfill_status,
      backfill_chunk_index: row.backfill_chunk_index,
      backfill_total_chunks: row.backfill_total_chunks,
      last_sync_vendas_at: row.last_sync_vendas_at,
      last_sync_receber_at: row.last_sync_receber_at,
      updated_at: row.updated_at,
      last_error: row.last_error,
    }));
    mapped.sort((a, b) => a.company_name.localeCompare(b.company_name));
    setItems(mapped);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  async function unlock(id: string) {
    setActionId(id);
    const { data, error } = await supabase.functions.invoke("ssotica-sync", {
      body: {
        mode: "force_unlock",
        integration_id: id,
      },
    });
    setActionId(null);
    if (error) {
      toast({
        title: "Erro ao destravar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Loja destravada",
      description: String(data?.message ?? "Execução encerrada e fila liberada para continuar."),
    });
    load();
  }

  async function resync(id: string) {
    setActionId(id);
    const current = items.find((item) => item.id === id);
    const hasPendingBackfill =
      !!current &&
      current.backfill_status !== "done" &&
      ((current.backfill_total_chunks ?? 0) === 0 || (current.backfill_chunk_index ?? 0) < (current.backfill_total_chunks ?? 32));

    const { data, error } = await supabase.functions.invoke("ssotica-sync", {
      body: {
        mode: hasPendingBackfill ? "resume_backfill" : "incremental",
        integration_id: id,
        // Sempre força o sweep de quitação por ausência no clique manual,
        // mesmo com backfill em andamento — caso contrário cards antigos
        // já pagos (cuja parcela a SSótica removeu da resposta) ficam presos
        // até o backfill terminar (pode levar dias em lojas grandes).
        manual_recent: true,
      },
    });
    setActionId(null);
    if (error) {
      const isAlreadyRunning =
        error.message?.includes("non-2xx") &&
        (String(data?.error ?? "").includes("already_running") || String(error.message).toLowerCase().includes("already running"));

      if (isAlreadyRunning) {
        toast({
          title: "Sincronização já em andamento",
          description: "Aguarde a conclusão do processamento atual antes de tentar novamente.",
        });
        load();
        return;
      }

      toast({
        title: "Erro ao sincronizar",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    if (hasPendingBackfill && data && typeof data === "object" && "already_running" in data && (data as any).already_running) {
      toast({
        title: "Chunk já em execução",
        description: String((data as any).message ?? "Aguarde o processamento atual terminar antes de clicar novamente."),
      });
      load();
      return;
    }

    toast({
      title: hasPendingBackfill ? "Backfill retomado" : "Sincronização disparada",
      description: hasPendingBackfill
        ? "A importação histórica continuará do chunk atual sem voltar para 0/16."
        : undefined,
    });
    load();
  }

  async function unlockAllStuck() {
    const stuckItems = items.filter((i) => getHealth(i).health === "stuck");
    const stuckIds = stuckItems.map((i) => i.id);
    if (stuckIds.length === 0) {
      toast({ title: "Nenhuma loja travada" });
      return;
    }
    setBulkLoading(true);
    const results = await Promise.all(
      stuckItems.map((item) =>
        supabase.functions.invoke("ssotica-sync", {
          body: {
            mode: "force_unlock",
            integration_id: item.id,
          },
        })
      )
    );
    setBulkLoading(false);
    const error = results.find((result) => result.error)?.error;
    if (error) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: `${stuckIds.length} loja(s) destravadas`,
    });
    load();
  }

  const stats = useMemo(() => {
    const out = { ok: 0, warning: 0, stuck: 0, error: 0, inactive: 0, never: 0 };
    items.forEach((i) => {
      out[getHealth(i).health]++;
    });
    return out;
  }, [items]);

  if (authLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" />
              Status das Integrações SSÓtica
            </h1>
            <p className="text-muted-foreground text-sm">
              Monitore lojas travadas e gerencie sincronizações.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              Atualizar
            </Button>
            <Button
              variant="destructive"
              onClick={unlockAllStuck}
              disabled={bulkLoading || stats.stuck === 0}
            >
              {bulkLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Unlock className="h-4 w-4 mr-2" />
              )}
              Destravar todas ({stats.stuck})
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <StatCard label="OK" value={stats.ok} className="text-emerald-600" />
          <StatCard label="Sincronizando/Atrasada" value={stats.warning} className="text-amber-600" />
          <StatCard label="Travadas" value={stats.stuck} className="text-destructive" />
          <StatCard label="Com erro" value={stats.error} className="text-destructive" />
          <StatCard label="Nunca sync" value={stats.never} className="text-muted-foreground" />
          <StatCard label="Inativas" value={stats.inactive} className="text-muted-foreground" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Lojas ({items.length})</CardTitle>
            <CardDescription>
              Considera-se "travada" quando o status é <code>running</code> há mais de {STUCK_MINUTES} minutos.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sync atual</TableHead>
                  <TableHead>Última venda sync</TableHead>
                  <TableHead>Última atualização</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin inline" />
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhuma integração cadastrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((i) => {
                    const { health, label } = getHealth(i);
                    return (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">
                          {i.company_name}
                        </TableCell>
                        <TableCell>
                          <HealthBadge health={health} label={label} />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const bfActive =
                              i.backfill_status === "running" ||
                              i.backfill_status === "scheduled";
                            const progress = getBackfillVisualProgress(i);
                            if (bfActive) {
                              return (
                                <div className="space-y-1 min-w-[140px]">
                                  <div className="flex items-center justify-between text-xs">
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                                      backfill lote {progress.currentChunk}/{progress.total}
                                    </Badge>
                                    <span className="text-muted-foreground">{progress.percent}%</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress.percent}%` }} />
                                  </div>
                                </div>
                              );
                            }
                            return <Badge variant="outline">{i.sync_status}</Badge>;
                          })()}
                        </TableCell>
                        <TableCell>
                          {i.last_sync_vendas_at
                            ? formatDistanceToNow(new Date(i.last_sync_vendas_at), {
                                addSuffix: true,
                                locale: ptBR,
                              })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {format(new Date(i.updated_at), "dd/MM HH:mm", {
                            locale: ptBR,
                          })}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {i.last_error ? (
                            <span
                              className="text-destructive text-xs truncate block"
                              title={i.last_error}
                            >
                              {i.last_error}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            {(health === "stuck" ||
                              health === "error" ||
                              i.sync_status === "running") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => unlock(i.id)}
                                disabled={actionId === i.id}
                              >
                                {actionId === i.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Unlock className="h-3 w-3 mr-1" />
                                )}
                                Destravar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => resync(i.id)}
                              disabled={actionId === i.id || !i.is_active}
                            >
                              {actionId === i.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3 mr-1" />
                              )}
                              Sync
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${className || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
