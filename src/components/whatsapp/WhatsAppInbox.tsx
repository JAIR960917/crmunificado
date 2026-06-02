import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Search,
  Send,
} from "lucide-react";

type ModuleKey = "leads" | "cobrancas" | "renovacoes";

type ConversationRow = {
  id: string;
  instance_id: string | null;
  wa_id: string;
  contact_name: string | null;
  phone_display: string | null;
  module: string | null;
  card_id: string | null;
  window_expires_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  unread_count: number;
  assigned_to: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  status: string | null;
  is_template: boolean;
  meta_template_name: string | null;
  created_at: string;
};

type TemplateRow = { name: string; status: string; category: string; language: string };

const MODULE_STYLES: Record<ModuleKey, { label: string; className: string }> = {
  leads: { label: "Lead", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  cobrancas: { label: "Cobrança", className: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
  renovacoes: { label: "Renovação", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
};

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function toModuleKey(v: string | null): ModuleKey {
  if (v === "cobrancas" || v === "leads" || v === "renovacoes") return v;
  return "leads";
}

function formatPhoneDisplay(raw: string) {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const left = rest.length > 5 ? rest.slice(0, rest.length - 4) : rest;
    const right = rest.slice(-4);
    return `+55 ${ddd} ${left}-${right}`;
  }
  return raw;
}

function StatusIcon({ status }: { status?: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "sent") return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
  if (s === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  if (s === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
  return null;
}

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "mine">("all");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateLanguage, setTemplateLanguage] = useState<string>("pt_BR");

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const mod = MODULE_STYLES[toModuleKey(conversation?.module || null)];
  const windowOpen = useMemo(() => {
    if (!conversation?.window_expires_at) return false;
    return new Date(conversation.window_expires_at).getTime() > Date.now();
  }, [conversation?.window_expires_at]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && (c.unread_count || 0) === 0) return false;
      if (filter === "mine" && user?.id && c.assigned_to !== user.id) return false;
      if (!q) return true;
      const name = (c.contact_name || "").toLowerCase();
      const wa = (c.wa_id || "").toLowerCase();
      const preview = (c.last_preview || "").toLowerCase();
      return name.includes(q) || wa.includes(q) || preview.includes(q);
    });
  }, [conversations, filter, search, user?.id]);

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, instance_id, wa_id, contact_name, phone_display, module, card_id, window_expires_at, last_message_at, last_preview, unread_count, assigned_to")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw error;
    const rows = (data || []) as ConversationRow[];
    setConversations(rows);
    if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
  };

  const loadMessages = async (conversationId: string) => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, body, status, is_template, meta_template_name, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    setMessages((data || []) as MessageRow[]);
  };

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-whatsapp", { body: { action: "list-templates" } });
      if (error) throw error;
      const rows = ((data as { templates?: TemplateRow[] } | null)?.templates || []) as TemplateRow[];
      const approved = rows.filter((t) => String(t.status || "").toUpperCase() === "APPROVED");
      setTemplates(approved);
      if (!selectedTemplate && approved.length > 0) {
        setSelectedTemplate(approved[0].name);
        setTemplateLanguage(approved[0].language || "pt_BR");
      }
    } catch {
      // Pode falhar se não for admin — nesse caso a pessoa pode digitar manualmente.
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadConversations();
        await loadTemplates();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar inbox");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-inbox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => {
        void loadConversations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, (payload) => {
        const convId = (payload.new as { conversation_id?: string } | null)?.conversation_id;
        if (convId && convId === selectedId) void loadMessages(convId);
        else void loadConversations();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const handleSendText = async () => {
    if (!conversation?.id) return;
    if (!draft.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-chat", {
        body: { action: "send-text", conversation_id: conversation.id, text: draft.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDraft("");
      await loadMessages(conversation.id);
      await loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!conversation?.id) return;
    if (!selectedTemplate.trim()) {
      toast.error("Informe o nome do template");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-chat", {
        body: {
          action: "send-template",
          conversation_id: conversation.id,
          template_name: selectedTemplate.trim(),
          template_language: templateLanguage.trim() || "pt_BR",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await loadMessages(conversation.id);
      await loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar template");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[620px] flex-col gap-3">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Lista de conversas */}
        <aside className="flex w-full max-w-[320px] flex-col border-r bg-muted/30 lg:max-w-[360px]">
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Conversas</h1>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nome ou telefone..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-1">
              {(
                [
                  ["all", "Todas"],
                  ["unread", "Não lidas"],
                  ["mine", "Minhas"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "ghost"}
                  className="h-8 flex-1 text-xs"
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <ul className="p-1">
              {filteredList.map((c) => {
                const active = c.id === selectedId;
                const m = MODULE_STYLES[toModuleKey(c.module)];
                const contact = c.contact_name || formatPhoneDisplay(c.phone_display || c.wa_id);
                const lastAt = c.last_message_at ? new Date(c.last_message_at) : null;
                const windowIsOpen = c.window_expires_at ? new Date(c.window_expires_at).getTime() > Date.now() : false;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "flex w-full gap-3 rounded-lg p-3 text-left transition-colors",
                        active ? "bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <Avatar className="h-11 w-11">
                        <AvatarFallback className="text-xs font-medium">
                          {initials(contact)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{contact}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {lastAt ? formatDistanceToNow(lastAt, { addSuffix: true, locale: ptBR }) : "—"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{c.last_preview || "—"}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", m.className)}>
                            {m.label}
                          </span>
                          {!windowIsOpen && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">
                              Fora da janela 24h
                            </span>
                          )}
                        </div>
                      </div>
                      {c.unread_count > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                          {c.unread_count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {!loading && filteredList.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma conversa encontrada
                </li>
              ) : null}
            </ul>
          </ScrollArea>
        </aside>

        {/* Thread + painel lateral */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!conversation ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <AlertCircle className="h-4 w-4 mr-2" />
              Selecione uma conversa
            </div>
          ) : (
            <>
              {/* Cabeçalho da conversa */}
              <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>{initials(conversation.contact_name || conversation.wa_id)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{conversation.contact_name || formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}</h2>
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", mod.className)}>
                      {mod.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
                  </p>
                </div>
                {windowOpen ? (
                  <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                    <Clock className="h-3 w-3" />
                    Janela 24h aberta
                    {conversation.window_expires_at ? (
                      <span className="font-normal opacity-80">
                        · até {format(new Date(conversation.window_expires_at), "HH:mm", { locale: ptBR })}
                      </span>
                    ) : null}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-amber-900 dark:text-amber-100">
                    <FileText className="h-3 w-3" />
                    Só template aprovado
                  </Badge>
                )}
              </header>

              <div className="flex min-h-0 flex-1">
                {/* Mensagens */}
                <div className="flex min-w-0 flex-1 flex-col bg-[#e5ddd5]/30 dark:bg-muted/20">
                  <ScrollArea className="flex-1 p-4">
                    <div className="mx-auto max-w-2xl space-y-3">
                      {messages.map((msg) => {
                        const out = msg.direction === "out";
                        const at = new Date(msg.created_at);
                        return (
                          <div key={msg.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "relative max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                                out
                                  ? "rounded-br-none bg-[#d9fdd3] text-foreground dark:bg-emerald-900/50"
                                  : "rounded-bl-none bg-white dark:bg-card",
                              )}
                            >
                              {(msg.is_template || !!msg.meta_template_name) && (
                                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Template Meta
                                </span>
                              )}
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.body || "—"}</p>
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                <span>{format(at, "HH:mm", { locale: ptBR })}</span>
                                {out && <StatusIcon status={msg.status} />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {messages.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-10">
                          Nenhuma mensagem ainda
                        </p>
                      ) : null}
                    </div>
                  </ScrollArea>

                  {/* Composer */}
                  <footer className="border-t bg-card p-3">
                    {windowOpen ? (
                      <div className="mx-auto max-w-2xl space-y-2">
                        <p className="text-xs text-muted-foreground">
                          O cliente respondeu recentemente — você pode enviar texto livre (regra da Meta).
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" variant="ghost" size="icon" className="shrink-0" disabled>
                            <Paperclip className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="shrink-0" disabled>
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                          <Textarea
                            placeholder="Digite sua mensagem..."
                            className="min-h-[44px] resize-none"
                            rows={2}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                          <Button
                            type="button"
                            className="shrink-0 gap-1"
                            disabled={!draft.trim() || sending || !conversation.instance_id}
                            onClick={handleSendText}
                          >
                            <Send className="h-4 w-4" />
                            Enviar
                          </Button>
                        </div>
                        {!conversation.instance_id ? (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">
                            Esta conversa não está vinculada a uma instância (`instance_id` nulo). Não é possível responder.
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mx-auto max-w-2xl space-y-3">
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                          Passaram mais de 24h desde a última mensagem do cliente. Para falar de novo,
                          escolha um <strong>template aprovado</strong> na Meta.
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          <div className="flex-1 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Template</label>
                            {templates.length > 0 ? (
                              <Select
                                value={selectedTemplate}
                                onValueChange={(v) => {
                                  setSelectedTemplate(v);
                                  const t = templates.find((x) => x.name === v);
                                  if (t?.language) setTemplateLanguage(t.language);
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {templates.map((t) => (
                                    <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                                      {t.name} · {t.language}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                placeholder={templatesLoading ? "Carregando…" : "Digite o nome do template aprovado"}
                                value={selectedTemplate}
                                onChange={(e) => setSelectedTemplate(e.target.value)}
                              />
                            )}
                          </div>
                          <div className="w-full sm:w-[140px] space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Idioma</label>
                            <Input value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} placeholder="pt_BR" />
                          </div>
                          <Button
                            type="button"
                            className="gap-1 sm:mb-0.5"
                            disabled={sending || !conversation.instance_id}
                            onClick={handleSendTemplate}
                          >
                            <Send className="h-4 w-4" />
                            Enviar template
                          </Button>
                        </div>
                        <Textarea
                          disabled
                          placeholder="Texto livre desabilitado — aguardando resposta do cliente ou use template acima"
                          className="resize-none opacity-60"
                          rows={2}
                        />
                        {!conversation.instance_id ? (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">
                            Esta conversa não está vinculada a uma instância (`instance_id` nulo). Não é possível responder.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </footer>
                </div>

                {/* Painel lateral (placeholder real) */}
                <aside className="hidden w-[280px] flex-col border-l bg-muted/20 xl:flex">
                  <div className="border-b p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Vinculado no CRM
                    </p>
                    <p className="mt-1 font-semibold leading-snug">{conversation.card_id ? `Card ${conversation.card_id}` : "—"}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {conversation.card_id || "—"}
                    </p>
                  </div>
                  <ScrollArea className="flex-1 p-4">
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Módulo</dt>
                        <dd>
                          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", mod.className)}>
                            {mod.label}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Telefone (WhatsApp)</dt>
                        <dd>{formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}</dd>
                      </div>
                    </dl>
                  </ScrollArea>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>

      {!conversation?.instance_id ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Para responder no inbox, a conversa precisa ter `instance_id` preenchido (o webhook faz isso automaticamente quando encontra a instância Meta correta).
        </div>
      ) : null}
    </div>
  );
}

