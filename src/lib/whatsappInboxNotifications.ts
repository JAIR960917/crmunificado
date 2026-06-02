/** Notificações (toast + navegador) para novas mensagens no Inbox WhatsApp — em qualquer tela do CRM. */

import { toast } from "sonner";

export type NotificationPermissionState = NotificationPermission | "unsupported";

const recentNotifyAt = new Map<string, number>();
const DEDUPE_MS = 2500;

let inboxMounted = false;
let inboxSelectedConversationId: string | null = null;

/** Registra se o inbox está aberto e qual conversa está selecionada (evita aviso duplicado). */
export function setWhatsAppInboxSession(active: boolean, selectedConversationId: string | null = null): void {
  inboxMounted = active;
  inboxSelectedConversationId = active ? selectedConversationId : null;
}

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestWhatsAppNotificationPermission(): Promise<boolean> {
  if (getNotificationPermission() === "unsupported") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function formatWhatsAppPhoneDisplay(raw: string): string {
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

export function buildWhatsAppContactLabel(conv: {
  contact_name?: string | null;
  phone_display?: string | null;
  wa_id?: string | null;
}): string {
  return (
    conv.contact_name?.trim() ||
    formatWhatsAppPhoneDisplay(conv.phone_display || conv.wa_id || "") ||
    "Cliente"
  );
}

function shouldSuppressNotification(conversationId: string): boolean {
  if (!inboxMounted) return false;
  if (document.visibilityState !== "visible") return false;
  return inboxSelectedConversationId === conversationId;
}

export function showWhatsAppInboxNotification(
  title: string,
  body: string,
  conversationId: string,
  onOpen?: () => void,
): void {
  if (getNotificationPermission() !== "granted") return;

  try {
    const notification = new Notification(title, {
      body: body.slice(0, 180),
      tag: `whatsapp-inbox-${conversationId}`,
    });

    notification.onclick = () => {
      window.focus();
      onOpen?.();
      notification.close();
    };
  } catch {
    /* ignore — alguns browsers bloqueiam fora de gesto do usuário */
  }
}

export function notifyWhatsAppIncomingMessage(
  conversationId: string,
  preview: string,
  contactLabel: string,
  onOpen?: () => void,
): void {
  const now = Date.now();
  const lastAt = recentNotifyAt.get(conversationId) || 0;
  if (now - lastAt < DEDUPE_MS) return;
  recentNotifyAt.set(conversationId, now);

  if (shouldSuppressNotification(conversationId)) return;

  const body = preview || "Mensagem recebida";
  const title = `Nova mensagem — ${contactLabel}`;

  toast.message(title, {
    description: body,
    duration: 8000,
    action: onOpen
      ? {
          label: "Abrir",
          onClick: onOpen,
        }
      : undefined,
  });

  const tabFocused = document.visibilityState === "visible";
  if (getNotificationPermission() === "granted" && (!tabFocused || !inboxMounted || inboxSelectedConversationId !== conversationId)) {
    showWhatsAppInboxNotification(title, body, conversationId, onOpen);
  }
}
