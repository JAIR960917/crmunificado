import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ExternalLink, Loader2, UserPlus } from "lucide-react";
import { normalizeLeadData, resolveLeadIdentity } from "@/lib/leadIdentity";
import { nationalPhoneDigits } from "@/lib/phoneFormat";

type ConversationRef = {
  id: string;
  wa_id: string;
  contact_name: string | null;
  phone_display: string | null;
  card_id: string | null;
  module: string | null;
};

type Company = { id: string; name: string };

type FormField = {
  id: string;
  is_name_field?: boolean;
  is_phone_field?: boolean;
};

type LinkedRecord = {
  module: "leads" | "renovacoes";
  id: string;
  nome: string;
  empresaNome: string | null;
  statusLabel?: string | null;
};

type Props = {
  conversation: ConversationRef;
  formatPhone: (raw: string) => string;
  onLinked: (conversationId: string, patch: { card_id: string; contact_name: string | null; module: string }) => void;
  /** Texto após busca em cobrança sem resultado (fluxo admin). */
  afterCobrancaSearch?: boolean;
};

function recordNameFromData(data: Record<string, unknown>, fields: FormField[]): string {
  return (
    resolveLeadIdentity(data as Record<string, any>, fields).nome ||
    String(data.nome || data.nome_lead || "Cliente")
  );
}

