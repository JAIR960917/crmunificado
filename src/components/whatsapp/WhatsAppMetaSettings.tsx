import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

type MetaStatus = {
  provider: string;
  meta_app_id: string;
  webhook_url: string;
  env: {
    access_token: boolean;
    verify_token: boolean;
    app_secret: boolean;
    waba_id: boolean;
  };
  meta_instances: {
    id: string;
    name: string;
    phone_number_id: string | null;
    display_phone: string | null;
    meta_default_template?: string | null;
    meta_template_language?: string | null;
    is_active: boolean;
  }[];
  privacy_url?: string;
  terms_url?: string;
  data_deletion_url?: string;
};

type TemplateRow = { name: string; status: string; category: string; language: string };

type MetaInstanceEditState = {
  meta_default_template: string;
  meta_template_language: string;
  saving: boolean;
};

/** Extrai mensagem legível quando a edge function responde 4xx/5xx. */
async function parseEdgeFunctionError(
  data: unknown,
  error: { message?: string; context?: { json?: () => Promise<unknown> } } | null,
): Promise<string> {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return fromData;
  if (error?.context?.json) {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* ignore */
    }
  }
  if (error?.message?.includes("non-2xx")) {
    return "Falha na API Meta ou credenciais no servidor. Verifique WHATSAPP_ACCESS_TOKEN (token completo) e WHATSAPP_WABA_ID no .env da VPS.";
  }
  return error?.message || "Erro desconhecido";
}

