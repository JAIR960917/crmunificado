import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, Webhook, RefreshCw } from "lucide-react";

interface Company {
  id: string;
  name: string;
}

/** Webhook da Cora (cadastro por empresa) e sincronização manual de pagamentos. */
export default function CrediarioWebhookSection() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [webhookResult, setWebhookResult] = useState<unknown>(null);
  const [rowLoading, setRowLoading] = useState<Record<string, "register" | "list" | null>>({});
  const [rowResult, setRowResult] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState<string | null>(null); // company_id ou "all"
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    supabase.from("companies").select("id, name").order("name").then(({ data }) => {
      setCompanies((data ?? []) as Company[]);
    });
  }, []);

  const PAGE_LIMIT = 1000;

  const sincronizarPagamentos = async (companyId?: string) => {
    const key = companyId || "all";
    setSyncLoading(key);
    setSyncResult(null);

    let totalVerificadas = 0;
    let totalAtualizadas = 0;
    let ok = true;
    let lastMsg = "";

    // A função só processa até PAGE_LIMIT parcelas por chamada — repete até
    // não sobrar mais nada pendente (evita parar em 200 quando o backlog é maior).
    for (let pagina = 1; pagina <= 50; pagina++) {
      setSyncResult({
        ok: true,
        message: `Sincronizando... ${totalVerificadas} parcela(s) verificada(s) até agora.`,
      });
      const { data, error } = await supabase.functions.invoke("cora-sincronizar-pagamentos", {
        body: { ...(companyId ? { company_id: companyId } : {}), limit: PAGE_LIMIT },
      });
      if (error) {
        lastMsg = (data as { error?: string } | null)?.error || error.message || "Erro ao sincronizar";
        ok = false;
        break;
      }
      const d = data as { ok?: boolean; total?: number; atualizadas?: number } | null;
      const total = d?.total ?? 0;
      totalVerificadas += total;
      totalAtualizadas += d?.atualizadas ?? 0;
      if (d?.ok === false) ok = false;
      if (total < PAGE_LIMIT) break; // menos que uma página cheia = não sobrou pendente
    }

    setSyncLoading(null);
    const msg = ok
      ? `Verificadas ${totalVerificadas} parcela(s), ${totalAtualizadas} marcada(s) como paga(s).`
      : lastMsg || `Verificadas ${totalVerificadas} parcela(s) antes de um erro.`;
    setSyncResult({ ok, message: msg });
    if (ok) toast.success(msg); else toast.error(msg);
  };

  const registrarWebhook = async () => {
    if (!selectedCompanyId) { toast.error("Selecione uma empresa"); return; }
    setLoadingWebhook(true);
    setWebhookResult(null);
    const { data, error } = await supabase.functions.invoke("cora-registrar-webhook", { body: { company_id: selectedCompanyId } });
    setLoadingWebhook(false);
    if (error) toast.error("Falha", { description: error.message });
    else toast.success("Resposta recebida");
    setWebhookResult(data ?? { error: error?.message });
  };

  const listarWebhooks = async () => {
    if (!selectedCompanyId) { toast.error("Selecione uma empresa"); return; }
    setLoadingWebhook(true);
    setWebhookResult(null);
    const { data, error } = await supabase.functions.invoke("cora-listar-webhooks", { body: { company_id: selectedCompanyId } });
    setLoadingWebhook(false);
    if (error) toast.error("Falha", { description: error.message });
    setWebhookResult(data ?? { error: error?.message });
  };

  const registrarWebhookEmpresa = async (companyId: string) => {
    setRowLoading((s) => ({ ...s, [companyId]: "register" }));
    setRowResult((s) => ({ ...s, [companyId]: null }));
    const { data, error } = await supabase.functions.invoke("cora-registrar-webhook", { body: { company_id: companyId } });
    setRowLoading((s) => ({ ...s, [companyId]: null }));
    const d = data as { ok?: boolean; error?: string; results?: Array<{ trigger: string; ok: boolean; status: number }> } | null;
    if (error || d?.error) {
      const msg = error?.message || d?.error || "Erro";
      setRowResult((s) => ({ ...s, [companyId]: { ok: false, message: msg } }));
      toast.error("Falha", { description: msg });
      return;
    }
    const okAll = d?.ok ?? false;
    const summary = d?.results?.map((r) => `${r.trigger}:${r.status}`).join(" · ") ?? "registrado";
    setRowResult((s) => ({ ...s, [companyId]: { ok: okAll, message: summary } }));
    if (okAll) toast.success("Webhook registrado"); else toast.warning("Registrado parcialmente", { description: summary });
  };

  const listarWebhooksEmpresa = async (companyId: string) => {
    setRowLoading((s) => ({ ...s, [companyId]: "list" }));
    const { data, error } = await supabase.functions.invoke("cora-listar-webhooks", { body: { company_id: companyId } });
    setRowLoading((s) => ({ ...s, [companyId]: null }));
    let d = data as { endpoints?: unknown[] | { data?: unknown[] }; data?: unknown[]; error?: string; status?: number } | null;
    if (error && !d) {
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") d = await ctx.json();
      } catch { /* ignore */ }
    }
    if ((error && !d?.error && !d?.endpoints) || d?.error) {
      const msg = d?.error || error?.message || "Erro";
      toast.error("Falha", { description: msg });
      setRowResult((s) => ({ ...s, [companyId]: { ok: false, message: msg } }));
      return;
    }
    const ep = d?.endpoints as unknown;
    const arr = (Array.isArray(ep) ? ep : (ep as { data?: unknown[] })?.data) ?? d?.data ?? [];
    const list = Array.isArray(arr) ? arr : [];
    setRowResult((s) => ({ ...s, [companyId]: { ok: list.length > 0, message: `${list.length} endpoint(s) ativo(s)` } }));
    setWebhookResult(data);
  };

  const registrarTodas = async () => {
    setBulkLoading(true);
    for (const c of companies) {
      // sequencial para não estourar mTLS concorrente
      // eslint-disable-next-line no-await-in-loop
      await registrarWebhookEmpresa(c.id);
    }
    setBulkLoading(false);
    toast.success("Processamento concluído");
  };

  return (
    <div>
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Webhook className="h-5 w-5 text-primary" /> Crediário — Webhook da Cora
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        A Cora <strong>não tem painel</strong> para configurar webhooks — o cadastro é feito 100% via API.
        Cada empresa precisa do webhook registrado na sua própria conta Cora.
      </p>

      <Card className="mt-4">
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O webhook é registrado na conta Cora desta empresa. Repita para cada empresa cadastrada.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={registrarWebhook} disabled={loadingWebhook || !selectedCompanyId}>
              {loadingWebhook
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processando...</>
                : <><Webhook className="mr-2 h-4 w-4" />Registrar webhook na Cora</>}
            </Button>
            <Button onClick={listarWebhooks} disabled={loadingWebhook || !selectedCompanyId} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" /> Listar webhooks ativos
            </Button>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-semibold text-sm">Registro por empresa</h3>
                <p className="text-xs text-muted-foreground">
                  Cada empresa precisa do webhook registrado na sua própria conta Cora.
                </p>
              </div>
              <Button onClick={registrarTodas} disabled={bulkLoading || companies.length === 0} variant="default">
                {bulkLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando todas...</>
                  : <><Webhook className="mr-2 h-4 w-4" />Registrar em todas ({companies.length})</>}
              </Button>
            </div>

            <div className="rounded-lg border divide-y">
              {companies.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
              )}
              {companies.map((c) => {
                const busy = rowLoading[c.id];
                const res = rowResult[c.id];
                return (
                  <div key={c.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{c.name}</div>
                      {res && (
                        <div className={`text-xs mt-1 flex items-center gap-1 ${res.ok ? "text-success" : "text-destructive"}`}>
                          {res.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          <span className="break-all">{res.message}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => registrarWebhookEmpresa(c.id)}
                        disabled={!!busy || bulkLoading}
                      >
                        {busy === "register"
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <><Webhook className="h-3.5 w-3.5 mr-1" />Registrar</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => listarWebhooksEmpresa(c.id)}
                        disabled={!!busy || bulkLoading}
                      >
                        {busy === "list"
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <><RefreshCw className="h-3.5 w-3.5 mr-1" />Verificar</>}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="font-semibold text-sm">Sincronizar pagamentos</h3>
                <p className="text-xs text-muted-foreground">
                  Consulta na Cora o status dos boletos pendentes e atualiza as parcelas que já foram pagas.
                  Sincronização automática todos os dias às 06:00 e 13:00 (horário de Brasília).
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => sincronizarPagamentos(selectedCompanyId || undefined)}
                  disabled={syncLoading !== null || !selectedCompanyId}
                  variant="outline"
                >
                  {syncLoading === (selectedCompanyId || "x")
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sincronizando...</>
                    : <><RefreshCw className="mr-2 h-4 w-4" />Sincronizar empresa selecionada</>}
                </Button>
                <Button
                  onClick={() => sincronizarPagamentos()}
                  disabled={syncLoading !== null}
                >
                  {syncLoading === "all"
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sincronizando todas...</>
                    : <><RefreshCw className="mr-2 h-4 w-4" />Sincronizar todas</>}
                </Button>
              </div>
            </div>
            {syncResult && (
              <div className={`text-xs flex items-center gap-1 ${syncResult.ok ? "text-success" : "text-destructive"}`}>
                {syncResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                <span>{syncResult.message}</span>
              </div>
            )}
          </div>

          {webhookResult !== null && (
            <pre className="rounded-lg border bg-muted/30 p-4 text-xs overflow-auto max-h-96">
{JSON.stringify(webhookResult, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
