import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Send, Users, Hash, Clock, Zap, Smartphone } from "lucide-react";
import ImageUploadField from "@/components/whatsapp/ImageUploadField";

type ModuleKey = "leads" | "cobrancas" | "renovacoes";

const MODULE_LABELS: Record<ModuleKey, string> = {
  leads: "Leads",
  cobrancas: "Cobranças",
  renovacoes: "Renovações",
};

type Status = {
  id: string;
  key: string;
  label: string;
  color: string;
};

type TriggerStep = {
  id?: string;
  position: number;
  delay_days: number;
  message: string;
  image_url?: string | null;
};

type TriggerCampaign = {
  id: string;
  name: string;
  module: ModuleKey;
  status_id: string;
  instance_id: string | null;
  company_id: string | null;
  is_active: boolean;
  start_time: string;
  end_time: string;
  created_by: string;
  created_at: string;
  whatsapp_trigger_steps?: TriggerStep[];
};

type TriggerSendStats = {
  campaign_id: string;
  total: number;
  sent: number;
  error: number;
};

type Instance = {
  id: string;
  name: string;
  session: string;
  company_id: string | null;
  is_active: boolean;
};

type Company = { id: string; name: string };

interface Props {
  instances: Instance[];
}

export default function TriggerCampaigns({ instances }: Props) {
  const { user, isAdmin, isGerente } = useAuth();
  const [campaigns, setCampaigns] = useState<TriggerCampaign[]>([]);
  const [statusesByModule, setStatusesByModule] = useState<Record<ModuleKey, Status[]>>({
    leads: [], cobrancas: [], renovacoes: [],
  });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<string[] | null>(null);
  const [sendStats, setSendStats] = useState<Record<string, TriggerSendStats>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");

  const [name, setName] = useState("");
  const [moduleKey, setModuleKey] = useState<ModuleKey>("leads");
  const [statusId, setStatusId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [steps, setSteps] = useState<TriggerStep[]>([
    { position: 0, delay_days: 0, message: "" },
  ]);

  const canManage = isAdmin;

  const fetchData = async () => {
    setLoading(true);
    const [campaignsRes, leadStatusRes, cobStatusRes, renStatusRes, sendsRes, companiesRes] = await Promise.all([
      supabase
        .from("whatsapp_trigger_campaigns")
        .select("*, whatsapp_trigger_steps(*)")
        .order("created_at", { ascending: false }),
      supabase.from("crm_statuses").select("*").order("position"),
      supabase.from("crm_cobranca_statuses").select("*").order("position"),
      supabase.from("crm_renovacao_statuses").select("*").order("position"),
      supabase.from("whatsapp_trigger_sends").select("campaign_id, status"),
      supabase.from("companies").select("id, name").order("name"),
    ]);

    setCampaigns((campaignsRes.data || []) as any);
    setStatusesByModule({
      leads: (leadStatusRes.data || []) as Status[],
      cobrancas: (cobStatusRes.data || []) as Status[],
      renovacoes: (renStatusRes.data || []) as Status[],
    });
    const allCompanies = (companiesRes.data || []) as Company[];
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

    const stats: Record<string, TriggerSendStats> = {};
    for (const send of (sendsRes.data || []) as { campaign_id: string; status: string }[]) {
      if (!stats[send.campaign_id]) {
        stats[send.campaign_id] = { campaign_id: send.campaign_id, total: 0, sent: 0, error: 0 };
      }
      stats[send.campaign_id].total++;
      if (send.status === "sent") stats[send.campaign_id].sent++;
      else if (send.status === "error") stats[send.campaign_id].error++;
    }
    setSendStats(stats);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    /* eslint-disable-next-line */
  }, [user?.id, isAdmin, isGerente]);

  const resetForm = () => {
    setName("");
    setModuleKey("leads");
    setStatusId("");
    setInstanceId("");
    setCompanyId("");
    setStartTime("08:00");
    setEndTime("18:00");
    setSteps([{ position: 0, delay_days: 0, message: "", image_url: null }]);
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (c: TriggerCampaign) => {
    setName(c.name);
    setModuleKey((c.module || "leads") as ModuleKey);
    setStatusId(c.status_id);
    setInstanceId(c.instance_id || "");
    setCompanyId(c.company_id || "__GLOBAL__");
    setStartTime((c.start_time || "08:00").slice(0, 5));
    setEndTime((c.end_time || "18:00").slice(0, 5));
    const sorted = [...(c.whatsapp_trigger_steps || [])].sort((a, b) => a.position - b.position);
    setSteps(
      sorted.length > 0
        ? sorted.map((s) => ({ id: s.id, position: s.position, delay_days: s.delay_days, message: s.message, image_url: s.image_url || null }))
        : [{ position: 0, delay_days: 0, message: "", image_url: null }]
    );
    setEditingId(c.id);
    setShowForm(true);
  };

  const addStep = () => {
    if (steps.length >= 5) {
      toast.error("Máximo de 5 etapas por campanha");
      return;
    }
    setSteps([...steps, { position: steps.length, delay_days: steps.length === 0 ? 0 : 3, message: "", image_url: null }]);
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i })));
  };

  const updateStep = (idx: number, field: keyof TriggerStep, value: any) => {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !moduleKey || !statusId || !companyId) {
      toast.error("Preencha empresa, página, nome e coluna");
      return;
    }
    if (steps.some((s) => !s.message.trim())) {
      toast.error("Preencha a mensagem de todas as etapas");
      return;
    }
    if (startTime >= endTime) {
      toast.error("O horário de início deve ser menor que o horário de fim");
      return;
    }
    if (!user) return;
    setSaving(true);

    try {
      // Para Cobranças, força a instância oticaJoonker mesmo se empresa for Global
      const joonkerInstance = instances.find(i => i.is_active && i.name?.toLowerCase().includes("oticajoonker"));
      const forcedInstanceId = moduleKey === "cobrancas" && joonkerInstance ? joonkerInstance.id : null;
      const effectiveInstanceId = forcedInstanceId || instanceId || null;

      const basePayload: any = {
        name: name.trim(),
        module: moduleKey,
        status_id: statusId,
        start_time: startTime,
        end_time: endTime,
        created_by: user.id,
        instance_id: effectiveInstanceId,
      };

      const buildSteps = (campaignId: string) =>
        steps.map((s, i) => ({
          campaign_id: campaignId,
          position: i,
          delay_days: s.delay_days,
          message: s.message.trim(),
          image_url: s.image_url || null,
        }));

      const resolveCompanyId = (val: string) =>
        val === "__ALL__" || val === "__GLOBAL__" ? null : val;

      if (editingId) {
        // Edição: mantém comportamento de uma única campanha (global se __GLOBAL__)
        const { error } = await supabase
          .from("whatsapp_trigger_campaigns")
          .update({ ...basePayload, company_id: resolveCompanyId(companyId) })
          .eq("id", editingId);
        if (error) throw error;
        await supabase.from("whatsapp_trigger_steps").delete().eq("campaign_id", editingId);
        const { error: stepsError } = await supabase
          .from("whatsapp_trigger_steps")
          .insert(buildSteps(editingId));
        if (stepsError) throw stepsError;
        toast.success("Campanha atualizada!");
      } else if (companyId === "__ALL__") {
        // Criar uma campanha para CADA empresa disponível
        if (companies.length === 0) {
          toast.error("Nenhuma empresa disponível");
          setSaving(false);
          return;
        }
        for (const c of companies) {
          const { data, error } = await supabase
            .from("whatsapp_trigger_campaigns")
            .insert({ ...basePayload, name: `${basePayload.name} — ${c.name}`, company_id: c.id, is_active: false })
            .select("id")
            .single();
          if (error) throw error;
          const { error: stepsError } = await supabase
            .from("whatsapp_trigger_steps")
            .insert(buildSteps(data.id));
          if (stepsError) throw stepsError;
        }
        toast.success(`${companies.length} campanhas criadas (uma por empresa)!`);
      } else if (companyId === "__GLOBAL__") {
        // Global: normalmente usa instância da empresa do lead, mas para Cobranças força oticaJoonker
        const { data, error } = await supabase
          .from("whatsapp_trigger_campaigns")
          .insert({ ...basePayload, company_id: null, instance_id: forcedInstanceId, is_active: false })
          .select("id")
          .single();
        if (error) throw error;
        const { error: stepsError } = await supabase
          .from("whatsapp_trigger_steps")
          .insert(buildSteps(data.id));
        if (stepsError) throw stepsError;
        toast.success("Campanha global criada (rodará para todas as empresas)!");
      } else {
        const { data, error } = await supabase
          .from("whatsapp_trigger_campaigns")
          .insert({ ...basePayload, company_id: companyId, is_active: false })
          .select("id")
          .single();
        if (error) throw error;
        const { error: stepsError } = await supabase
          .from("whatsapp_trigger_steps")
          .insert(buildSteps(data.id));
        if (stepsError) throw stepsError;
        toast.success("Campanha criada!");
      }

      resetForm();
      fetchData();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e.message || "Erro desconhecido"));
      console.error(e);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta campanha por gatilho?")) return;
    const { error } = await supabase.from("whatsapp_trigger_campaigns").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else {
      toast.success("Campanha excluída");
      fetchData();
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("whatsapp_trigger_campaigns").update({ is_active: active }).eq("id", id);
    if (error) toast.error("Erro ao atualizar");
    else fetchData();
  };

  const allStatuses = [...statusesByModule.leads, ...statusesByModule.cobrancas, ...statusesByModule.renovacoes];
  const getStatusLabel = (sid: string) => allStatuses.find((s) => s.id === sid)?.label || "—";
  const getStatusColor = (sid: string) => allStatuses.find((s) => s.id === sid)?.color || "gray";
  const currentStatuses = statusesByModule[moduleKey] || [];
  const getInstanceName = (iid: string | null) => instances.find((i) => i.id === iid)?.name || "—";
  const getCompanyName = (cid: string | null) => companies.find((c) => c.id === cid)?.name || "—";

  // When filtering by company, only show that company's instances
  const availableInstances = instances.filter(i => {
    if (!i.is_active) return false;
    if (!companyId) return true;
    return !i.company_id || i.company_id === companyId;
  });

  const filteredCampaigns = campaigns.filter(c =>
    filterCompanyId === "all" ? true : c.company_id === filterCompanyId
  );

  return (
    <div className="flex-1 flex flex-col">
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
          <Button
            onClick={() => {
              resetForm();
              if (filterCompanyId !== "all") setCompanyId(filterCompanyId);
              setShowForm(!showForm);
            }}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            Nova Campanha por Gatilho
          </Button>
        )}
      </div>

      {showForm && (
        <div className="rounded-lg border bg-card p-4 mb-6 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" />
            {editingId ? "Editar campanha por gatilho" : "Nova campanha por gatilho"}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Empresa *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {!editingId && (
                    <SelectItem value="__ALL__">🏢 Todas as empresas (cria uma por empresa)</SelectItem>
                  )}
                  <SelectItem value="__GLOBAL__">🌐 Global (uma única para todas as empresas)</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="Ex: Sequência boas-vindas" value={name} onChange={(e) => setName(e.target.value)} />
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
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads">Leads</SelectItem>
                  <SelectItem value="cobrancas">Cobranças</SelectItem>
                  <SelectItem value="renovacoes">Renovações</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Coluna do Kanban *</Label>
              <Select value={statusId} onValueChange={setStatusId} disabled={currentStatuses.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={currentStatuses.length === 0 ? "Sem colunas nesta página" : "Selecione..."} />
                </SelectTrigger>
                <SelectContent>
                  {currentStatuses.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Instância WhatsApp</Label>
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
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableInstances.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>Horário início diário *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Hora do dia em que os envios começam</p>
            </div>
            <div className="space-y-2">
              <Label>Horário fim diário *</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">Hora do dia em que os envios param</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Etapas da sequência</Label>
              {steps.length < 5 && (
                <Button type="button" variant="outline" size="sm" onClick={addStep}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar etapa
                </Button>
              )}
            </div>

            {steps.map((step, idx) => (
              <div key={idx} className="rounded-md border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Etapa {idx + 1} — {idx === 0 && step.delay_days === 0 ? "Ao entrar na coluna" : `Após ${step.delay_days} dia(s)`}
                  </span>
                  {steps.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeStep(idx)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Dias de espera:</Label>
                  <Input
                    type="number"
                    min="0"
                    className="w-20 h-8 text-sm"
                    value={step.delay_days}
                    onChange={(e) => updateStep(idx, "delay_days", parseInt(e.target.value) || 0)}
                  />
                </div>
                <Textarea
                  placeholder="Mensagem desta etapa... Use {nome} para o nome do lead"
                  value={step.message}
                  onChange={(e) => updateStep(idx, "message", e.target.value)}
                  className="min-h-[70px] text-sm"
                />
                <ImageUploadField
                  value={step.image_url || null}
                  onChange={(url) => updateStep(idx, "image_url", url)}
                  label="Imagem desta etapa (opcional)"
                />
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground">
            A campanha enviará apenas para leads (criados ou atribuídos) da empresa selecionada.
          </p>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancelar
            </Button>
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
            <Zap className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Nenhuma campanha por gatilho criada</p>
            <p className="text-muted-foreground text-xs mt-1">
              Crie sequências de mensagens automáticas que disparam quando um lead entra em uma coluna
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredCampaigns.map((c) => {
              const stats = sendStats[c.id];
              const sortedSteps = [...(c.whatsapp_trigger_steps || [])].sort((a, b) => a.position - b.position);
              return (
                <div key={c.id} className={`rounded-lg border bg-card p-4 space-y-3 ${!c.is_active ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Zap className="h-4 w-4 text-amber-500" />
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
                        <Switch checked={c.is_active} onCheckedChange={(v) => handleToggle(c.id, v)} />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(c)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Steps preview */}
                  <div className="space-y-1">
                    {sortedSteps.map((step: any, idx) => (
                      <div key={step.id || idx} className="flex items-start gap-2 text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap mt-0.5">
                          <Clock className="h-3 w-3" />
                          {step.delay_days === 0 ? "Entrada" : `+${step.delay_days}d`}
                        </div>
                        {step.image_url && (
                          <img src={step.image_url} alt="" className="h-10 w-10 rounded object-cover border shrink-0" />
                        )}
                        <p className="bg-muted/50 rounded px-2 py-1 flex-1 line-clamp-2">{step.message}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {(c.start_time || "08:00").slice(0, 5)}–{(c.end_time || "18:00").slice(0, 5)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" /> {sortedSteps.length} etapa(s)
                    </span>
                    {stats && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {stats.sent} enviados · {stats.error} erros · {stats.total} total
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
