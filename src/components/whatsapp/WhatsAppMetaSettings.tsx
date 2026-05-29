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
    is_active: boolean;
  }[];
  privacy_url?: string;
  terms_url?: string;
  data_deletion_url?: string;
};

type TemplateRow = { name: string; status: string; category: string; language: string };

export default function WhatsAppMetaSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [provider, setProvider] = useState<"apifull" | "meta">("apifull");
  const [metaAppId, setMetaAppId] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const [instName, setInstName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [defaultTemplate, setDefaultTemplate] = useState("");
  const [creatingInst, setCreatingInst] = useState(false);

  const invokeMeta = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("meta-whatsapp", { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invokeMeta({ action: "get-status" });
      setStatus(data as MetaStatus);
      setProvider((data.provider === "meta" ? "meta" : "apifull") as "apifull" | "meta");
      setMetaAppId(data.meta_app_id || "");
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
          <Button variant="outline" size="sm" onClick={handleListTemplates} disabled={templatesLoading}>
            {templatesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Listar templates aprovados"}
          </Button>
        </div>
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
            Assinale: messages. Verify token = mesmo valor de WHATSAPP_VERIFY_TOKEN no .env.
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
              <div key={i.id} className="text-xs flex gap-2 items-center">
                <Badge variant="outline">Meta</Badge>
                <span>{i.name}</span>
                <span className="text-muted-foreground font-mono">{i.phone_number_id}</span>
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
