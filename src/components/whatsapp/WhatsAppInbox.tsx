import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  inboxDisplayModuleForConversation,
  inboxModuleForConversation,
  isCobrancaInboxUser,
  shouldUseCobrancaInboxPanel,
} from "@/lib/pagePermissions";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import WhatsAppMediaMessage from "@/components/whatsapp/WhatsAppMediaMessage";
import WhatsAppCreateLeadPanel from "@/components/whatsapp/WhatsAppCreateLeadPanel";
import WhatsAppCobrancaPanel from "@/components/whatsapp/WhatsAppCobrancaPanel";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Info,
  Mic,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  Bell,
  BellOff,
  Trash2,
  UserCheck,
  UserX,
  Bot,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getNotificationPermission,
  requestWhatsAppNotificationPermission,
  setWhatsAppInboxSession,
} from "@/lib/whatsappInboxNotifications";
import { isWhatsAppInboxRealtimeEnabled } from "@/lib/runtime-config";
import { needsWhatsAppAudioConversion, prepareAudioFileForWhatsApp } from "@/lib/convertAudioForWhatsApp";

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
  last_message_direction: "in" | "out" | null;
  last_read_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  status: "pending" | "open" | "closed";
  ai_active?: boolean;
  ai_enabled?: boolean;
  routed_to_company_id?: string | null;
  instance_name?: string | null;
  instance_display_phone?: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  status: string | null;
  is_template: boolean;
  meta_template_name: string | null;
  message_type?: string | null;
  media_type?: string | null;
  media_mime?: string | null;
  media_filename?: string | null;
  media_size?: number | null;
  media_id?: string | null;
  caption?: string | null;
  sent_by?: string | null;
  sent_by_name?: string | null;
  created_at: string;
};

function formatAttendantLabel(name: string | null | undefined): string {
  const n = (name || "").trim();
  return n ? `Atendente ${n}` : "Atendente";
}

type TemplateRow = { name: string; status: string; category: string; language: string };

type WaInstanceRow = {
  id: string;
  name: string;
  display_phone: string | null;
  phone_number_id: string | null;
};

function formatInstanceShort(inst: WaInstanceRow | undefined): string {
  if (!inst) return "Número não identificado";
  const phone = inst.display_phone?.trim();
  if (phone && phone !== "—") return `${inst.name} · ${phone}`;
  return inst.name;
}

/**
 * Quando a conversa foi encaminhada de outra empresa (ou pertence a uma
 * instância de pool sem empresa), instancesById não tem o registro — só
 * lista instâncias da PRÓPRIA empresa. Usa o nome/telefone que já vêm
 * embutidos na própria conversa (via RPC) como fallback.
 */
function resolveInstanceForDisplay(
  conversation: { instance_id: string | null; instance_name?: string | null; instance_display_phone?: string | null },
  instancesById: Record<string, WaInstanceRow>,
): WaInstanceRow | undefined {
  if (!conversation.instance_id) return undefined;
  const known = instancesById[conversation.instance_id];
  if (known) return known;
  if (!conversation.instance_name) return undefined;
  return {
    id: conversation.instance_id,
    name: conversation.instance_name,
    display_phone: conversation.instance_display_phone ?? null,
    phone_number_id: null,
  };
}

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

async function parseSendError(
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
    return "Falha ao enviar. Veja Network → whatsapp-chat → Response (token Meta, janela 24h ou template).";
  }
  return error?.message || "Erro ao enviar";
}

function sortConversations(rows: ConversationRow[]): ConversationRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return tb - ta;
  });
}

function formatUnreadCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

function getConversationUnreadState(
  c: ConversationRow,
  selectedId: string | null,
  localBoost = 0,
): { show: boolean; count: number } {
  if (c.id === selectedId) return { show: false, count: 0 };

  const unread = Math.max(Math.max(0, Number(c.unread_count) || 0), localBoost);
  if (unread > 0) return { show: true, count: unread };

  // Encaminhada para esta empresa — precisa de atenção mesmo que a última
  // mensagem tenha sido enviada pela empresa de origem (não pelo cliente).
  if (c.status === "pending" && c.routed_to_company_id) return { show: true, count: 1 };

  if (c.last_message_direction === "in" && c.last_message_at) {
    const lastMsgAt = new Date(c.last_message_at).getTime();
    const lastReadAt = c.last_read_at ? new Date(c.last_read_at).getTime() : 0;
    if (lastReadAt < lastMsgAt) return { show: true, count: 1 };
  }

  return { show: false, count: 0 };
}

function inboundMessagePreview(row: MessageRow): string {
  return (
    row.body?.trim() ||
    row.caption?.trim() ||
    (row.media_type === "audio"
      ? "🎤 Áudio"
      : row.media_type === "image"
        ? "📷 Imagem"
        : row.media_type
          ? "📎 Anexo"
          : "Nova mensagem")
  );
}