export default function WhatsAppMetaSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [webhookChecking, setWebhookChecking] = useState(false);
  const [webhookSubscribing, setWebhookSubscribing] = useState(false);
  const [webhookDiag, setWebhookDiag] = useState<{
    app_subscribed_to_waba?: boolean;
    hints?: string[];
    phone_numbers?: { instance_name?: string; status?: string; display_phone_number?: string; error?: string }[];
  } | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [provider, setProvider] = useState<"apifull" | "meta">("apifull");
  const [metaAppId, setMetaAppId] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [instanceEdits, setInstanceEdits] = useState<Record<string, MetaInstanceEditState>>({});

  const [instName, setInstName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [defaultTemplate, setDefaultTemplate] = useState("");
  const [creatingInst, setCreatingInst] = useState(false);

  const invokeMeta = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("meta-whatsapp", { body });
    if (error) throw new Error(await parseEdgeFunctionError(data, error));
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invokeMeta({ action: "get-status" });
      const nextStatus = data as MetaStatus;
      setStatus(nextStatus);
      setProvider((data.provider === "meta" ? "meta" : "apifull") as "apifull" | "meta");
      setMetaAppId(data.meta_app_id || "");

      const edits: Record<string, MetaInstanceEditState> = {};
      (nextStatus.meta_instances || []).forEach((i) => {
        if (!i?.id) return;
        edits[i.id] = {
          meta_default_template: i.meta_default_template || "",
          meta_template_language: i.meta_template_language || "pt_BR",
          saving: false,
        };
      });
      setInstanceEdits(edits);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar status Meta");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invokeMeta({ action: "save-settings", provider, meta_app_id: metaAppId });
      toast.success("Configurações salvas");
      await loadStatus();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const data = await invokeMeta({ action: "test-connection" });
      toast.success(`Conexão OK — WABA: ${data.waba?.name || data.waba?.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setTesting(false);
    }
  };

  const handleListTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await invokeMeta({ action: "list-templates" });
      setTemplates(data.templates || []);
      toast.success(`${(data.templates || []).length} template(s) encontrado(s)`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao listar templates");
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleCheckWebhook = async () => {
    setWebhookChecking(true);
    try {
      const data = await invokeMeta({ action: "check-webhook-setup" });
      setWebhookDiag(data);
      if (data.app_subscribed_to_waba) {
        toast.success("WABA inscrita no app — webhooks de mensagens reais devem funcionar");
      } else {
        toast.warning("WABA NÃO inscrita no app — mensagens do celular não chegam no CRM");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao verificar webhook");
    } finally {
      setWebhookChecking(false);
    }
  };

  const handleSubscribeWaba = async () => {
    setWebhookSubscribing(true);
    try {
      await invokeMeta({ action: "subscribe-waba" });
      toast.success("WABA inscrita. Envie «Teste» do celular pessoal e confira o Inbox.");
      const data = await invokeMeta({ action: "check-webhook-setup" });
      setWebhookDiag(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao inscrever WABA");
    } finally {
      setWebhookSubscribing(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!instName.trim() || !phoneNumberId.trim()) {
      toast.error("Preencha nome e Phone Number ID");
      return;
    }
    setCreatingInst(true);
    try {
      await invokeMeta({
        action: "create-meta-instance",
        name: instName.trim(),
        phone_number_id: phoneNumberId.trim(),
        display_phone: displayPhone.trim() || undefined,
        meta_default_template: defaultTemplate.trim() || undefined,
      });
      toast.success("Número oficial cadastrado");
      setInstName("");
      setPhoneNumberId("");
      setDisplayPhone("");
      setDefaultTemplate("");
      await loadStatus();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao cadastrar número");
    } finally {
      setCreatingInst(false);
    }
  };

  const handleUpdateInstance = async (id: string) => {
    const current = instanceEdits[id];
    if (!current) return;
    setInstanceEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], saving: true },
    }));
    try {
      await invokeMeta({
        action: "update-meta-instance",
        id,
        meta_default_template: current.meta_default_template.trim() || null,
        meta_template_language: current.meta_template_language.trim() || "pt_BR",
      });
      toast.success("Instância atualizada");
      await loadStatus();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar instância");
    } finally {
      setInstanceEdits((prev) => ({
        ...prev,
        [id]: { ...prev[id], saving: false },
      }));
    }
  };

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Copiado");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Carregando configuração Meta…
      </div>
    );
  }

  const envOk = status?.env.access_token && status?.env.verify_token && status?.env.waba_id;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-semibold">API oficial WhatsApp (Meta Cloud API)</p>
            <p className="text-muted-foreground">
              Use este modo após aprovação na Meta para reduzir risco de banimento. Enquanto a revisão não
              concluir, mantenha o provedor em <strong>API Full</strong>. O guia completo está em{" "}
              <code className="text-xs">docs/META_APP_REVIEW.md</code> no repositório.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h3 className="font-semibold text-sm">Provedor ativo</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Modo de envio</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as "apifull" | "meta")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apifull">API Full (atual — QR Code)</SelectItem>
                <SelectItem value="meta">Meta Cloud API (oficial)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Só altere para Meta depois de configurar webhook, tokens e templates aprovados.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">App ID (Meta for Developers)</Label>
            <Input value={metaAppId} onChange={(e) => setMetaAppId(e.target.value)} placeholder="1234567890" />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Salvar provedor
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          Variáveis no servidor (.env)
          {envOk ? (
            <Badge className="bg-emerald-600">OK</Badge>
          ) : (
            <Badge variant="destructive">Pendente</Badge>
          )}
        </h3>
        <ul className="text-xs space-y-1 font-mono">
          <li className="flex items-center gap-2">
            {status?.env.access_token ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
            WHATSAPP_ACCESS_TOKEN
          </li>
          <li className="flex items-center gap-2">
            {status?.env.verify_token ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
            WHATSAPP_VERIFY_TOKEN
          </li>
          <li className="flex items-center gap-2">
            {status?.env.app_secret ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
            WHATSAPP_APP_SECRET
          </li>
          <li className="flex items-center gap-2">
            {status?.env.waba_id ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
            WHATSAPP_WABA_ID
          </li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Testar conexão WABA"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCheckWebhook} disabled={webhookChecking}>
            {webhookChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Diagnosticar webhook"}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubscribeWaba} disabled={webhookSubscribing}>
            {webhookSubscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Inscrever WABA no webhook"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleListTemplates} disabled={templatesLoading}>
            {templatesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Listar templates aprovados"}
          </Button>
        </div>
        {webhookDiag && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
            <p className="font-medium flex items-center gap-1">
              {webhookDiag.app_subscribed_to_waba ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              )}
              WABA inscrita no app: {webhookDiag.app_subscribed_to_waba ? "sim" : "não"}
            </p>
            {(webhookDiag.phone_numbers || []).map((p) => (
              <p key={p.instance_name} className="text-muted-foreground">
                {p.instance_name}: {p.display_phone_number || "—"} — status{" "}
                <span className="font-mono">{p.status || p.error || "?"}</span>
                {p.status && p.status !== "CONNECTED" ? " (precisa estar CONNECTED)" : ""}
              </p>
            ))}
            {(webhookDiag.hints || []).map((h) => (
              <p key={h} className="text-amber-800 dark:text-amber-200">
                {h}
              </p>
            ))}
          </div>
        )}
      </div>

      {status?.webhook_url && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <Label className="text-xs font-semibold">URL do Webhook (cole no Meta for Developers)</Label>
          <div className="flex gap-2">
            <Input readOnly value={status.webhook_url} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => copyText(status.webhook_url)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Assinale: <strong>messages</strong> (entrada do cliente). Verify token = WHATSAPP_VERIFY_TOKEN no .env.
            O botão «Teste» da Meta só valida a URL — use «Diagnosticar webhook» e «Inscrever WABA» para mensagens reais.
          </p>
          <p className="text-[10px] text-muted-foreground">
            App em <strong>modo desenvolvimento</strong>: adicione seus números pessoais em WhatsApp → API Setup →
            «Adicionar número de telefone» (destinatários de teste).
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4 space-y-2">
        <h3 className="font-semibold text-sm">URLs para revisão do app Meta</h3>
        <ul className="text-sm space-y-2">
          {[
            { label: "Política de Privacidade", url: status?.privacy_url },
            { label: "Termos de Uso", url: status?.terms_url },
            { label: "Exclusão de dados", url: status?.data_deletion_url },
          ].map((item) =>
            item.url ? (
              <li key={item.label} className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground w-40">{item.label}:</span>
                <a href={item.url} target="_blank" rel="noreferrer" className="text-primary underline text-xs break-all">
                  {item.url}
                </a>
                <ExternalLink className="h-3 w-3" />
              </li>
            ) : null,
          )}
        </ul>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Cadastrar número oficial (Cloud API)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome interno</Label>
            <Input value={instName} onChange={(e) => setInstName(e.target.value)} placeholder="WhatsApp Cobrança" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone Number ID *</Label>
            <Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="Do painel Meta" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Telefone exibido</Label>
            <Input value={displayPhone} onChange={(e) => setDisplayPhone(e.target.value)} placeholder="+55 11 …" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Template padrão (fora da janela 24h)</Label>
            <Input value={defaultTemplate} onChange={(e) => setDefaultTemplate(e.target.value)} placeholder="lembrete_cobranca" />
          </div>
        </div>
        <Button onClick={handleCreateInstance} disabled={creatingInst}>
          {creatingInst ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
          Adicionar número Meta
        </Button>
        {(status?.meta_instances?.length ?? 0) > 0 && (
          <div className="pt-2 space-y-1">
            <p className="text-xs font-medium">Números cadastrados:</p>
            {status!.meta_instances.map((i) => (
              <div key={i.id} className="rounded-md border p-3 space-y-2">
                <div className="text-xs flex gap-2 items-center flex-wrap">
                  <Badge variant="outline">Meta</Badge>
                  <span className="font-medium">{i.name}</span>
                  <span className="text-muted-foreground font-mono">{i.phone_number_id || "—"}</span>
                  {!i.is_active ? <Badge variant="secondary">Inativa</Badge> : null}
                </div>

                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px] text-muted-foreground">Template padrão (fora da janela 24h)</Label>
                    <Input
                      value={instanceEdits[i.id]?.meta_default_template ?? ""}
                      onChange={(e) =>
                        setInstanceEdits((prev) => ({
                          ...prev,
                          [i.id]: {
                            meta_default_template: e.target.value,
                            meta_template_language: prev[i.id]?.meta_template_language || "pt_BR",
                            saving: prev[i.id]?.saving || false,
                          },
                        }))
                      }
                      placeholder="lembrete_cobranca"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Idioma padrão</Label>
                    <Input
                      value={instanceEdits[i.id]?.meta_template_language ?? "pt_BR"}
                      onChange={(e) =>
                        setInstanceEdits((prev) => ({
                          ...prev,
                          [i.id]: {
                            meta_default_template: prev[i.id]?.meta_default_template || "",
                            meta_template_language: e.target.value,
                            saving: prev[i.id]?.saving || false,
                          },
                        }))
                      }
                      placeholder="pt_BR"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpdateInstance(i.id)}
                    disabled={instanceEdits[i.id]?.saving}
                  >
                    {instanceEdits[i.id]?.saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Salvar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold text-sm mb-2">Templates na conta WABA</h3>
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {templates.map((t) => (
              <div key={`${t.name}-${t.language}`} className="flex gap-2 border-b py-1">
                <span className="font-mono">{t.name}</span>
                <Badge variant="secondary">{t.status}</Badge>
                <span className="text-muted-foreground">{t.category} · {t.language}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Use o mesmo nome em campanhas/gatilhos (campo template Meta) quando estiver fora da janela de 24h.
          </p>
        </div>
      )}
    </div>
  );
}
