/**
 * Inbox WhatsApp (API oficial Meta).
 * Dados reais: whatsapp_conversations / whatsapp_messages + realtime.
 */
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";
import AppLayout from "@/components/AppLayout";

export default function WhatsAppInboxDemoPage() {
  return (
    <AppLayout>
      <div className="-mx-3 -mb-3 flex min-h-0 flex-col sm:-mx-4 sm:-mb-4 lg:-mx-6 lg:-mb-6 h-[calc(100dvh-3.25rem)] lg:h-[calc(100dvh-3.5rem)]">
        <div className="min-h-0 flex-1">
          <WhatsAppInbox />
        </div>
      </div>
    </AppLayout>
  );
}
