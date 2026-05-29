/**
 * Demonstração visual do Inbox WhatsApp (API oficial Meta).
 * Dados fictícios — sem integração com webhook/Graph API.
 */
import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  User,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ModuleKey = "leads" | "cobrancas" | "renovacoes";

type MockMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  at: Date;
  status?: "sent" | "delivered" | "read";
  isTemplate?: boolean;
};

type MockConversation = {
  id: string;
  contactName: string;
  phone: string;
  module: ModuleKey;
  cardLabel: string;
  cardId: string;
  unread: number;
  lastPreview: string;
  lastAt: Date;
  windowOpen: boolean;
  windowExpiresAt?: Date;
  assignedTo: string;
  messages: MockMessage[];
};

const MODULE_STYLES: Record<ModuleKey, { label: string; className: string }> = {
  leads: { label: "Lead", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  cobrancas: { label: "Cobrança", className: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
  renovacoes: { label: "Renovação", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
};

const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: "1",
    contactName: "Maria Silva",
    phone: "+55 11 98765-4321",
    module: "cobrancas",
    cardLabel: "Parcela 2/6 em atraso",
    cardId: "cob-8842",
    unread: 2,
    lastPreview: "Posso pagar na sexta?",
    lastAt: new Date(Date.now() - 12 * 60 * 1000),
    windowOpen: true,
    windowExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    assignedTo: "Você",
    messages: [
      {
        id: "m1",
        direction: "out",
        body: "Olá Maria! Lembrete: a parcela de R$ 189,90 venceu ontem. Posso ajudar com o pagamento?",
        at: new Date(Date.now() - 3 * 60 * 60 * 1000),
        status: "read",
        isTemplate: true,
      },
      {
        id: "m2",
        direction: "in",
        body: "Oi! Vi a mensagem. Posso pagar na sexta?",
        at: new Date(Date.now() - 12 * 60 * 1000),
      },
      {
        id: "m3",
        direction: "in",
        body: "Vocês aceitam PIX?",
        at: new Date(Date.now() - 10 * 60 * 1000),
      },
    ],
  },
  {
    id: "2",
    contactName: "João Pedro",
    phone: "+55 21 99876-1234",
    module: "leads",
    cardLabel: "Orçamento armação premium",
    cardId: "lead-3310",
    unread: 0,
    lastPreview: "Obrigado, vou pensar.",
    lastAt: new Date(Date.now() - 28 * 60 * 60 * 1000),
    windowOpen: false,
    assignedTo: "Você",
    messages: [
      {
        id: "m4",
        direction: "out",
        body: "João, segue o orçamento que combinamos. Qualquer dúvida estou à disposição!",
        at: new Date(Date.now() - 30 * 60 * 60 * 1000),
        status: "delivered",
      },
      {
        id: "m5",
        direction: "in",
        body: "Obrigado, vou pensar.",
        at: new Date(Date.now() - 28 * 60 * 60 * 1000),
      },
    ],
  },
  {
    id: "3",
    contactName: "Ana Costa",
    phone: "+55 31 99111-2233",
    module: "renovacoes",
    cardLabel: "Renovação plano anual",
    cardId: "ren-120",
    unread: 0,
    lastPreview: "Template: lembrete_renovacao",
    lastAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    windowOpen: false,
    assignedTo: "Carla (gerente)",
    messages: [
      {
        id: "m6",
        direction: "out",
        body: "[Template aprovado] Olá Ana, sua renovação vence em 5 dias. Responda SIM para confirmar.",
        at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        status: "sent",
        isTemplate: true,
      },
    ],
  },
];

const TEMPLATES = [
  { id: "cobranca_lembrete", name: "cobranca_lembrete_v2", label: "Lembrete de parcela (Utility)" },
  { id: "renovacao_5d", name: "renovacao_5_dias", label: "Renovação — 5 dias (Utility)" },
  { id: "orcamento_follow", name: "followup_orcamento", label: "Follow-up orçamento (Marketing)" },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StatusIcon({ status }: { status?: MockMessage["status"] }) {
  if (!status) return null;
  if (status === "sent") return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
  return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
}

export default function WhatsAppInboxDemoPage() {
  const [selectedId, setSelectedId] = useState(MOCK_CONVERSATIONS[0].id);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "mine">("all");
  const [draft, setDraft] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);

  const conversation = useMemo(
    () => MOCK_CONVERSATIONS.find((c) => c.id === selectedId) ?? MOCK_CONVERSATIONS[0],
    [selectedId],
  );

  const filteredList = useMemo(() => {
    return MOCK_CONVERSATIONS.filter((c) => {
      if (filter === "unread" && c.unread === 0) return false;
      if (filter === "mine" && c.assignedTo !== "Você") return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        c.contactName.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.lastPreview.toLowerCase().includes(q)
      );
    });
  }, [search, filter]);

  const mod = MODULE_STYLES[conversation.module];

  return (
    <AppLayout>
      <div className="flex h-[calc(100dvh-4rem)] flex-col gap-3 p-4 lg:p-6">
        {/* Banner demo */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-950 dark:text-amber-100">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Demonstração visual</strong> — inbox WhatsApp API oficial (Meta). Use esta tela na
            gravação do vídeo para revisão do app Meta. Mensagens e
            status são fictícios; na versão real chegam via webhook.
          </span>
          <Badge variant="outline" className="ml-auto gap-1 border-emerald-600/50 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" />
            API Oficial Meta
          </Badge>
        </div>

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
                  const m = MODULE_STYLES[c.module];
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
                            {initials(c.contactName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{c.contactName}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {formatDistanceToNow(c.lastAt, { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{c.lastPreview}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", m.className)}>
                              {m.label}
                            </span>
                            {!c.windowOpen && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                Fora da janela 24h
                              </span>
                            )}
                          </div>
                        </div>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                            {c.unread}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </aside>

          {/* Thread + painel lateral */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Cabeçalho da conversa */}
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback>{initials(conversation.contactName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{conversation.contactName}</h2>
                  <span className={cn("rounded px-2 py-0.5 text-xs font-medium", mod.className)}>
                    {mod.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{conversation.phone}</p>
              </div>
              {conversation.windowOpen ? (
                <Badge variant="secondary" className="gap-1 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                  <Clock className="h-3 w-3" />
                  Janela 24h aberta
                  {conversation.windowExpiresAt && (
                    <span className="font-normal opacity-80">
                      · até {format(conversation.windowExpiresAt, "HH:mm", { locale: ptBR })}
                    </span>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-amber-900 dark:text-amber-100">
                  <FileText className="h-3 w-3" />
                  Só template aprovado
                </Badge>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" type="button">
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir card
              </Button>
            </header>

            <div className="flex min-h-0 flex-1">
              {/* Mensagens */}
              <div className="flex min-w-0 flex-1 flex-col bg-[#e5ddd5]/30 dark:bg-muted/20">
                <ScrollArea className="flex-1 p-4">
                  <div className="mx-auto max-w-2xl space-y-3">
                    <p className="text-center text-[11px] text-muted-foreground">
                      Hoje · número oficial Ótica Demo (+55 11 4000-0000)
                    </p>
                    {conversation.messages.map((msg) => {
                      const out = msg.direction === "out";
                      return (
                        <div
                          key={msg.id}
                          className={cn("flex", out ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "relative max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
                              out
                                ? "rounded-br-none bg-[#d9fdd3] text-foreground dark:bg-emerald-900/50"
                                : "rounded-bl-none bg-white dark:bg-card",
                            )}
                          >
                            {msg.isTemplate && (
                              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Template Meta
                              </span>
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                            <div
                              className={cn(
                                "mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground",
                              )}
                            >
                              <span>{format(msg.at, "HH:mm", { locale: ptBR })}</span>
                              {out && <StatusIcon status={msg.status} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Composer */}
                <footer className="border-t bg-card p-3">
                  {conversation.windowOpen ? (
                    <div className="mx-auto max-w-2xl space-y-2">
                      <p className="text-xs text-muted-foreground">
                        O cliente respondeu recentemente — você pode enviar texto livre (regra da Meta).
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="ghost" size="icon" className="shrink-0">
                          <Paperclip className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="shrink-0">
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                        <Textarea
                          placeholder="Digite sua mensagem..."
                          className="min-h-[44px] resize-none"
                          rows={2}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <Button type="button" className="shrink-0 gap-1" disabled={!draft.trim()}>
                          <Send className="h-4 w-4" />
                          Enviar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-2xl space-y-3">
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                        Passaram mais de 24h desde a última mensagem do cliente. Para falar de novo,
                        escolha um <strong>template aprovado</strong> na Meta (Utility para cobrança,
                        Marketing só com opt-in).
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Template
                          </label>
                          <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TEMPLATES.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" className="gap-1 sm:mb-0.5">
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
                    </div>
                  )}
                </footer>
              </div>

              {/* Painel do card CRM */}
              <aside className="hidden w-[280px] flex-col border-l bg-muted/20 xl:flex">
                <div className="border-b p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Vinculado no CRM
                  </p>
                  <p className="mt-1 font-semibold leading-snug">{conversation.cardLabel}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {conversation.cardId}
                  </p>
                </div>
                <ScrollArea className="flex-1 p-4">
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Responsável</dt>
                      <dd className="flex items-center gap-1.5 font-medium">
                        <User className="h-3.5 w-3.5" />
                        {conversation.assignedTo}
                      </dd>
                    </div>
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
                      <dd>{conversation.phone}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Opt-in marketing</dt>
                      <dd className="text-emerald-600 dark:text-emerald-400">Sim · cadastro 12/03/2026</dd>
                    </div>
                  </dl>
                  <div className="mt-6 space-y-2">
                    <Button variant="secondary" className="w-full text-xs" type="button">
                      Ver histórico no card
                    </Button>
                    <Button variant="outline" className="w-full text-xs" type="button">
                      Mover status
                    </Button>
                  </div>
                </ScrollArea>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
