import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import CobrancaContactAttemptForm from "@/components/cobrancas/CobrancaContactAttemptForm";
import { nationalPhoneDigits, phonesMatchNational, extractPhoneFromCobrancaData } from "@/lib/phoneFormat";

type ConversationRef = {
  id: string;
  wa_id: string;
  contact_name: string | null;
  phone_display: string | null;
  card_id: string | null;
  module: string | null;
};

type CobrancaRow = {
  id: string;
  data: Record<string, unknown>;
  status: string;
  valor: number;
  company_id: string | null;
};

type LastNote = {
  content: string;
  created_at: string;
  authorName: string;
};

type Props = {
  conversation: ConversationRef;
  formatPhone: (raw: string) => string;
  onLinked: (conversationId: string, patch: { card_id: string; contact_name: string | null; module: string }) => void;
};

export default function WhatsAppCobrancaPanel({ conversation, formatPhone, onLinked }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [cobranca, setCobranca] = useState<CobrancaRow | null>(null);
  const [statusLabel, setStatusLabel] = useState<string>("");
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [lastNote, setLastNote] = useState<LastNote | null>(null);
  const [currentUserName, setCurrentUserName] = useState("");

  const nationalDigits = nationalPhoneDigits(
    conversation.phone_display || conversation.wa_id || "",
  );
  const displayPhone = formatPhone(conversation.phone_display || conversation.wa_id);

  const loadLastNote = useCallback(async (cobrancaId: string) => {
    const { data: notes } = await supabase
      .from("crm_cobranca_notes")
      .select("content, created_at, user_id")
      .eq("cobranca_id", cobrancaId)
      .order("created_at", { ascending: false })
      .limit(1);

    const note = notes?.[0];
    if (!note) {
      setLastNote(null);
      return;
    }

    let authorName = "Usuário";
    if (note.user_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", note.user_id)
        .maybeSingle();
      if (prof?.full_name) authorName = prof.full_name;
    }

    setLastNote({
      content: note.content,
      created_at: note.created_at,
      authorName,
    });
  }, []);

  const applyCobranca = useCallback(
    async (row: CobrancaRow, linkConversation: boolean) => {
      setCobranca(row);
      const d = row.data || {};
      const nome = String(d.nome || conversation.contact_name || "Cliente");

      const [{ data: st }, { data: comp }] = await Promise.all([
        supabase.from("crm_cobranca_statuses").select("label").eq("key", row.status).maybeSingle(),
        row.company_id
          ? supabase.from("companies").select("name").eq("id", row.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setStatusLabel(st?.label || row.status);
      setCompanyName(comp?.name || null);
      await loadLastNote(row.id);

      if (linkConversation && conversation.id) {
        const needsLink =
          conversation.card_id !== row.id || conversation.module !== "cobrancas";
        if (needsLink) {
          const { error } = await supabase
            .from("whatsapp_conversations")
            .update({
              card_id: row.id,
              module: "cobrancas",
              contact_name: nome,
            })
            .eq("id", conversation.id);
          if (!error) {
            onLinked(conversation.id, {
              card_id: row.id,
              contact_name: nome,
              module: "cobrancas",
            });
          }
        }
      }
    },
    [conversation.contact_name, conversation.card_id, conversation.id, conversation.module, loadLastNote, onLinked],
  );

  const resolveCobranca = useCallback(async () => {
    setLoading(true);
    setCobranca(null);
    setLastNote(null);
    try {
      if (user?.id) {
        const { data: me } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .maybeSingle();
        setCurrentUserName(me?.full_name || "");
      }

      if (conversation.card_id) {
        const { data: byId } = await supabase
          .from("crm_cobrancas")
          .select("id, data, status, valor, company_id")
          .eq("id", conversation.card_id)
          .maybeSingle();
        if (byId) {
          await applyCobranca(byId as CobrancaRow, false);
          return;
        }
      }

      if (nationalDigits.length < 8) {
        return;
      }

      const { data: rpcRows, error: rpcError } = await supabase.rpc("find_cobranca_by_phone", {
        p_phone: nationalDigits,
      });

      if (!rpcError && rpcRows?.length) {
        await applyCobranca(rpcRows[0] as CobrancaRow, true);
        return;
      }

      const last8 = nationalDigits.slice(-8);
      const orParts = [
        `data->>telefone.ilike.%${last8}%`,
        `data->>celular.ilike.%${last8}%`,
        `data->>whatsapp.ilike.%${last8}%`,
      ];
      if (nationalDigits.length >= 10) {
        orParts.push(`data->>telefone.ilike.%${nationalDigits}%`);
        orParts.push(`data->>celular.ilike.%${nationalDigits}%`);
      }
      const { data: candidates, error: queryError } = await supabase
        .from("crm_cobrancas")
        .select("id, data, status, valor, company_id")
        .or(orParts.join(","))
        .order("updated_at", { ascending: false })
        .limit(40);

      if (queryError) throw queryError;

      const found = (candidates || []).find((c) =>
        phonesMatchNational(extractPhoneFromCobrancaData(c.data as Record<string, unknown>), nationalDigits),
      ) as CobrancaRow | undefined;

      if (found) {
        await applyCobranca(found, true);
      }
    } catch {
      toast.error("Não foi possível carregar os dados da cobrança.");
    } finally {
      setLoading(false);
    }
  }, [user?.id, conversation.card_id, nationalDigits, applyCobranca]);

  useEffect(() => {
    resolveCobranca();
  }, [resolveCobranca]);

  const handleTratativaSaved = (updatedData?: Record<string, unknown>) => {
    if (updatedData && cobranca) {
      setCobranca({ ...cobranca, data: updatedData as Record<string, unknown> });
      loadLastNote(cobranca.id);
      return;
    }
    resolveCobranca();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando cobrança…
      </div>
    );
  }

  if (!cobranca) {
    return (
      <div className="space-y-2 border-t pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cobrança no CRM</p>
        <p className="text-sm text-muted-foreground">
          Nenhum card de cobrança encontrado para {displayPhone}. Buscamos pelo telefone do
          WhatsApp — funciona com ou sem gatilho enviado (dúvidas, renegociação, etc.).
        </p>
      </div>
    );
  }

  const d = cobranca.data || {};
  const nome = String(d.nome || conversation.contact_name || "Cliente");
  const valorFmt =
    cobranca.valor > 0
      ? cobranca.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cobrança no CRM</p>
        <p className="mt-2 font-semibold leading-snug break-words">{nome}</p>
        <dl className="mt-2 space-y-2.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Telefone</dt>
            <dd className="mt-0.5 font-medium text-amber-700 dark:text-amber-300 break-words">{displayPhone}</dd>
          </div>
          {statusLabel ? (
            <div>
              <dt className="text-xs text-muted-foreground">Coluna</dt>
              <dd className="mt-0.5 text-xs font-medium break-words">{statusLabel}</dd>
            </div>
          ) : null}
          {valorFmt ? (
            <div>
              <dt className="text-xs text-muted-foreground">Valor</dt>
              <dd className="mt-0.5 font-medium break-words">{valorFmt}</dd>
            </div>
          ) : null}
          {companyName ? (
            <div>
              <dt className="text-xs text-muted-foreground">Empresa</dt>
              <dd className="mt-0.5 text-xs break-words">{companyName}</dd>
            </div>
          ) : null}
          {d.descricao ? (
            <div>
              <dt className="text-xs text-muted-foreground">Descrição</dt>
              <dd className="mt-0.5 text-xs leading-snug break-words">{String(d.descricao)}</dd>
            </div>
          ) : null}
        </dl>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full gap-2"
          onClick={() => navigate("/cobrancas")}
        >
          <ExternalLink className="h-4 w-4" />
          Abrir tela de cobranças
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Última tratativa</p>
        {lastNote ? (
          <div className="rounded-md border bg-background/60 p-2.5 text-xs leading-relaxed">
            <p className="whitespace-pre-wrap">{lastNote.content}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {lastNote.authorName} ·{" "}
              {format(new Date(lastNote.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma tratativa registrada ainda.</p>
        )}
      </div>

      {user?.id ? (
        <CobrancaContactAttemptForm
          cobrancaId={cobranca.id}
          userId={user.id}
          userName={currentUserName}
          cobrancaData={cobranca.data}
          cobrancaStatus={cobranca.status}
          onSaved={handleTratativaSaved}
          compact
        />
      ) : null}
    </div>
  );
}
