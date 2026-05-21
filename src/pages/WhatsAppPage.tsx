import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  MessageSquare, Plus, Trash2, Edit2, Send, Users, Calendar, Hash,
  QrCode, RefreshCw, Wifi, WifiOff, Loader2, Smartphone, Settings2, Zap
} from "lucide-react";
import TriggerCampaigns from "@/components/whatsapp/TriggerCampaigns";
import ImageUploadField from "@/components/whatsapp/ImageUploadField";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type ModuleKey = "leads" | "cobrancas" | "renovacoes";

const MODULE_LABELS: Record<ModuleKey, string> = {
  leads: "Leads",
  cobrancas: "Cobranças",
  renovacoes: "Renovações",
};

type Campaign = {
  id: string;
  name: string;
  message: string;
  image_url: string | null;
  module: ModuleKey;
  status_id: string;
  instance_id: string | null;
  company_id: string | null;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

type Status = {
  id: string;
  key: string;
  label: string;
  color: string;
};

type SendStats = {
  campaign_id: string;
  total: number;
  sent: number;
  pending: number;
  error: number;
};

type Instance = {
  id: string;
  name: string;
  session: string;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
};

export default function WhatsAppPage() {
  const { user, isAdmin, isGerente } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusesByModule, setStatusesByModule] = useState<Record<ModuleKey, Status[]>>({
    leads: [], cobrancas: [], renovacoes: [],
  });
  const [sendStats, setSendStats] = useState<Record<string, SendStats>>({});
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [moduleKey, setModuleKey] = useState<ModuleKey>("leads");
  const [statusId, setStatusId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");

  // Instance management state
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstanceSession, setNewInstanceSession] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, string>>({});
  const [instanceLoading, setInstanceLoading] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[] | null>(null);
  const [newInstanceCompanyId, setNewInstanceCompanyId] = useState("");
  const autoSyncTriedRef = useRef(false);

  const canManage = isAdmin;

  const fetchData = async () => {
    setLoading(true);
    const [campaignsRes, leadStatusRes, cobStatusRes, renStatusRes, sendsRes, instancesRes, companiesRes] = await Promise.all([
      supabase.from("whatsapp_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_statuses").select("*").order("position"),
      supabase.from("crm_cobranca_statuses").select("*").order("position"),
      supabase.from("crm_renovacao_statuses").select("*").order("position"),
      supabase.from("whatsapp_campaign_sends").select("campaign_id, status"),
      supabase.from("whatsapp_instances").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id, name").order("name"),
    ]);

    setCampaigns((campaignsRes.data || []) as Campaign[]);
    setStatusesByModule({
      leads: (leadStatusRes.data || []) as Status[],
      cobrancas: (cobStatusRes.data || []) as Status[],
      renovacoes: (renStatusRes.data || []) as Status[],
    });
    setInstances((instancesRes.data || []) as Instance[]);
    const allCompanies = (companiesRes.data || []) as { id: string; name: string }[];

    if (isGerente && !isAdmin && user?.id) {
      const [{ data: myProfile }, { data: mgrCompanies }] = await Promise.all([
        supabase.from("profiles").select("company_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("manager_companies").select("company_id").eq("user_id", user.id),
      ]);
      const ids = new Set<string>();
      if (myProfile?.company_id) ids.add(myProfile.company_id);
      (mgrCompanies || []).forEach((m: any) => m?.company_id && ids.add(m.company_id));
      const allowed = Array.from(ids);
      setAllowedCompanyIds(allowed);
      setCompanies(allCompanies.filter((c) => allowed.includes(c.id)));
    } else {
      setAllowedCompanyIds(null);
      setCompanies(allCompanies);
    }

    const stats: Record<string, SendStats> = {};
    for (const send of (sendsRes.data || []) as { campaign_id: string; status: string }[]) {
      if (!stats[send.campaign_id]) {
        stats[send.campaign_id] = { campaign_id: send.campaign_id, total: 0, sent: 0, pending: 0, error: 0 };
      }
      stats[send.campaign_id].total++;
      if (send.status === "sent") stats[send.campaign_id].sent++;
      else if (send.status === "pending") stats[send.campaign_id].pending++;
      else if (send.status === "error") stats[send.campaign_id].error++;
    }
    setSendStats(stats);
    setLoading(false);
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [user?.id, isAdmin, isGerente]);

  const callApiFull = async (action: string, session: string, extraBody: Record<string, any> = {}) => {
    const tag = `[apifull:${action}${session ? `:${session}` : ""}]`;
    console.groupCollapsed(`${tag} request`);
    console.log("payload:", { action, session, ...extraBody });
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("apifull-whatsapp", {
        body: { action, session, ...extraBody },
      });
      const ms = Math.round(performance.now() - t0);
      console.log(`response (${ms}ms):`, { data, error });
      if (error) {
        console.error(`${tag} edge function error:`, error);
        throw new Error(error.message);
      }
      if (data?.error) {
        console.error(`${tag} API Full retornou erro:`, data);
        throw new Error(data.error);
      }
      console.log(`${tag} ok`);
      return data;
    } catch (e: any) {
      const ms = Math.round(performance.now() - t0);
      console.error(`${tag} falhou após ${ms}ms:`, e?.message || e);
      throw e;
    } finally {
      console.groupEnd();
    }
  };

  const handleCreateInstance = async () => {
    const instName = newInstanceName.trim();
    const instSession = newInstanceSession.trim() || instName.toLowerCase().replace(/\s+/g, "-");
    if (!instName) {
      toast.error("Digite um nome para a instância");
      return;
    }
    setInstanceLoading(true);
    try {
      const result = await callApiFull("create-instance", instSession, { name: instSession });
      toast.success("Instância criada na API Full!");

      const { error } = await supabase.from("whatsapp_instances").insert({
        name: instName,
        session: instSession,
        company_id: newInstanceCompanyId || null,
      });
      if (error) throw error;

      setNewInstanceName("");
      setNewInstanceSession("");
      setNewInstanceCompanyId("");
      fetchData();

      toast.info("Gerando QR Code...");
      try {
        const qrResult = await callApiFull("qrcode", instSession);
        const qr = qrResult?.dados || qrResult?.qrcode || qrResult?.qr || qrResult?.data?.qrcode || qrResult?.data?.qr;
        if (qr) {
          setQrCode(qr);
          toast.success("QR Code gerado! Escaneie com o WhatsApp.");
        } else {
          toast.info("QR Code não disponível ainda. Clique em 'Gerar QR Code'.");
        }
      } catch {
        toast.info("Instância criada! Clique em 'Gerar QR Code' para conectar.");
      }

      console.log("Create instance result:", result);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar instância");
    }
    setInstanceLoading(false);
  };

  const handleGetQRCode = async (inst: Instance) => {
    setInstanceLoading(true);
    setQrCode(null);
    setSelectedInstanceId(inst.id);
    try {
      const result = await callApiFull("qrcode", inst.session);
      const qr = result.dados || result.qrcode || result.qr || result.data?.qrcode || result.data?.qr;
      if (qr) {
        setQrCode(qr);
        toast.success("QR Code gerado! Escaneie com o WhatsApp.");
      } else {
        toast.info("Sessão já conectada ou QR Code não disponível");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar QR Code");
    }
    setInstanceLoading(false);
  };

  const handleCheckStatus = async (inst: Instance) => {
    try {
      const result = await callApiFull("status", inst.session);
      const status = result.status || result.state || result.data?.status || result.data?.state || "desconhecido";
      setConnectionStatus(prev => ({ ...prev, [inst.id]: status }));
    } catch {
      setConnectionStatus(prev => ({ ...prev, [inst.id]: "error" }));
    }
  };

  const handleRestartSession = async (inst: Instance) => {
    setInstanceLoading(true);
    try {
      await callApiFull("restart-session", inst.session);
      toast.success("Sessão reiniciada!");
      handleCheckStatus(inst);
    } catch (e: any) {
      toast.error(e.message || "Erro ao reiniciar sessão");
    }
    setInstanceLoading(false);
  };

  const handleResetInstance = async (inst: Instance) => {
    if (!confirm(`Tem certeza? Isso vai desconectar o WhatsApp da instância "${inst.name}".`)) return;
    setInstanceLoading(true);
    try {
      await callApiFull("reset-instance", inst.session);
      toast.success("Instância resetada!");
      setConnectionStatus(prev => ({ ...prev, [inst.id]: "" }));
      if (selectedInstanceId === inst.id) setQrCode(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao resetar instância");
    }
    setInstanceLoading(false);
  };

  const handleDeleteInstance = async (inst: Instance) => {
    if (!confirm(`Excluir a instância "${inst.name}"? Campanhas vinculadas perderão a referência.`)) return;
    const { error } = await supabase.from("whatsapp_instances").delete().eq("id", inst.id);
    if (error) toast.error("Erro ao excluir instância");
    else { toast.success("Instância excluída"); fetchData(); }
  };

  const handleSyncFromApiFull = async () => {
    setInstanceLoading(true);
    console.groupCollapsed("[APIFULL] list-instances");
    try {
      const { data, error } = await supabase.functions.invoke("apifull-whatsapp", {
        body: { action: "list-instances" },
      });
      console.log("raw data:", data);
      console.log("invoke error:", error);
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // Normalize: API Full pode retornar array direto, { dados/data/instances/response/sessions: [...] }
      // ou ainda objeto único. Vamos tentar várias formas e logar o que achamos.
      let list: any[] = [];
      if (Array.isArray(data)) list = data;
      else if (data && typeof data === "object") {
        const candidates = ["dados", "data", "instances", "result", "response", "sessions", "items", "list"];
        for (const k of candidates) {
          if (Array.isArray((data as any)[k])) { list = (data as any)[k]; break; }
        }
        // Caso a chave aninhe outro objeto com array
        if (list.length === 0) {
          for (const v of Object.values(data)) {
            if (Array.isArray(v)) { list = v as any[]; break; }
            if (v && typeof v === "object") {
              for (const v2 of Object.values(v)) {
                if (Array.isArray(v2)) { list = v2 as any[]; break; }
              }
              if (list.length > 0) break;
            }
          }
        }
      }
      console.log("parsed list length:", list.length, list);

      if (!Array.isArray(list) || list.length === 0) {
        const rawPreview = JSON.stringify(data).slice(0, 300);
        toast.info(`Nenhuma instância reconhecida. Resposta: ${rawPreview}`);
        console.warn("Chaves disponíveis:", data && typeof data === "object" ? Object.keys(data) : typeof data);
        console.groupEnd();
        setInstanceLoading(false);
        return;
      }

      const existingSessions = new Set(instances.map(i => i.session));
      const toInsert = list
        .map((it: any) => {
          const session = it.session || it.name || it.instance || it.id || it.sessionName || it.sessao || it.nome;
          const name = it.name || it.nome || it.session || session;
          return session ? { name: String(name), session: String(session) } : null;
        })
        .filter((x): x is { name: string; session: string } => !!x && !existingSessions.has(x.session));
      console.log("toInsert:", toInsert);

      if (toInsert.length === 0) {
        toast.success("Tudo sincronizado — nenhuma instância nova");
        console.groupEnd();
        setInstanceLoading(false);
        return;
      }

      const { error: insErr } = await supabase
        .from("whatsapp_instances")
        .insert(toInsert.map(t => ({ ...t, company_id: null })));
      if (insErr) throw insErr;

      toast.success(`${toInsert.length} instância(s) importada(s) da API Full`);
      fetchData();
    } catch (e: any) {
      console.error("[APIFULL] sync error:", e);
      toast.error(e.message || "Erro ao sincronizar com API Full");
    }
    console.groupEnd();
    setInstanceLoading(false);
  };

  useEffect(() => {
    if (instances.length > 0 && (isAdmin || isGerente)) {
      instances.forEach(inst => handleCheckStatus(inst));
    }
  }, [instances.length]);

  useEffect(() => {
    if (!loading && isAdmin && instances.length === 0 && !instanceLoading && !autoSyncTriedRef.current) {
      autoSyncTriedRef.current = true;
      void handleSyncFromApiFull();
    }
  }, [loading, isAdmin, instances.length, instanceLoading]);

  const resetForm = () => {
    setName(""); setMessage(""); setImageUrl(null);
    setModuleKey("leads");
    setStatusId(""); setInstanceId(""); setCompanyId("");
    setStartTime("08:00"); setEndTime("18:00");
    setStartDate(""); setEndDate(""); setEditingId(null); setShowForm(false);
  };

  const handleEdit = (c: Campaign) => {
    setName(c.name); setMessage(c.message); setImageUrl(c.image_url || null);
    setModuleKey((c.module || "leads") as ModuleKey);
    setStatusId(c.status_id);
    setInstanceId(c.instance_id || ""); setCompanyId(c.company_id || "__GLOBAL__");
    setStartTime((c.start_time || "08:00").slice(0, 5));
    setEndTime((c.end_time || "18:00").slice(0, 5));
    setStartDate(c.start_date); setEndDate(c.end_date); setEditingId(c.id); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !message.trim() || !moduleKey || !statusId || !companyId || !startDate || !endDate || !startTime || !endTime) {
      toast.error("Preencha todos os campos obrigatórios (incluindo Empresa, Módulo, Coluna e horários)");
      return;
    }
    if (startTime >= endTime) {
      toast.error("O horário de início deve ser menor que o horário de fim");
      return;
    }
    if (!user) return;
    setSaving(true);

    // Para Cobranças, força a instância oticaJoonker mesmo se empresa for Global
    const joonkerInstance = instances.find(i => i.is_active && i.name?.toLowerCase().includes("oticajoonker"));
    const forcedInstanceId = moduleKey === "cobrancas" && joonkerInstance ? joonkerInstance.id : null;
    const effectiveInstanceId = forcedInstanceId || instanceId || null;

    const basePayload: any = {
      name: name.trim(), message: message.trim(),
      module: moduleKey,
      status_id: statusId,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      created_by: user.id,
      instance_id: effectiveInstanceId,
      image_url: imageUrl,
    };

    let error: any = null;
    if (editingId) {
      // Edição: mantém comportamento de uma única campanha (global se __GLOBAL__)
      ({ error } = await supabase
        .from("whatsapp_campaigns")
        .update({ ...basePayload, company_id: companyId === "__ALL__" || companyId === "__GLOBAL__" ? null : companyId })
        .eq("id", editingId));
    } else if (companyId === "__ALL__") {
      // Criar uma campanha para CADA empresa disponível
      if (companies.length === 0) {
        toast.error("Nenhuma empresa disponível");
        setSaving(false);
        return;
      }
      const rows = companies.map(c => ({
        ...basePayload,
        name: `${basePayload.name} — ${c.name}`,
        company_id: c.id,
        is_active: false,
      }));
      ({ error } = await supabase.from("whatsapp_campaigns").insert(rows));
    } else if (companyId === "__GLOBAL__") {
      // Global: normalmente usa instância da empresa do lead, mas para Cobranças força oticaJoonker
      ({ error } = await supabase.from("whatsapp_campaigns").insert({ ...basePayload, company_id: null, instance_id: forcedInstanceId, is_active: false }));
    } else {
      ({ error } = await supabase.from("whatsapp_campaigns").insert({ ...basePayload, company_id: companyId, is_active: false }));
    }

    if (error) { toast.error("Erro ao salvar campanha"); console.error(error); }
    else {
      toast.success(
        editingId
          ? "Campanha atualizada!"
          : companyId === "__ALL__"
            ? `${companies.length} campanhas criadas (uma por empresa)!`
            : companyId === "__GLOBAL__"
              ? "Campanha global criada (rodará para todas as empresas)!"
              : "Campanha criada!"
      );
      resetForm();
      fetchData();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta campanha?")) return;
    const { error } = await supabase.from("whatsapp_campaigns").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir campanha");
    else { toast.success("Campanha excluída"); fetchData(); }
  };

  const handleToggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("whatsapp_campaigns").update({ is_active: active }).eq("id", id);
    if (error) toast.error("Erro ao atualizar campanha");
    else fetchData();
  };

  const allStatuses = [...statusesByModule.leads, ...statusesByModule.cobrancas, ...statusesByModule.renovacoes];
  const getStatusLabel = (sid: string) => allStatuses.find(s => s.id === sid)?.label || "—";
  const getStatusColor = (sid: string) => allStatuses.find(s => s.id === sid)?.color || "gray";
  const currentStatuses = statusesByModule[moduleKey] || [];
  const getInstanceName = (iid: string | null) => instances.find(i => i.id === iid)?.name || "—";
  const getCompanyName = (cid: string | null) => companies.find(c => c.id === cid)?.name || "—";

  const filteredCampaigns = campaigns.filter(c =>
    filterCompanyId === "all" ? true : c.company_id === filterCompanyId
  );
  const isConnected = (id: string) => {
    const s = connectionStatus[id]?.toLowerCase();
    return s === "connected" || s === "open" || s === "sucesso";
  };

  return (
    <AppLayout>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          WhatsApp
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Gerencie suas instâncias e campanhas automáticas
        </p>
      </div>

      <Tabs defaultValue={isAdmin ? "instance" : "campaigns"} className="flex-1 flex flex-col">
        <TabsList className="mb-4">
          {isAdmin && <TabsTrigger value="instance"><Smartphone className="h-4 w-4 mr-1" /> Instâncias</TabsTrigger>}
          <TabsTrigger value="campaigns"><MessageSquare className="h-4 w-4 mr-1" /> Campanhas</TabsTrigger>
          <TabsTrigger value="triggers"><Zap className="h-4 w-4 mr-1" /> Gatilhos</TabsTrigger>
        </TabsList>

        {/* Instance Management Tab */}
        {isAdmin && (
          <TabsContent value="instance" className="flex-1 space-y-4">
            {/* Sync from API Full - botão destacado */}
            {canManage && (
              <div className="flex justify-end">
                <Button onClick={handleSyncFromApiFull} disabled={instanceLoading} className="gap-2">
                  {instanceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sincronizar instâncias da API Full
                </Button>
              </div>
            )}
            {/* Create New Instance */}
            {canManage && (
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Criar Nova Instância
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome *</Label>
                    <Input
                      placeholder="Ex: WhatsApp Empresa X"
                      value={newInstanceName}
                      onChange={e => setNewInstanceName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sessão (API Full)</Label>
                    <Input
                      placeholder="Auto-gerado se vazio"
                      value={newInstanceSession}
                      onChange={e => setNewInstanceSession(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Empresa (opcional)</Label>
                    <Select value={newInstanceCompanyId} onValueChange={setNewInstanceCompanyId}>
                      <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {companies.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleCreateInstance} disabled={instanceLoading} className="w-full">
                      {instanceLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                      Criar
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* QR Code Display */}
            {qrCode && (
              <div className="rounded-lg border bg-card p-4 flex flex-col items-center gap-3">
                <h3 className="font-semibold text-sm">Escaneie o QR Code com o WhatsApp</h3>
                <div className="bg-white p-4 rounded-lg">
                  <img
                    src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho
                </p>
                <Button variant="outline" size="sm" onClick={() => setQrCode(null)}>Fechar</Button>
              </div>
            )}

            {/* Instances List */}
            <ScrollArea className="flex-1">
              {instances.length === 0 ? (
                <div className="text-center py-12">
                  <Smartphone className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">Nenhuma instância cadastrada</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {instances.map(inst => {
                    const status = connectionStatus[inst.id];
                    const connected = isConnected(inst.id);
                    const company = companies.find(c => c.id === inst.company_id);
                    return (
                      <div key={inst.id} className="rounded-lg border bg-card p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Smartphone className="h-4 w-4 text-primary" />
                              <span className="font-semibold text-sm">{inst.name}</span>
                              <Badge variant="outline" className="font-mono text-[10px]">{inst.session}</Badge>
                              {company && (
                                <Badge variant="secondary" className="text-[10px]">{company.name}</Badge>
                              )}
                              {status && (
                                <Badge variant={connected ? "default" : "destructive"} className="flex items-center gap-1 text-[10px]">
                                  {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                                  {connected ? "Conectado" : status === "error" ? "Erro" : status?.toLowerCase() === "sucesso" ? "Conectado" : status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {canManage && (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleGetQRCode(inst)} disabled={instanceLoading}>
                              <QrCode className="h-4 w-4 mr-1" /> QR Code
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleCheckStatus(inst)}>
                              <RefreshCw className="h-4 w-4 mr-1" /> Status
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleRestartSession(inst)} disabled={instanceLoading}>
                              <RefreshCw className="h-4 w-4 mr-1" /> Reiniciar
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleResetInstance(inst)} disabled={instanceLoading}>
                              <Trash2 className="h-4 w-4 mr-1" /> Resetar
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteInstance(inst)}>
                              <Trash2 className="h-4 w-4 mr-1" /> Excluir
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        )}

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="flex-1 flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Filtrar por empresa:</Label>
              <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
                <SelectTrigger className="w-[220px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isGerente && !isAdmin ? "Minhas empresas" : "Todas as empresas"}</SelectItem>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canManage && (
              <Button onClick={() => { resetForm(); if (filterCompanyId !== "all") setCompanyId(filterCompanyId); setShowForm(!showForm); }} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Nova Campanha
              </Button>
            )}
          </div>

          {showForm && (
            <div className="rounded-lg border bg-card p-4 mb-6 space-y-4">
              <h3 className="font-semibold text-sm">{editingId ? "Editar campanha" : "Nova campanha"}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Empresa *</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
                    <SelectContent>
                      {!editingId && (
                        <SelectItem value="__ALL__">🏢 Todas as empresas (cria uma por empresa)</SelectItem>
                      )}
                      <SelectItem value="__GLOBAL__">🌐 Global (uma única para todas as empresas)</SelectItem>
                      {companies.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Nome da campanha *</Label>
                  <Input placeholder="Ex: Boas-vindas novos leads" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Página de origem *</Label>
                  <Select value={moduleKey} onValueChange={(v) => {
                    const next = v as ModuleKey;
                    setModuleKey(next);
                    setStatusId("");
                    if (next === "cobrancas") {
                      const joonker = instances.find(i => i.is_active && i.name?.toLowerCase().includes("oticajoonker"));
                      if (joonker) setInstanceId(joonker.id);
                    }
                  }}>
                    <SelectTrigger><SelectValue placeholder="Selecione a página..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leads">Leads</SelectItem>
                      <SelectItem value="cobrancas">Cobranças</SelectItem>
                      <SelectItem value="renovacoes">Renovações</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">De qual página os cards serão buscados</p>
                </div>
                <div className="space-y-2">
                  <Label>Coluna do Kanban *</Label>
                  <Select value={statusId} onValueChange={setStatusId} disabled={currentStatuses.length === 0}>
                    <SelectTrigger><SelectValue placeholder={currentStatuses.length === 0 ? "Sem colunas nesta página" : "Selecione a coluna..."} /></SelectTrigger>
                    <SelectContent>
                      {currentStatuses.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Instância WhatsApp {companyId === "__GLOBAL__" && moduleKey !== "cobrancas" ? "" : "*"}</Label>
                  {moduleKey === "cobrancas" ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-dashed border-primary/40 text-xs text-muted-foreground">
                      📌 Cobranças usa sempre a instância <span className="font-semibold ml-1">oticaJoonker</span>
                    </div>
                  ) : companyId === "__GLOBAL__" ? (
                    <div className="flex items-center h-10 px-3 rounded-md border border-dashed border-border text-xs text-muted-foreground">
                      🌐 Será usada a instância da empresa de cada lead
                    </div>
                  ) : (
                    <Select value={instanceId} onValueChange={setInstanceId}>
                      <SelectTrigger><SelectValue placeholder="Selecione a instância..." /></SelectTrigger>
                      <SelectContent>
                        {instances.filter(i => i.is_active).map(i => (
                          <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Data início *</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data fim *</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Horário início diário *</Label>
                  <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Hora do dia em que os envios começam</p>
                </div>
                <div className="space-y-2">
                  <Label>Horário fim diário *</Label>
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Hora do dia em que os envios param</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Mensagem padrão *</Label>
                <Textarea
                  placeholder="Digite a mensagem que será enviada para os leads desta coluna..."
                  value={message} onChange={e => setMessage(e.target.value)}
                  className="min-h-[100px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  Use {"{nome}"} para inserir o nome do lead automaticamente
                </p>
              </div>
              <ImageUploadField value={imageUrl} onChange={setImageUrl} label="Imagem da campanha (opcional)" />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={resetForm}>Cancelar</Button>
                <Button size="sm" onClick={handleSubmit} disabled={saving}>
                  <Send className="h-4 w-4 mr-1" />
                  {saving ? "Salvando..." : editingId ? "Atualizar" : "Criar Campanha"}
                </Button>
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Carregando...</p>
            ) : filteredCampaigns.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Nenhuma campanha criada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCampaigns.map(c => {
                  const stats = sendStats[c.id];
                  return (
                    <div key={c.id} className={`rounded-lg border bg-card p-4 space-y-3 ${!c.is_active ? "opacity-60" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{c.name}</span>
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                              {MODULE_LABELS[(c.module || "leads") as ModuleKey]}
                            </Badge>
                            <Badge variant="outline" style={{ borderColor: getStatusColor(c.status_id), color: getStatusColor(c.status_id) }}>
                              {getStatusLabel(c.status_id)}
                            </Badge>
                            {c.company_id ? (
                              <Badge variant="secondary" className="text-[10px]">{getCompanyName(c.company_id)}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/30">🌐 Global (todas as empresas)</Badge>
                            )}
                            {c.instance_id && (
                              <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                                <Smartphone className="h-3 w-3" /> {getInstanceName(c.instance_id)}
                              </Badge>
                            )}
                            {c.is_active ? (
                              <Badge variant="outline" className="text-emerald-500 border-emerald-500">Ativa</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">Inativa</Badge>
                            )}
                          </div>
                        </div>
                        {canManage && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Switch checked={c.is_active} onCheckedChange={v => handleToggle(c.id, v)} />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(c)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3">
                        {c.image_url && (
                          <img src={c.image_url} alt="Imagem" className="h-20 w-20 rounded-md object-cover border shrink-0" />
                        )}
                        <p className="text-sm bg-muted/50 rounded-md p-2 whitespace-pre-wrap flex-1">{c.message}</p>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" /> {(c.start_time || "08:00").slice(0, 5)}–{(c.end_time || "18:00").slice(0, 5)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(c.start_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })} — {format(new Date(c.end_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                        {stats && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {stats.sent} enviados · {stats.pending} pendentes · {stats.error} erros · {stats.total} total
                          </span>
                        )}
                        {!stats && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" /> Aguardando processamento
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
        {/* Trigger Campaigns Tab */}
        <TabsContent value="triggers" className="flex-1 flex flex-col">
          <TriggerCampaigns instances={instances} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
