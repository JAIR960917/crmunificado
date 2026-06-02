import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isRealtimeEnabled } from "@/lib/runtime-config";
import {
  buildWhatsAppContactLabel,
  notifyWhatsAppIncomingMessage,
} from "@/lib/whatsappInboxNotifications";

type ConversationMeta = {
  id: string;
  contact_name: string | null;
  phone_display: string | null;
  wa_id: string;
  unread_count: number;
  last_preview: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  caption?: string | null;
  media_type?: string | null;
};

function messagePreview(row: MessageRow): string {
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

/**
 * Escuta mensagens WhatsApp em tempo real em todo o CRM (não só na tela do inbox).
 */
export function useWhatsAppInboxNotifications() {
  const { user, canAccessPath, permissionsLoaded } = useAuth();
  const navigate = useNavigate();
  const conversationsRef = useRef<Map<string, ConversationMeta>>(new Map());

  const canUseInbox = !!user && permissionsLoaded && canAccessPath("/whatsapp-inbox");

  const openConversation = useCallback(
    (conversationId: string) => {
      navigate(`/whatsapp-inbox?c=${encodeURIComponent(conversationId)}`);
    },
    [navigate],
  );

  const notify = useCallback(
    (conversationId: string, preview: string) => {
      let conv = conversationsRef.current.get(conversationId);
      const contactLabel = conv ? buildWhatsAppContactLabel(conv) : "Cliente";

      notifyWhatsAppIncomingMessage(conversationId, preview, contactLabel, () =>
        openConversation(conversationId),
      );

      if (!conv) {
        void supabase
          .from("whatsapp_conversations")
          .select("id, contact_name, phone_display, wa_id, unread_count, last_preview")
          .eq("id", conversationId)
          .maybeSingle()
          .then(({ data }) => {
            if (data) conversationsRef.current.set(conversationId, data as ConversationMeta);
          });
      }
    },
    [openConversation],
  );

  useEffect(() => {
    if (!canUseInbox || !isRealtimeEnabled()) return;

    let cancelled = false;

    const seedConversations = async () => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("id, contact_name, phone_display, wa_id, unread_count, last_preview")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (cancelled || !data) return;
      const map = new Map<string, ConversationMeta>();
      for (const row of data as ConversationMeta[]) {
        map.set(row.id, row);
      }
      conversationsRef.current = map;
    };

    void seedConversations();

    const channel = supabase
      .channel("whatsapp-inbox-notifications-global")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        (payload: RealtimePostgresChangesPayload<ConversationMeta>) => {
          if (payload.eventType === "DELETE" && payload.old) {
            conversationsRef.current.delete((payload.old as ConversationMeta).id);
            return;
          }
          if (!payload.new) return;

          const row = payload.new as ConversationMeta;
          const prev = conversationsRef.current.get(row.id);
          conversationsRef.current.set(row.id, row);

          if (
            (row.unread_count || 0) > (prev?.unread_count || 0)
          ) {
            notify(row.id, row.last_preview || "Nova mensagem");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const row = payload.new as MessageRow | null;
          if (!row || row.direction !== "in") return;
          notify(row.conversation_id, messagePreview(row));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [canUseInbox, notify]);

  return null;
}
