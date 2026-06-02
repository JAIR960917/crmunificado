/**
 * Inbox WhatsApp (API oficial Meta).
 * Dados reais: whatsapp_conversations / whatsapp_messages + realtime.
 */
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ShieldCheck } from "lucide-react";

export default function WhatsAppInboxDemoPage() {
  return (
    <AppLayout>
      <div className="-mx-3 -mb-3 flex min-h-0 flex-col sm:-mx-4 sm:-mb-4 lg:-mx-6 lg:-mb-6 h-[calc(100dvh-3.25rem)] lg:h-[calc(100dvh-3.5rem)]">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100 sm:px-4 lg:px-6">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Inbox WhatsApp</strong> — API oficial (Meta). Mensagens chegam via webhook e atualizam em tempo real.
          </span>
          <Badge variant="outline" className="ml-auto gap-1 border-emerald-600/50 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" />
            API Oficial Meta
          </Badge>
        </div>

        <div className="min-h-0 flex-1">
          <WhatsAppInbox />
        </div>
      </div>
    </AppLayout>
  );
}