export default function WhatsAppInbox() {
  const { user, isAdmin, isGerente, isFinanceiro, canAccessPath } = useAuth();
  const [searchParams] = useSearchParams();
  const selectedIdRef = useRef<string | null>(null);
  const pinnedToBottomRef = useRef<boolean>(true);
  const conversationsRef = useRef<ConversationRow[]>([]);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"pending" | "mine" | "all">("pending");
  const [localUnreadBoost, setLocalUnreadBoost] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioDraft, setAudioDraft] = useState<{
    url: string;
    blob: Blob;
    mime: string;
    filename: string;
  } | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateLanguage, setTemplateLanguage] = useState<string>("pt_BR");
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [instancesById, setInstancesById] = useState<Record<string, WaInstanceRow>>({});
  const [cobrancaInstanceIds, setCobrancaInstanceIds] = useState<Set<string>>(() => new Set());
  const [notifyPermission, setNotifyPermission] = useState(() => getNotificationPermission());
  /** Onde o painel lateral encontrou o card (cobrança / renovação / lead). */
  const [panelResolvedModule, setPanelResolvedModule] = useState<ModuleKey | null>(null);

  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [conversationActionLoading, setConversationActionLoading] = useState<"accept" | "close" | "route-company" | "ai-on" | "ai-off" | null>(null);
  const [routeCompanyOpen, setRouteCompanyOpen] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [routeCompanyTarget, setRouteCompanyTarget] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const getMessagesViewport = useCallback((): HTMLDivElement | null => {
    const root = messagesAreaRef.current;
    if (!root) return null;
    return root.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = getMessagesViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, [getMessagesViewport]);

  const recomputePinnedToBottom = useCallback(() => {
    const viewport = getMessagesViewport();
    if (!viewport) return;
    const thresholdPx = 140;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setPinnedToBottom(distanceFromBottom <= thresholdPx);
  }, [getMessagesViewport]);

  const cobrancaInboxMode = useMemo(
    () => isCobrancaInboxUser({ isFinanceiro, canAccessPath }),
    [isFinanceiro, canAccessPath],
  );

  const conversationPanelContext = useMemo(() => {
    if (!conversation) return { useCobrancaPanel: cobrancaInboxMode, moduleKey: "leads" as ModuleKey };
    const inst = conversation.instance_id ? instancesById[conversation.instance_id] : undefined;
    return {
      useCobrancaPanel: shouldUseCobrancaInboxPanel({
        dedicatedCobrancaUser: cobrancaInboxMode,
        conversationModule: conversation.module,
        instanceId: conversation.instance_id,
        cobrancaInstanceIds,
        instanceName: inst?.name ?? null,
      }),
      moduleKey: inboxModuleForConversation({
        dedicatedCobrancaUser: cobrancaInboxMode,
        storedModule: conversation.module,
        instanceId: conversation.instance_id,
        cobrancaInstanceIds,
        instanceName: inst?.name ?? null,
      }),
    };
  }, [conversation, cobrancaInboxMode, cobrancaInstanceIds, instancesById]);

  useEffect(() => {
    setPanelResolvedModule(null);
  }, [conversation?.id]);

  const displayModuleKey = useMemo((): ModuleKey => {
    if (!conversation) return conversationPanelContext.moduleKey;
    if (panelResolvedModule) return panelResolvedModule;
    return inboxDisplayModuleForConversation({
      dedicatedCobrancaUser: cobrancaInboxMode,
      storedModule: conversation.module,
      cardId: conversation.card_id,
      instanceId: conversation.instance_id,
      cobrancaInstanceIds,
      instanceName: conversation.instance_id
        ? instancesById[conversation.instance_id]?.name ?? null
        : null,
    });
  }, [
    conversation,
    panelResolvedModule,
    conversationPanelContext.moduleKey,
    cobrancaInboxMode,
    cobrancaInstanceIds,
    instancesById,
  ]);

  const mod = MODULE_STYLES[displayModuleKey];
  const useCobrancaPanel = conversationPanelContext.useCobrancaPanel;
  const windowOpen = useMemo(() => {
    if (!conversation?.window_expires_at) return false;
    return new Date(conversation.window_expires_at).getTime() > Date.now();
  }, [conversation?.window_expires_at]);

  const canReplyConversation = useMemo(
    () => !!conversation && conversation.status === "open" && conversation.assigned_to === user?.id,
    [conversation, user?.id],
  );

  const resolveUnreadState = useCallback(
    (c: ConversationRow) => getConversationUnreadState(c, selectedId, localUnreadBoost[c.id] || 0),
    [localUnreadBoost, selectedId],
  );

  const isPrivileged = isAdmin;

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (view === "pending" && !(c.status === "pending" && c.last_message_direction === "in")) return false;
      if (view === "mine" && !(c.status === "open" && c.assigned_to === user?.id)) return false;
      // "Todos" = para admin, literalmente todas as conversas de todas as
      // empresas (visão geral). Para os demais usuários, só as conversas que
      // eles mesmos fecharam — conversas encaminhadas para outra empresa não
      // entram aqui, pois ao encaminhar o assigned_to deixa de ser o usuário
      // e o status volta para "pending" (não "closed").
      if (view === "all" && !isAdmin && !(c.status === "closed" && c.assigned_to === user?.id)) {
        return false;
      }
      if (!q) return true;
      const name = (c.contact_name || "").toLowerCase();
      const wa = (c.wa_id || "").toLowerCase();
      const preview = (c.last_preview || "").toLowerCase();
      return name.includes(q) || wa.includes(q) || preview.includes(q);
    });
  }, [conversations, view, search, user?.id, isAdmin]);

  // Renderizar as ~1900 linhas de "Todos" de uma vez (cada uma com ícones,
  // badges, formatação de data) deixa a tela lenta/travando o tempo de tela
  // (DOM grande, sem virtualização) — mostra só um lote por vez, com botão
  // pra carregar mais. Reinicia o lote ao trocar de aba ou buscar.
  const PAGE_SIZE = 150;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [view, search]);
  const visibleList = useMemo(() => filteredList.slice(0, visibleCount), [filteredList, visibleCount]);

  const pendingConversationsCount = useMemo(
    () => conversations.filter((c) => c.status === "pending" && c.last_message_direction === "in").length,
    [conversations],
  );

  const mineConversationsCount = useMemo(
    () => conversations.filter((c) => c.status === "open" && c.assigned_to === user?.id).length,
    [conversations, user?.id],
  );

  const closedMineConversationsCount = useMemo(
    () => conversations.filter((c) => c.status === "closed" && c.assigned_to === user?.id).length,
    [conversations, user?.id],
  );

  const allTabCount = isAdmin ? conversations.length : closedMineConversationsCount;

  const inboxTabs = useMemo((): { key: "pending" | "mine" | "all"; label: string }[] => [
    { key: "pending", label: pendingConversationsCount > 0 ? `Pendentes (${pendingConversationsCount})` : "Pendentes" },
    { key: "mine", label: mineConversationsCount > 0 ? `Ativos (${mineConversationsCount})` : "Ativos" },
    { key: "all", label: allTabCount > 0 ? `Todos (${allTabCount})` : "Todos" },
  ], [pendingConversationsCount, mineConversationsCount, allTabCount]);

  const loadInstances = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_whatsapp_instances_for_inbox");
    if (error) {
      console.warn("list_whatsapp_instances_for_inbox:", error.message);
      const fallback = await supabase
        .from("whatsapp_instances")
        .select("id, name, display_phone, phone_number_id")
        .eq("is_active", true);
      if (fallback.error) {
        console.warn("whatsapp_instances:", fallback.error.message);
        return;
      }
      const map: Record<string, WaInstanceRow> = {};
      for (const row of fallback.data || []) {
        map[row.id] = row as WaInstanceRow;
      }
      setInstancesById(map);
      return;
    }
    const map: Record<string, WaInstanceRow> = {};
    for (const row of data || []) {
      map[row.id] = row as WaInstanceRow;
    }
    setInstancesById(map);
  }, []);

  const loadCobrancaInstanceIds = useCallback(async () => {
    const [{ data: setting }, { data: instances }] = await Promise.all([
      supabase
        .from("system_settings")
        .select("setting_value")
        .eq("setting_key", "whatsapp_cobrancas_sessions")
        .maybeSingle(),
      supabase.from("whatsapp_instances").select("id, session, name").eq("is_active", true),
    ]);

    let configuredSessions: string[] = [];
    const raw = setting?.setting_value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          configuredSessions = parsed.filter((s: unknown) => typeof s === "string" && s.trim());
        }
      } catch {
        configuredSessions = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    const ids = new Set<string>();
    for (const row of instances || []) {
      if (configuredSessions.includes(row.session)) ids.add(row.id);
      const name = (row.name || "").toLowerCase();
      if (name.includes("cobran")) ids.add(row.id);
    }
    setCobrancaInstanceIds(ids);
  }, []);

  const conversationInstanceLabel = useMemo(() => {
    if (!conversation?.instance_id) return null;
    return formatInstanceShort(resolveInstanceForDisplay(conversation, instancesById));
  }, [conversation, instancesById]);

  const loadConversations = useCallback(async () => {
    const extendedCols =
      "id, instance_id, wa_id, contact_name, phone_display, module, card_id, window_expires_at, last_message_at, last_preview, unread_count, last_message_direction, last_read_at, assigned_to, status, routed_to_company_id";
    const basicCols =
      "id, instance_id, wa_id, contact_name, phone_display, module, card_id, window_expires_at, last_message_at, last_preview, unread_count, assigned_to, status, routed_to_company_id";

    let rows: ConversationRow[] | null = null;

    const rpc = await supabase.rpc("list_whatsapp_inbox_conversations", { p_limit: 2000 });
    if (!rpc.error && rpc.data) {
      rows = rpc.data as ConversationRow[];
    }

    if (!rows) {
      let { data, error } = await supabase
        .from("whatsapp_conversations")
        .select(extendedCols)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);

      if (error) {
        const fallback = await supabase
          .from("whatsapp_conversations")
          .select(basicCols)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(200);
        if (fallback.error) throw fallback.error;
        data = (fallback.data || []).map((row) => ({
          ...row,
          last_message_direction: null,
          last_read_at: null,
        }));
      }
      rows = (data || []).map((row) => ({
        ...row,
        status: (row as { status?: ConversationRow["status"] }).status ?? "pending",
        assigned_to_name: null,
      })) as ConversationRow[];
    }

    setConversations((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      const merged = rows!.map((row) => {
        const local = prevById.get(row.id);
        const dbUnread = Math.max(0, Number(row.unread_count) || 0);
        const localUnread = Math.max(0, Number(local?.unread_count) || 0);
        if (localUnread > dbUnread) return { ...row, unread_count: localUnread };
        return { ...row, unread_count: dbUnread };
      });
      return sortConversations(merged);
    });

    setLocalUnreadBoost((prev) => {
      const next = { ...prev };
      for (const row of rows!) {
        const dbUnread = Math.max(0, Number(row.unread_count) || 0);
        if (dbUnread >= (next[row.id] || 0)) delete next[row.id];
      }
      return next;
    });
    // Não abre a primeira conversa automaticamente — assim o contador de não lidas permanece visível.
  }, []);

  const handleLeadLinked = useCallback(
    (
      conversationId: string,
      patch: { card_id: string | null; contact_name: string | null; module: string | null },
    ) => {
      const moduleKey =
        patch.module === "cobrancas" || patch.module === "renovacoes" || patch.module === "leads"
          ? (patch.module as ModuleKey)
          : null;
      if (moduleKey) setPanelResolvedModule(moduleKey);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, card_id: patch.card_id, contact_name: patch.contact_name, module: patch.module }
            : c,
        ),
      );
    },
    [],
  );

  const markAsRead = useCallback(async (conversationId: string) => {
    const readAt = new Date().toISOString();
    setLocalUnreadBoost((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0, last_read_at: readAt } : c,
      ),
    );
    const { error } = await supabase.rpc("mark_whatsapp_conversation_read", {
      p_conversation_id: conversationId,
    });
    if (error) console.warn("mark_whatsapp_conversation_read:", error.message);
  }, []);

  const applyConversationPatch = useCallback((row: ConversationRow) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id);
      const prevRow = idx >= 0 ? prev[idx] : null;
      const merged: ConversationRow = prevRow ? { ...prevRow, ...row } : row;

      const dbUnread = Math.max(0, Number(row.unread_count) || 0);
      const prevUnread = Math.max(0, Number(prevRow?.unread_count) || 0);
      const incomingReadAt = row.last_read_at ? new Date(row.last_read_at).getTime() : 0;
      const prevReadAt = prevRow?.last_read_at ? new Date(prevRow.last_read_at).getTime() : 0;
      const explicitlyRead = dbUnread === 0 && incomingReadAt > prevReadAt;

      if (prevRow && !explicitlyRead) {
        merged.unread_count = Math.max(prevUnread, dbUnread);
      }

      if (!row.last_message_direction && prevRow?.last_message_direction) {
        merged.last_message_direction = prevRow.last_message_direction;
      }

      // `assigned_to_name` não existe na tabela (vem só da RPC de listagem) — payloads de
      // realtime não trazem esse campo. Preserva o nome anterior se o responsável não mudou,
      // senão limpa (a reconciliação periódica busca o nome correto).
      if (row.assigned_to_name === undefined) {
        merged.assigned_to_name = prevRow?.assigned_to === row.assigned_to ? prevRow?.assigned_to_name ?? null : null;
      }

      // Mantém contador local se o payload realtime vier sem unread_count (replica parcial).
      if (
        (row.unread_count === undefined || row.unread_count === null) &&
        prevRow &&
        prevRow.unread_count > 0
      ) {
        merged.unread_count = prevRow.unread_count;
      }

      const next = idx >= 0
        ? prev.map((c, i) => (i === idx ? merged : c))
        : [merged, ...prev];
      return sortConversations(next);
    });
  }, []);

  const currentUserName = useMemo(() => {
    const meta = user?.user_metadata as { full_name?: string; name?: string } | undefined;
    return meta?.full_name || meta?.name || user?.email || null;
  }, [user]);

  const handleAcceptConversation = useCallback(async () => {
    if (!conversation) return;
    setConversationActionLoading("accept");
    try {
      const { error } = await supabase.rpc("accept_whatsapp_conversation", {
        p_conversation_id: conversation.id,
      });
      if (error) throw error;
      applyConversationPatch({
        ...conversation,
        status: "open",
        assigned_to: user?.id ?? null,
        assigned_to_name: currentUserName,
        ai_active: false,
      });
      setView("mine");
      toast.success("Atendimento aceito");
      if (conversation.ai_enabled) toast.info("Agente de IA pausado nesta conversa.");
      void loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao aceitar conversa");
      void loadConversations();
    } finally {
      setConversationActionLoading(null);
    }
  }, [conversation, applyConversationPatch, user?.id, currentUserName, loadConversations]);

  const handleReopenConversation = useCallback(async () => {
    if (!conversation) return;
    setConversationActionLoading("accept");
    try {
      const { error } = await supabase.rpc("reopen_whatsapp_conversation", {
        p_conversation_id: conversation.id,
      });
      if (error) throw error;
      applyConversationPatch({
        ...conversation,
        status: "open",
        assigned_to: user?.id ?? null,
        assigned_to_name: currentUserName,
      });
      setView("mine");
      toast.success("Atendimento reaberto");
      void loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao reabrir conversa");
      void loadConversations();
    } finally {
      setConversationActionLoading(null);
    }
  }, [conversation, applyConversationPatch, user?.id, currentUserName, loadConversations]);

  const handleToggleAi = useCallback(async (active: boolean) => {
    if (!conversation) return;
    setConversationActionLoading(active ? "ai-on" : "ai-off");
    try {
      const { error } = await supabase.rpc("set_whatsapp_conversation_ai_active", {
        p_conversation_id: conversation.id,
        p_active: active,
      });
      if (error) throw error;
      applyConversationPatch({ ...conversation, ai_active: active });
      toast.success(active ? "IA reativada nesta conversa." : "IA pausada nesta conversa.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar a IA");
    } finally {
      setConversationActionLoading(null);
    }
  }, [conversation, applyConversationPatch]);

  const handleCloseConversation = useCallback(async () => {
    if (!conversation) return;
    setConversationActionLoading("close");
    try {
      const { error } = await supabase.rpc("close_whatsapp_conversation", {
        p_conversation_id: conversation.id,
      });
      if (error) throw error;
      applyConversationPatch({ ...conversation, status: "closed" });
      toast.success("Atendimento encerrado");
      void loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao encerrar conversa");
      void loadConversations();
    } finally {
      setConversationActionLoading(null);
    }
  }, [conversation, applyConversationPatch, loadConversations]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("list_companies_for_whatsapp_routing").then(({ data }) => {
      if (!cancelled) setCompanies((data || []) as { id: string; name: string }[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenRouteToCompany = useCallback(() => {
    setRouteCompanyTarget("");
    setRouteCompanyOpen(true);
  }, []);

  const handleRouteToCompany = useCallback(async () => {
    if (!conversation || !routeCompanyTarget) return;
    setConversationActionLoading("route-company");
    try {
      const { error } = await supabase.rpc("route_whatsapp_conversation_to_company", {
        p_conversation_id: conversation.id,
        p_company_id: routeCompanyTarget,
      });
      if (error) throw error;
      const target = companies.find((c) => c.id === routeCompanyTarget);
      setRouteCompanyOpen(false);
      toast.success(`Conversa encaminhada para ${target?.name || "a empresa selecionada"}`);
      setSelectedId(null);
      void loadConversations();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao encaminhar conversa");
      void loadConversations();
    } finally {
      setConversationActionLoading(null);
    }
  }, [conversation, routeCompanyTarget, companies, loadConversations]);

  const handleDeleteMessage = useCallback(async () => {
    if (!deletingMsgId) return;
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-chat", {
        body: { action: "delete-message", message_id: deletingMsgId },
      });
      const errMsg = (data as { error?: string } | null)?.error || error?.message;
      if (errMsg) throw new Error(errMsg);
      setMessages((prev) => prev.filter((m) => m.id !== deletingMsgId));
      toast.success("Mensagem removida do histórico do CRM.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir mensagem");
    } finally {
      setDeletingMsgId(null);
      setDeleteLoading(false);
    }
  }, [deletingMsgId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const extendedCols =
      "id, conversation_id, direction, body, status, is_template, meta_template_name, message_type, media_type, media_mime, media_filename, media_size, media_id, caption, sent_by, sent_by_name, created_at";
    const basicCols =
      "id, conversation_id, direction, body, status, is_template, meta_template_name, created_at";

    let { data, error } = await supabase
      .from("whatsapp_messages")
      .select(extendedCols)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      const fallback = await supabase
        .from("whatsapp_messages")
        .select(basicCols)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (fallback.error) throw fallback.error;
      data = fallback.data;
    }

    setMessages((data || []) as MessageRow[]);
  }, []);

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
        await Promise.all([loadConversations(), loadTemplates(), loadInstances(), loadCobrancaInstanceIds()]);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar inbox");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadConversations]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const fromUrl = searchParams.get("c");
    if (fromUrl) setSelectedId(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    setWhatsAppInboxSession(true, selectedId);
    return () => setWhatsAppInboxSession(false, null);
  }, [selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    pinnedToBottomRef.current = pinnedToBottom;
  }, [pinnedToBottom]);

  const handleEnableNotifications = useCallback(async () => {
    const ok = await requestWhatsAppNotificationPermission();
    setNotifyPermission(getNotificationPermission());
    if (ok) toast.success("Avisos de mensagem ativados neste navegador");
    else toast.error("Permissão de notificação negada ou indisponível");
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    void markAsRead(selectedId);
    // Ao abrir uma conversa, fixa no fim (UX igual WhatsApp).
    setPinnedToBottom(true);
    queueMicrotask(() => scrollToBottom("auto"));
  }, [selectedId, loadMessages, markAsRead]);

  useEffect(() => {
    const viewport = getMessagesViewport();
    if (!viewport) return;
    const handler = () => recomputePinnedToBottom();
    viewport.addEventListener("scroll", handler, { passive: true });
    // Inicializa estado com a posição atual
    handler();
    return () => viewport.removeEventListener("scroll", handler);
  }, [getMessagesViewport, recomputePinnedToBottom, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (!pinnedToBottom) return;
    scrollToBottom("smooth");
  }, [messages.length, pinnedToBottom, scrollToBottom, selectedId]);

  useEffect(() => {
    if (!isWhatsAppInboxRealtimeEnabled()) {
      const poll = setInterval(() => {
        void loadConversations();
      }, 12_000);
      return () => clearInterval(poll);
    }

    const channel = supabase
      .channel("whatsapp-inbox-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        (payload: RealtimePostgresChangesPayload<ConversationRow>) => {
          if (payload.eventType === "DELETE" && payload.old) {
            const old = payload.old as ConversationRow;
            setConversations((prev) => prev.filter((c) => c.id !== old.id));
            if (selectedIdRef.current === old.id) setSelectedId(null);
            return;
          }
          if (payload.new) {
            const row = payload.new as ConversationRow;
            const openId = selectedIdRef.current;
            if (openId === row.id && getConversationUnreadState(row, null, localUnreadBoost[row.id] || 0).show) {
              void markAsRead(row.id);
              applyConversationPatch({ ...row, unread_count: 0, last_read_at: new Date().toISOString() });
            } else {
              applyConversationPatch(row);
            }
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const row = payload.new as MessageRow | null;
          if (!row) return;
          const openId = selectedIdRef.current;
          if (openId === row.conversation_id) {
            setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
            void markAsRead(row.conversation_id);
            // Se o usuário estiver no fim, acompanha a mensagem nova.
            // Se ele tiver subido para ler histórico, não puxa.
            if (pinnedToBottomRef.current) queueMicrotask(() => scrollToBottom("smooth"));
            return;
          }

          if (row.direction === "in") {
            const preview = inboundMessagePreview(row);
            setLocalUnreadBoost((prev) => ({
              ...prev,
              [row.conversation_id]: (prev[row.conversation_id] || 0) + 1,
            }));
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === row.conversation_id);
              if (idx < 0) {
                void loadConversations();
                return prev;
              }
              const next = prev.map((c, i) =>
                i === idx
                  ? {
                      ...c,
                      unread_count: (c.unread_count || 0) + 1,
                      last_message_direction: "in" as const,
                      last_preview: preview,
                      last_message_at: row.created_at || c.last_message_at,
                    }
                  : c,
              );
              return sortConversations(next);
            });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const row = payload.new as MessageRow | null;
          if (!row || row.conversation_id !== selectedIdRef.current) return;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadConversations();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applyConversationPatch, loadConversations, markAsRead]);

  // Reconciliação periódica: RLS não envia DELETE quando uma conversa some por ter sido
  // aceita/transferida por outro atendente, então recarregamos a lista para refletir isso.
  useEffect(() => {
    const reconcile = setInterval(() => {
      void loadConversations();
    }, 30_000);
    return () => clearInterval(reconcile);
  }, [loadConversations]);

  const handleSendText = async () => {
    if (!conversation?.id) return;
    if (!draft.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-chat", {
        body: { action: "send-text", conversation_id: conversation.id, text: draft.trim() },
      });
      if (error) throw new Error(await parseSendError(data, error));
      if ((data as any)?.error) throw new Error((data as any).error);
      setDraft("");
      await loadMessages(conversation.id);
      // Não recarrega a lista inteira de conversas aqui: whatsapp-chat já
      // atualiza a linha em whatsapp_conversations no servidor, e o canal
      // realtime já assinado (applyConversationPatch) reflete isso sozinho.
      // Um loadConversations() completo a cada envio refaz a query pesada
      // de até 2000 conversas (com JOIN LATERAL por linha) e re-ordena tudo
      // no cliente — em contas com muitas conversas isso trava a tela
      // quando o usuário manda mensagem rápido pra pessoas diferentes.
      setPinnedToBottom(true);
      queueMicrotask(() => scrollToBottom("smooth"));
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
      if (error) throw new Error(await parseSendError(data, error));
      if ((data as any)?.error) throw new Error((data as any).error);
      await loadMessages(conversation.id);
      // Mesma razão do handleSendText: a lista já se atualiza via realtime.
      setPinnedToBottom(true);
      queueMicrotask(() => scrollToBottom("smooth"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar template");
    } finally {
      setSending(false);
    }
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  const mapFileToMediaType = (file: File): "image" | "audio" | "video" | "document" => {
    const mt = (file.type || "").toLowerCase();
    if (mt.startsWith("image/")) return "image";
    if (mt.startsWith("audio/")) return "audio";
    if (mt.startsWith("video/")) return "video";
    return "document";
  };

  const handleSendFile = async (file: File) => {
    if (!conversation?.id) return;
    if (!conversation.instance_id) {
      toast.error("Conversa sem instance_id — não é possível enviar");
      return;
    }
    setUploading(true);
    try {
      let uploadFile = file;
      if (mapFileToMediaType(file) === "audio" && needsWhatsAppAudioConversion(file.type || "")) {
        uploadFile = await prepareAudioFileForWhatsApp(file);
      }
      const base64 = await fileToBase64(uploadFile);
      const mediaType = mapFileToMediaType(uploadFile);
      const { data, error } = await supabase.functions.invoke("whatsapp-chat", {
        body: {
          action: "send-media",
          conversation_id: conversation.id,
          media_type: mediaType,
          mime_type: uploadFile.type || "application/octet-stream",
          filename: uploadFile.name || "upload",
          base64,
          caption: draft.trim() || undefined,
        },
      });
      if (error) throw new Error(await parseSendError(data, error));
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setDraft("");
      await loadMessages(conversation.id);
      // Mesma razão de handleSendText: a lista já se atualiza via realtime.
      setPinnedToBottom(true);
      queueMicrotask(() => scrollToBottom("smooth"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar anexo");
    } finally {
      setUploading(false);
    }
  };

  const stopRecording = async () => {
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
  };

  const clearAudioDraft = useCallback(() => {
    setAudioDraft((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const startRecording = async () => {
    if (!conversation?.id) return;
    if (recording) return;
    if (audioDraft) clearAudioDraft();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;

      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      recorderChunksRef.current = [];
      setRecordSeconds(0);
      setRecording(true);

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recorderChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        const rawBlob = new Blob(recorderChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recorderChunksRef.current = [];
        if (rawBlob.size === 0) return;

        let blob: Blob = rawBlob;
        let mime = rawBlob.type || "audio/ogg";
        let filename = `audio-${Date.now()}.${mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : "audio"}`;

        if (needsWhatsAppAudioConversion(mime)) {
          setUploading(true);
          try {
            const converted = await prepareAudioFileForWhatsApp(
              new File([rawBlob], filename, { type: mime }),
            );
            blob = converted;
            mime = converted.type;
            filename = converted.name;
          } catch (e: unknown) {
            toast.error(
              e instanceof Error
                ? e.message
                : "Não foi possível converter o áudio gravado. Tente outro navegador ou envie um .mp3/.ogg.",
            );
            return;
          } finally {
            setUploading(false);
          }
        }

        const url = URL.createObjectURL(blob);
        setAudioDraft({ url, blob, mime, filename });
      };
      rec.start(250);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Permissão de microfone negada");
    }
  };

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  useEffect(() => {
    return () => {
      // cleanup object url if component unmounts
      if (audioDraft?.url) URL.revokeObjectURL(audioDraft.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Conteúdo "Vinculado no CRM" — reaproveitado no painel lateral (desktop)
  // e dentro da folha de informações do cliente (mobile).
  const crmPanelInner = conversation ? (
    <div className="min-w-0 space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Vinculado no CRM
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Módulo</dt>
            <dd className="mt-0.5">
              <span className={cn("rounded px-2 py-0.5 text-xs font-medium", mod.className)}>
                {mod.label}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Nossa linha (recebe/envia)</dt>
            <dd className="mt-0.5 text-xs font-medium text-sky-800 dark:text-sky-300 break-words">
              {conversationInstanceLabel || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Telefone do cliente</dt>
            <dd className="mt-0.5 font-medium text-amber-700 dark:text-amber-300 break-words">
              {formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
            </dd>
          </div>
        </dl>
      </div>
      {isAdmin || isGerente ? (
        <WhatsAppCobrancaPanel
          conversation={conversation}
          formatPhone={formatPhoneDisplay}
          onLinked={handleLeadLinked}
          onResolvedModule={setPanelResolvedModule}
          fallback={
            <WhatsAppCreateLeadPanel
              conversation={conversation}
              formatPhone={formatPhoneDisplay}
              onLinked={handleLeadLinked}
              afterCobrancaSearch
              onResolvedModule={setPanelResolvedModule}
            />
          }
        />
      ) : useCobrancaPanel ? (
        <WhatsAppCobrancaPanel
          conversation={conversation}
          formatPhone={formatPhoneDisplay}
          onLinked={handleLeadLinked}
          onResolvedModule={setPanelResolvedModule}
        />
      ) : (
        <WhatsAppCreateLeadPanel
          conversation={conversation}
          formatPhone={formatPhoneDisplay}
          onLinked={handleLeadLinked}
          onResolvedModule={setPanelResolvedModule}
        />
      )}
    </div>
  ) : null;

  // Status + ações da conversa (aceitar/transferir/fechar/IA) — usado no
  // cabeçalho desktop e dentro da folha de informações no mobile.
  const conversationStatusAndActions = conversation ? (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        {conversation.status === "pending"
          ? "Aguardando atendimento"
          : conversation.status === "closed"
            ? "Atendimento encerrado"
            : conversation.assigned_to === user?.id
              ? "Atendido por você"
              : `Atendido por: ${conversation.assigned_to_name || "—"}`}
      </p>
      <div className="flex items-center gap-2">
        {conversation.ai_enabled &&
        conversation.status !== "pending" &&
        (conversation.assigned_to === user?.id || isPrivileged) ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={conversationActionLoading !== null}
            onClick={() => void handleToggleAi(!conversation.ai_active)}
          >
            <Bot className="h-3.5 w-3.5" />
            {conversation.ai_active ? "Pausar IA" : "Reativar IA"}
          </Button>
        ) : null}
        {conversation.status === "pending" ? (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={conversationActionLoading !== null}
            onClick={() => void handleAcceptConversation()}
          >
            <UserCheck className="h-3.5 w-3.5" />
            Aceitar
          </Button>
        ) : null}
        {conversation.status === "open" &&
        (conversation.assigned_to === user?.id || isPrivileged) ? (
          <>
            <Popover open={routeCompanyOpen} onOpenChange={setRouteCompanyOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={conversationActionLoading !== null}
                  onClick={handleOpenRouteToCompany}
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Encaminhar p/ empresa
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3">
                <p className="text-sm font-medium">Encaminhar para outra empresa</p>
                <p className="text-xs text-muted-foreground">
                  A conversa fica pendente para qualquer usuário da empresa escolhida aceitar.
                </p>
                <Select value={routeCompanyTarget} onValueChange={setRouteCompanyTarget}>
                  <SelectTrigger className="h-8 text-xs">
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
                <Button
                  size="sm"
                  className="h-8 w-full text-xs"
                  disabled={!routeCompanyTarget || conversationActionLoading !== null}
                  onClick={() => void handleRouteToCompany()}
                >
                  Confirmar encaminhamento
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full gap-1.5 text-xs"
                  disabled={conversationActionLoading !== null}
                  onClick={() => {
                    setRouteCompanyOpen(false);
                    void handleCloseConversation();
                  }}
                >
                  <UserX className="h-3.5 w-3.5" />
                  Fechar conversa em vez de encaminhar
                </Button>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              disabled={conversationActionLoading !== null}
              onClick={() => void handleCloseConversation()}
            >
              <UserX className="h-3.5 w-3.5" />
              Fechar
            </Button>
          </>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden border bg-card lg:rounded-xl lg:shadow-sm">
        {/* Lista de conversas — no mobile ocupa a tela toda e some quando uma conversa é aberta */}
        <aside
          className={cn(
            "flex w-full flex-col border-r bg-muted/30 lg:max-w-[360px]",
            conversation ? "hidden lg:flex" : "flex max-w-full lg:max-w-[360px]",
          )}
        >
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Conversas</h1>
              <Badge
                variant="outline"
                className="gap-1 border-emerald-600/50 text-[10px] text-emerald-700 dark:text-emerald-300"
              >
                <ShieldCheck className="h-3 w-3" />
                API Oficial Meta
              </Badge>
              {notifyPermission === "granted" ? (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <Bell className="h-3.5 w-3.5" />
                  Avisos ativos
                </span>
              ) : notifyPermission !== "unsupported" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 gap-1 text-[10px]"
                  onClick={() => void handleEnableNotifications()}
                >
                  {notifyPermission === "denied" ? (
                    <BellOff className="h-3 w-3" />
                  ) : (
                    <Bell className="h-3 w-3" />
                  )}
                  Ativar avisos
                </Button>
              ) : null}
            </div>
            {!isAdmin ? (
              <p className="text-[10px] text-muted-foreground">
                Exibindo números da sua empresa e/ou atribuídos a você (WhatsApp → API Meta).
              </p>
            ) : null}
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
              {inboxTabs.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={view === key ? "default" : "ghost"}
                  className="h-8 flex-1 text-xs"
                  onClick={() => setView(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <ul className="p-1">
              {visibleList.map((c) => {
                const active = c.id === selectedId;
                const inst = resolveInstanceForDisplay(c, instancesById);
                const m = MODULE_STYLES[inboxDisplayModuleForConversation({
                  dedicatedCobrancaUser: cobrancaInboxMode,
                  storedModule: c.module,
                  cardId: c.card_id,
                  instanceId: c.instance_id,
                  cobrancaInstanceIds,
                  instanceName: inst?.name ?? null,
                })];
                const contact =
                  c.contact_name?.trim() && c.card_id
                    ? c.contact_name
                    : formatPhoneDisplay(c.phone_display || c.wa_id);
                const instanceName = inst?.name ?? "Número não identificado";
                const customerPhone = formatPhoneDisplay(c.phone_display || c.wa_id);
                const lastAt = c.last_message_at ? new Date(c.last_message_at) : null;
                const windowIsOpen = c.window_expires_at ? new Date(c.window_expires_at).getTime() > Date.now() : false;
                const unreadState = resolveUnreadState(c);
                const hasUnread = unreadState.show;
                const unread = unreadState.count;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "relative flex w-full gap-2.5 overflow-visible rounded-lg border border-transparent p-2 text-left transition-colors",
                        active
                          ? "bg-primary/10"
                          : hasUnread
                            ? "border-green-500/20 bg-green-500/[0.08] hover:bg-green-500/[0.12]"
                            : "hover:bg-muted",
                        hasUnread && !active && "pl-2 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-[3px] before:rounded-full before:bg-green-500 before:content-['']",
                      )}
                    >
                      <Avatar
                        className={cn(
                          "h-9 w-9 shrink-0",
                          hasUnread && !active && "ring-2 ring-green-500/45 ring-offset-2 ring-offset-background",
                        )}
                      >
                        <AvatarFallback
                          className={cn(
                            "text-xs font-medium",
                            hasUnread && !active && "bg-green-500/15 font-semibold text-foreground",
                          )}
                        >
                          {initials(contact)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm leading-tight", hasUnread ? "font-semibold text-foreground" : "font-medium")}>
                          {contact}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-xs leading-tight",
                            hasUnread ? "font-semibold text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {c.last_preview || "—"}
                        </p>
                        {hasUnread && !active ? (
                          <p className="mt-0.5 text-[10px] leading-tight font-medium text-green-600 dark:text-green-400">
                            Aguardando resposta
                          </p>
                        ) : null}
                        <p className="mt-0.5 truncate text-[10px] leading-tight font-medium text-sky-800 dark:text-sky-300">
                          <Smartphone className="mr-0.5 inline h-3 w-3 opacity-80" />
                          {instanceName} · {customerPhone}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", m.className)}>
                            {m.label}
                          </span>
                          {!windowIsOpen && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">
                              Fora da janela 24h
                            </span>
                          )}
                          {view === "all" && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {c.status === "pending"
                                ? "Pendente"
                                : c.status === "closed"
                                  ? "Fechado"
                                  : c.assigned_to_name
                                    ? `Com ${c.assigned_to_name}`
                                    : "Em atendimento"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex w-10 shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
                        <span
                          className={cn(
                            "text-[11px] leading-none",
                            hasUnread ? "font-semibold text-green-500" : "text-muted-foreground",
                          )}
                        >
                          {lastAt ? formatDistanceToNow(lastAt, { addSuffix: true, locale: ptBR }) : "—"}
                        </span>
                        {hasUnread ? (
                          <span
                            className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-green-500 px-1.5 text-xs font-bold leading-none text-white shadow-sm"
                            title={`${unread} mensagem(ns) não lida(s)`}
                          >
                            {formatUnreadCount(unread)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
              {!loading && filteredList.length === 0 ? (
                <li className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma conversa encontrada
                </li>
              ) : null}
              {filteredList.length > visibleCount && (
                <li className="p-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  >
                    Carregar mais ({filteredList.length - visibleCount} restantes)
                  </Button>
                </li>
              )}
            </ul>
          </ScrollArea>
        </aside>

        {/* Thread + painel lateral — no mobile só aparece depois de escolher a conversa */}
        <div className={cn("flex min-w-0 flex-1 flex-col", !conversation && "hidden lg:flex")}>
          {!conversation ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <AlertCircle className="h-4 w-4 mr-2" />
              Selecione uma conversa
            </div>
          ) : (
            <>
              {/* Cabeçalho da conversa */}
              <header className="border-b">
                {/* Mobile: cabeçalho compacto, estilo WhatsApp — detalhes ficam na folha de informações */}
                <div className="flex items-center gap-2 px-3 py-2 lg:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-ml-1 h-9 w-9 shrink-0"
                    onClick={() => setSelectedId(null)}
                    title="Voltar para as conversas"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback>{initials(conversation.contact_name || conversation.wa_id)}</AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setMobileInfoOpen(true)}
                  >
                    <h2 className="truncate text-sm font-semibold leading-tight">
                      {conversation.card_id && conversation.contact_name?.trim()
                        ? conversation.contact_name
                        : formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
                    </h2>
                    <p className="truncate text-[11px] leading-tight text-muted-foreground">
                      {mod.label}
                      {" · "}
                      {windowOpen ? "Janela 24h aberta" : "Só template aprovado"}
                    </p>
                  </button>
                  {conversation.status === "pending" ? (
                    <Button
                      size="sm"
                      className="h-8 shrink-0 gap-1 px-2.5 text-xs"
                      disabled={conversationActionLoading !== null}
                      onClick={() => void handleAcceptConversation()}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Aceitar
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setMobileInfoOpen(true)}
                    title="Informações do cliente"
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </div>

                {/* Desktop: cabeçalho completo */}
                <div className="hidden flex-wrap items-center gap-3 px-4 py-3 lg:flex">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{initials(conversation.contact_name || conversation.wa_id)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {conversation.card_id && conversation.contact_name?.trim()
                          ? conversation.contact_name
                          : formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
                      </h2>
                      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", mod.className)}>
                        {mod.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cliente: {formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
                    </p>
                    {conversationInstanceLabel ? (
                      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-sky-800 dark:text-sky-300">
                        <Smartphone className="h-3.5 w-3.5 shrink-0" />
                        Nossa linha: {conversationInstanceLabel}
                      </p>
                    ) : null}
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

                  {conversation.ai_enabled ? (
                    conversation.ai_active ? (
                      <Badge variant="secondary" className="gap-1 bg-violet-500/15 text-violet-800 dark:text-violet-200">
                        <Bot className="h-3 w-3" />
                        IA respondendo
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground">
                        <Bot className="h-3 w-3" />
                        IA pausada
                      </Badge>
                    )
                  ) : null}

                  {conversationStatusAndActions}
                </div>
              </header>

              <div className="flex min-h-0 flex-1">
                {/* Mensagens */}
                <div className="flex min-w-0 flex-1 flex-col bg-[#e5ddd5]/30 dark:bg-muted/20">
                  <ScrollArea ref={messagesAreaRef} className="flex-1 p-4">
                    <div className="mx-auto w-full max-w-4xl space-y-3">
                      {messages.map((msg) => {
                        const out = msg.direction === "out";
                        const at = new Date(msg.created_at);
                        const canDelete = out && (isAdmin || isGerente || msg.sent_by === user?.id);
                        return (
                          <div key={msg.id} className={cn("group flex min-w-0 items-end", out ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "relative min-w-0 max-w-[85%] break-words rounded-lg px-3 py-2 text-sm shadow-sm",
                                out
                                  ? "mr-7 rounded-br-none bg-[#d9fdd3] text-foreground dark:bg-emerald-900/50"
                                  : "rounded-bl-none bg-white dark:bg-card",
                              )}
                            >
                              {!out && conversationInstanceLabel ? (
                                <span className="mb-1 block text-[10px] font-medium text-sky-800 dark:text-sky-300">
                                  Recebido em {conversationInstanceLabel}
                                </span>
                              ) : null}
                              {out ? (
                                <p className="mb-1.5 text-[11px] font-semibold leading-tight text-emerald-950/90 dark:text-emerald-100">
                                  {formatAttendantLabel(msg.sent_by_name)}
                                </p>
                              ) : null}
                              {(msg.is_template || !!msg.meta_template_name) && (
                                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Template Meta
                                </span>
                              )}
                              <div className={out ? "space-y-0.5" : undefined}>
                                <WhatsAppMediaMessage message={msg} />
                              </div>
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                                <span>{format(at, "HH:mm", { locale: ptBR })}</span>
                                {out && <StatusIcon status={msg.status} />}
                              </div>
                              {canDelete && (
                                <button
                                  className="absolute -right-7 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  title="Excluir mensagem"
                                  onClick={() => setDeletingMsgId(msg.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
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
                    {!canReplyConversation ? (
                      <div className="mx-auto w-full max-w-4xl">
                        {conversation.status === "pending" ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                            <span>Aceite o atendimento para responder a esta conversa.</span>
                            <Button
                              size="sm"
                              className="h-7 gap-1.5 text-xs"
                              disabled={conversationActionLoading !== null}
                              onClick={() => void handleAcceptConversation()}
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Aceitar
                            </Button>
                          </div>
                        ) : conversation.status === "closed" ? (
                          windowOpen && conversation.assigned_to === user?.id ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-100">
                              <span>
                                Conversa encerrada, mas o cliente ainda está dentro da janela de 24h —
                                você pode continuar o atendimento sem esperar ele responder.
                              </span>
                              <Button
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                disabled={conversationActionLoading !== null}
                                onClick={() => void handleReopenConversation()}
                              >
                                <UserCheck className="h-3.5 w-3.5" />
                                Reabrir atendimento
                              </Button>
                            </div>
                          ) : (
                            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              Conversa encerrada — ela some das listas e volta para Pendentes se o cliente
                              responder novamente.
                            </div>
                          )
                        ) : (
                          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            Atendido por {conversation.assigned_to_name || "outro atendente"} — somente leitura.
                          </div>
                        )}
                      </div>
                    ) : windowOpen ? (
                      <div className="mx-auto w-full max-w-4xl space-y-2">
                        <p className="text-xs text-muted-foreground">
                          O cliente respondeu recentemente — você pode enviar texto livre (regra da Meta).
                        </p>
                        <div className="flex gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleSendFile(f);
                            }}
                          />
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleSendFile(f);
                            }}
                          />
                          <input
                            ref={audioInputRef}
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void handleSendFile(f);
                            }}
                          />

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0"
                                disabled={sending || uploading || !conversation.instance_id}
                                title="Mais opções"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                                <Paperclip className="mr-2 h-4 w-4" />
                                Anexar arquivo
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                                <ImageIcon className="mr-2 h-4 w-4" />
                                Enviar imagem
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!!audioDraft}
                                onClick={() => (recording ? void stopRecording() : void startRecording())}
                              >
                                {recording ? (
                                  <Square className="mr-2 h-4 w-4 text-destructive" />
                                ) : (
                                  <Mic className="mr-2 h-4 w-4" />
                                )}
                                {recording ? "Parar gravação" : "Gravar áudio"}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setTemplatePopoverOpen(true)}>
                                <FileText className="mr-2 h-4 w-4" />
                                Enviar template
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Dialog open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                            <DialogContent className="sm:max-w-sm">
                              <DialogHeader>
                                <DialogTitle>Enviar template aprovado</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-3">
                                <div className="space-y-1">
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
                                      <SelectTrigger className="h-8 text-xs">
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
                                      className="h-8 text-xs"
                                      placeholder={templatesLoading ? "Carregando…" : "Digite o nome do template aprovado"}
                                      value={selectedTemplate}
                                      onChange={(e) => setSelectedTemplate(e.target.value)}
                                    />
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-muted-foreground">Idioma</label>
                                  <Input
                                    className="h-8 text-xs"
                                    value={templateLanguage}
                                    onChange={(e) => setTemplateLanguage(e.target.value)}
                                    placeholder="pt_BR"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="w-full gap-1 text-xs"
                                  disabled={sending || !conversation.instance_id}
                                  onClick={async () => {
                                    await handleSendTemplate();
                                    setTemplatePopoverOpen(false);
                                  }}
                                >
                                  <Send className="h-3.5 w-3.5" />
                                  Enviar template
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Textarea
                            placeholder="Digite sua mensagem..."
                            className="min-h-[60px] resize-none"
                            rows={3}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                          <Button
                            type="button"
                            className="shrink-0 gap-1"
                            disabled={!draft.trim() || sending || uploading || !!audioDraft || !conversation.instance_id}
                            onClick={handleSendText}
                          >
                            <Send className="h-4 w-4" />
                            Enviar
                          </Button>
                        </div>
                        {recording ? (
                          <p className="text-[11px] text-muted-foreground">
                            Gravando… {recordSeconds}s (clicar no botão vermelho para parar e enviar)
                          </p>
                        ) : null}
                        {audioDraft ? (
                          <div className="rounded-lg border bg-muted/30 p-2 space-y-2">
                            <p className="text-[11px] text-muted-foreground">
                              Prévia do áudio (antes de enviar)
                            </p>
                            <audio controls src={audioDraft.url} className="w-full" />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="gap-1"
                                disabled={uploading || sending || !conversation.instance_id}
                                onClick={async () => {
                                  const file = new File([audioDraft.blob], audioDraft.filename, { type: audioDraft.mime });
                                  await handleSendFile(file);
                                  clearAudioDraft();
                                }}
                              >
                                <Send className="h-4 w-4" />
                                Enviar áudio
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={uploading || sending}
                                onClick={() => {
                                  clearAudioDraft();
                                  void startRecording();
                                }}
                              >
                                Regravar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={uploading || sending}
                                onClick={clearAudioDraft}
                              >
                                Excluir
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {uploading ? (
                          <p className="text-[11px] text-muted-foreground">
                            Enviando anexo… (isso pode levar alguns segundos)
                          </p>
                        ) : null}
                        {!conversation.instance_id ? (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">
                            Esta conversa não está vinculada a uma instância (`instance_id` nulo). Não é possível responder.
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mx-auto w-full max-w-4xl space-y-3">
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

                {/* Painel lateral CRM (desktop) */}
                <aside className="hidden min-h-0 min-w-[300px] w-[min(100%,360px)] shrink-0 flex-col border-l bg-muted/20 lg:flex">
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="p-4">{crmPanelInner}</div>
                  </ScrollArea>
                </aside>
              </div>

              {/* Folha de informações do cliente (mobile) — status, ações e card do CRM */}
              <Sheet open={mobileInfoOpen} onOpenChange={setMobileInfoOpen}>
                <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-sm">
                  <SheetHeader className="border-b p-4 text-left">
                    <SheetTitle className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>{initials(conversation.contact_name || conversation.wa_id)}</AvatarFallback>
                      </Avatar>
                      <span className="truncate">
                        {conversation.card_id && conversation.contact_name?.trim()
                          ? conversation.contact_name
                          : formatPhoneDisplay(conversation.phone_display || conversation.wa_id)}
                      </span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4 p-4">
                    <div className="flex flex-wrap items-center gap-2">
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
                      {conversation.ai_enabled ? (
                        conversation.ai_active ? (
                          <Badge variant="secondary" className="gap-1 bg-violet-500/15 text-violet-800 dark:text-violet-200">
                            <Bot className="h-3 w-3" />
                            IA respondendo
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground">
                            <Bot className="h-3 w-3" />
                            IA pausada
                          </Badge>
                        )
                      ) : null}
                    </div>
                    {conversationStatusAndActions}
                    <div className="border-t pt-4">{crmPanelInner}</div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={!!deletingMsgId} onOpenChange={(open) => { if (!open) setDeletingMsgId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir mensagem</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem será removida do histórico do CRM. A API da Meta não permite apagar
              mensagens já entregues no WhatsApp do cliente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={() => void handleDeleteMessage()}
            >
              {deleteLoading ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

