/** Notificações do navegador para novas mensagens no Inbox WhatsApp. */

export type NotificationPermissionState = NotificationPermission | "unsupported";

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