export default function WhatsAppCreateLeadPanel({ conversation, formatPhone, onLinked, afterCobrancaSearch }: Props) {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [linkedRecord, setLinkedRecord] = useState<LinkedRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(true);

  const [companyId, setCompanyId] = useState("");
  const [leadName, setLeadName] = useState("");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  const displayPhone = formatPhone(conversation.phone_display || conversation.wa_id);
  const nationalDigits = nationalPhoneDigits(conversation.phone_display || conversation.wa_id || "");

  const linkConversation = useCallback(
    async (record: LinkedRecord, linkDb: boolean) => {
      setLinkedRecord(record);
      if (!linkDb || !conversation.id) return;
      const needsLink =
        conversation.card_id !== record.id || conversation.module !== record.module;
      if (!needsLink) return;
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({
          card_id: record.id,
          module: record.module,
          contact_name: record.nome,
        })
        .eq("id", conversation.id);
      if (!error) {
        onLinked(conversation.id, {
          card_id: record.id,
          contact_name: record.nome,
          module: record.module,
        });
      }
    },
    [conversation.card_id, conversation.id, conversation.module, onLinked],
  );

  const loadRenovacaoById = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("crm_renovacoes")
      .select("id, data, status")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const d = (data.data || {}) as Record<string, unknown>;
    const nome = recordNameFromData(d, fields);
    let statusLabel: string | null = null;
    const { data: st } = await supabase
      .from("crm_renovacao_statuses")
      .select("label")
      .eq("key", data.status)
      .maybeSingle();
    statusLabel = st?.label || data.status;
    return {
      module: "renovacoes" as const,
      id: data.id,
      nome,
      empresaNome: typeof d.empresa_nome === "string" ? d.empresa_nome : null,
      statusLabel,
    };
  }, [fields]);

  const loadLeadById = useCallback(async (leadId: string) => {
    const { data, error } = await supabase.from("crm_leads").select("id, data").eq("id", leadId).maybeSingle();
    if (error || !data) {
      return {
        module: "leads" as const,
        id: leadId,
        nome: "Lead vinculado",
        empresaNome: null,
        statusLabel: null,
      };
    }
    const d = (data.data || {}) as Record<string, unknown>;
    return {
      module: "leads" as const,
      id: leadId,
      nome: recordNameFromData(d, fields),
      empresaNome: typeof d.empresa_nome === "string" ? d.empresa_nome : null,
      statusLabel: null,
    };
  }, [fields]);

  const resolveByPhone = useCallback(async () => {
    if (nationalDigits.length < 8) return null;

    const [{ data: renoRows, error: renoErr }, { data: leadRows, error: leadErr }] = await Promise.all([
      supabase.rpc("find_renovacao_by_phone", { p_phone: nationalDigits }),
      supabase.rpc("find_lead_by_phone", { _phone: nationalDigits }),
    ]);

    const reno = !renoErr && renoRows?.[0] ? renoRows[0] : null;
    const lead = !leadErr && leadRows?.[0]?.lead_id ? leadRows[0] : null;

    const mapRenovacao = async (renoRow: { id: string; data?: unknown; status?: string }) => {
      const d = (renoRow.data || {}) as Record<string, unknown>;
      const nome = recordNameFromData(d, fields);
      let statusLabel: string | null = renoRow.status || null;
      const { data: st } = await supabase
        .from("crm_renovacao_statuses")
        .select("label")
        .eq("key", renoRow.status)
        .maybeSingle();
      if (st?.label) statusLabel = st.label;
      return {
        module: "renovacoes" as const,
        id: renoRow.id as string,
        nome,
        empresaNome: typeof d.empresa_nome === "string" ? d.empresa_nome : null,
        statusLabel,
      };
    };

    // Admin após cobrança: sempre renovação → leads (ignora módulo gravado na conversa).
    if (afterCobrancaSearch) {
      if (reno) return mapRenovacao(reno);
      if (lead?.lead_id) return loadLeadById(lead.lead_id);
      return null;
    }

    if (conversation.module === "leads" && lead?.lead_id) {
      return loadLeadById(lead.lead_id);
    }
    if (conversation.module === "renovacoes" && reno) {
      return mapRenovacao(reno);
    }

    if (reno) return mapRenovacao(reno);

    if (lead?.lead_id) {
      return loadLeadById(lead.lead_id);
    }

    return null;
  }, [afterCobrancaSearch, conversation.module, fields, loadLeadById, nationalDigits]);

  const resolveLinkedRecord = useCallback(async () => {
    setLoadingRecord(true);
    setLinkedRecord(null);
    try {
      if (conversation.card_id) {
        if (conversation.module === "renovacoes") {
          const reno = await loadRenovacaoById(conversation.card_id);
          if (reno) {
            await linkConversation(reno, false);
            return;
          }
        }
        const lead = await loadLeadById(conversation.card_id);
        if (lead.nome !== "Lead vinculado" || conversation.module === "leads") {
          await linkConversation(lead, false);
          return;
        }
        const reno = await loadRenovacaoById(conversation.card_id);
        if (reno) {
          await linkConversation(reno, true);
          return;
        }
      }

      const found = await resolveByPhone();
      if (found) {
        await linkConversation(found, true);
      }
    } finally {
      setLoadingRecord(false);
    }
  }, [
    conversation.card_id,
    conversation.module,
    linkConversation,
    loadLeadById,
    loadRenovacaoById,
    resolveByPhone,
  ]);

  const loadMeta = useCallback(async () => {
    if (!user?.id) return;
    setLoadingMeta(true);
    try {
      const [{ data: myProfile }, { data: managerCos }, { data: ff }] = await Promise.all([
        supabase.from("profiles").select("company_id").eq("user_id", user.id).maybeSingle(),
        supabase.from("manager_companies").select("company_id").eq("user_id", user.id),
        supabase.from("crm_form_fields").select("id, is_name_field, is_phone_field").order("position"),
      ]);

      let allowed: Company[] = [];
      if (isAdmin) {
        const { data: all } = await supabase.from("companies").select("id, name").order("name");
        allowed = (all || []) as Company[];
      } else {
        const ids = new Set<string>();
        if (myProfile?.company_id) ids.add(myProfile.company_id);
        (managerCos || []).forEach((mc: { company_id?: string }) => {
          if (mc.company_id) ids.add(mc.company_id);
        });
        if (ids.size > 0) {
          const { data: filtered } = await supabase
            .from("companies")
            .select("id, name")
            .in("id", Array.from(ids))
            .order("name");
          allowed = (filtered || []) as Company[];
        }
      }
      setCompanies(allowed);
      setFields((ff || []) as FormField[]);
      if (allowed.length === 1) setCompanyId(allowed[0].id);
    } catch {
      toast.error("Não foi possível carregar empresas para o cadastro.");
    } finally {
      setLoadingMeta(false);
    }
  }, [user?.id, isAdmin]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    setLeadName(conversation.contact_name?.trim() || "");
    setObservacao("");
    if (fields.length === 0 && loadingMeta) return;
    void resolveLinkedRecord();
  }, [conversation.id, conversation.card_id, conversation.module, conversation.contact_name, fields.length, loadingMeta, resolveLinkedRecord]);

  const selectedCompanyName = useMemo(
    () => companies.find((c) => c.id === companyId)?.name || "",
    [companies, companyId],
  );

  const handleCreate = async () => {
    if (!user?.id) {
      toast.error("Faça login para cadastrar o lead.");
      return;
    }
    if (!companyId) {
      toast.error("Selecione a empresa do lead.");
      return;
    }
    const name = leadName.trim();
    if (!name) {
      toast.error("Informe o nome do lead.");
      return;
    }
    if (nationalDigits.length < 8) {
      toast.error("Telefone da conversa inválido.");
      return;
    }

    const nameField = fields.find((f) => f.is_name_field);
    const phoneField = fields.find((f) => f.is_phone_field);
    if (!nameField || !phoneField) {
      toast.error("Configure os campos de nome e telefone no formulário de leads.");
      return;
    }

    setSaving(true);
    try {
      const { data: dup } = await supabase.rpc("find_lead_by_phone", { _phone: nationalDigits });
      const row = Array.isArray(dup) ? dup[0] : null;
      if (row?.lead_id) {
        const owner = row.owner_name || "outro vendedor";
        toast.error(
          row.is_mine
            ? "Já existe um lead com este telefone. Abra-o na tela de leads."
            : `Telefone já cadastrado com ${owner}.`,
        );
        setSaving(false);
        return;
      }

      const baseData: Record<string, unknown> = {
        [`field_${nameField.id}`]: name,
        [`field_${phoneField.id}`]: nationalDigits,
        empresa_id: companyId,
        empresa_nome: selectedCompanyName,
        origem_whatsapp: true,
        whatsapp_wa_id: conversation.wa_id,
      };
      if (observacao.trim()) baseData.observacao = observacao.trim();

      const finalData = normalizeLeadData(baseData as Record<string, any>, fields);

      const { data: inserted, error } = await supabase
        .from("crm_leads")
        .insert({
          data: finalData,
          status: "novo",
          assigned_to: user.id,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        toast.error(error?.message || "Erro ao criar lead.");
        return;
      }

      const leadId = inserted.id;
      const noteBody = observacao.trim()
        ? `📱 WhatsApp Inbox — ${observacao.trim()}`
        : "📱 Lead cadastrado a partir do WhatsApp Inbox.";

      await supabase.from("crm_lead_notes").insert({
        lead_id: leadId,
        user_id: user.id,
        content: noteBody,
      });

      const { error: linkErr } = await supabase
        .from("whatsapp_conversations")
        .update({
          card_id: leadId,
          module: "leads",
          contact_name: name,
        })
        .eq("id", conversation.id);

      if (linkErr) {
        toast.warning("Lead criado, mas não foi possível vincular a conversa: " + linkErr.message);
      } else {
        onLinked(conversation.id, { card_id: leadId, contact_name: name, module: "leads" });
        toast.success("Lead cadastrado e vinculado à conversa.");
      }

      setLinkedRecord({
        module: "leads",
        id: leadId,
        nome: name,
        empresaNome: selectedCompanyName || null,
        statusLabel: null,
      });
    } catch {
      toast.error("Erro inesperado ao cadastrar lead.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingRecord) {
    return (
      <div className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground">
        {afterCobrancaSearch ? (
          <p className="text-xs text-muted-foreground">
            Nenhum card em cobrança para {displayPhone}. Buscando em renovação e leads…
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando no CRM…
        </div>
      </div>
    );
  }

  if (linkedRecord) {
    const isRenovacao = linkedRecord.module === "renovacoes";
    return (
      <div className="space-y-3 border-t pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {isRenovacao ? "Renovação no CRM" : "Lead no CRM"}
        </p>
        <p className="font-semibold leading-snug break-words">{linkedRecord.nome}</p>
        {linkedRecord.empresaNome ? (
          <p className="text-xs text-muted-foreground break-words">Empresa: {linkedRecord.empresaNome}</p>
        ) : null}
        {linkedRecord.statusLabel ? (
          <p className="text-xs text-muted-foreground break-words">Coluna: {linkedRecord.statusLabel}</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() =>
            navigate(isRenovacao ? "/clientes-ativos" : `/?edit=${linkedRecord.id}`)
          }
        >
          <ExternalLink className="h-4 w-4" />
          {isRenovacao ? "Abrir tela de renovação" : "Abrir na tela de leads"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-4">
      {afterCobrancaSearch ? (
        <p className="text-xs text-muted-foreground">
          Não encontrado em cobrança, renovação nem leads para {displayPhone}.
        </p>
      ) : null}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cadastrar lead</p>

      {loadingMeta ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : companies.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Nenhuma empresa disponível para seu usuário. Peça ao administrador para vincular sua conta a uma empresa.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Nome do lead</Label>
            <Input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Nome do contato"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Telefone (WhatsApp)</Label>
            <Input value={displayPhone} readOnly disabled className="h-9 font-medium" />
            <p className="text-[10px] text-muted-foreground">Preenchido automaticamente a partir da conversa.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observação para continuidade</Label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Contexto do atendimento, pedido do cliente, próximo passo…"
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          <Button
            type="button"
            className="w-full gap-2"
            disabled={saving || !companyId || !leadName.trim()}
            onClick={handleCreate}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Adicionar lead
          </Button>
        </>
      )}
    </div>
  );
}
