import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, KeyRound, Save, Trash2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Company { id: string; name: string; }

const EMPTY_CORA = { cora_client_id: "", cora_certificate: "", cora_private_key: "" };

export default function CrediarioCredenciaisPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [coraForm, setCoraForm] = useState({ ...EMPTY_CORA });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasRecord, setHasRecord] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("companies").select("id, name").order("name");
      setCompanies((data ?? []) as Company[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!companyId) {
      setCoraForm({ ...EMPTY_CORA });
      setHasRecord(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("crediario_company_credentials")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (data) {
        setCoraForm({
          cora_client_id: data.cora_client_id ?? "",
          cora_certificate: data.cora_certificate ?? "",
          cora_private_key: data.cora_private_key ?? "",
        });
        setHasRecord(true);
      } else {
        setCoraForm({ ...EMPTY_CORA });
        setHasRecord(false);
      }
    })();
  }, [companyId]);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    const payload = {
      company_id: companyId,
      cora_client_id: coraForm.cora_client_id.trim() || null,
      cora_certificate: coraForm.cora_certificate.trim() || null,
      cora_private_key: coraForm.cora_private_key.trim() || null,
    };
    const { error } = hasRecord
      ? await supabase.from("crediario_company_credentials").update(payload).eq("company_id", companyId)
      : await supabase.from("crediario_company_credentials").insert(payload);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar", { description: error.message }); return; }
    toast.success("Credenciais salvas");
    setHasRecord(true);
  };

  const remove = async () => {
    if (!hasRecord || !companyId) return;
    if (!confirm("Remover essas credenciais? O sistema voltará a usar os secrets padrão.")) return;
    setSaving(true);
    const { error } = await supabase.from("crediario_company_credentials").delete().eq("company_id", companyId);
    setSaving(false);
    if (error) { toast.error("Erro ao remover", { description: error.message }); return; }
    toast.success("Credenciais removidas");
    setCoraForm({ ...EMPTY_CORA });
    setHasRecord(false);
  };

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-7 w-7 text-primary" /> Credenciais
        </h1>
        <p className="text-muted-foreground">
          Cadastre as credenciais Cora de cada empresa — cada loja emite boletos pelo seu próprio gateway. As credenciais da ZapSign são lidas do ambiente do servidor.
        </p>
      </header>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label>Empresa (Cora)</Label>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger><SelectValue placeholder="Selecione uma empresa…" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {companyId && (
            <>
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input
                  value={coraForm.cora_client_id}
                  onChange={(e) => setCoraForm({ ...coraForm, cora_client_id: e.target.value })}
                  placeholder="int-..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Certificado (PEM)</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={coraForm.cora_certificate}
                  onChange={(e) => setCoraForm({ ...coraForm, cora_certificate: e.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Private Key (PEM)</Label>
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={coraForm.cora_private_key}
                  onChange={(e) => setCoraForm({ ...coraForm, cora_private_key: e.target.value })}
                  placeholder="-----BEGIN PRIVATE KEY-----..."
                />
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button variant="outline" onClick={remove} disabled={!hasRecord || saving} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Salvar</>}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground border-t pt-3">
                As credenciais salvas aqui têm prioridade sobre os secrets do servidor. Se algum campo ficar em branco, o sistema usa o secret correspondente como fallback.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
