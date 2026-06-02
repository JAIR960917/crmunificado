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
import { extractPhoneFromCobrancaData, nationalPhoneDigits, phoneSearchVariants, phonesMatchNational } from "@/lib/phoneFormat";

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

type ScoredCobrancaRow = CobrancaRow & { match_score: number };

function namesLooselyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a || "").trim().toLowerCase();
  const nb = (b || "").trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const fa = na.split(/\s+/)[0];
  const fb = nb.split(/\s+/)[0];
  return fa.length >= 3 && fa === fb;
function extractGatilhoNameHint(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/Ol[aá],\s*(.+?)!/i);
  return match?.[1]?.trim() || null;
}

function pickCobrancaMatch(rows: ScoredCobrancaRow[]): {
  best: ScoredCobrancaRow | null;
  ambiguous: ScoredCobrancaRow[];
} {
  if (rows.length === 0) return { best: null, ambiguous: [] };
  if (rows.length === 1) return { best: rows[0], ambiguous: [] };

  const [first, second] = rows;
  if (first.match_score >= 1000) return { best: first, ambiguous: [] };
  if (first.match_score >= 250 && first.match_score - (second?.match_score ?? 0) >= 50) {
    return { best: first, ambiguous: [] };
  }

  const top = first.match_score;
  const tied = rows.filter((r) => r.match_score >= top - 20 && r.match_score >= 100);
  if (tied.length <= 1) return { best: first, ambiguous: [] };

  return { best: null, ambiguous: tied.slice(0, 5) };
}

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
  const [ambiguousOptions, setAmbiguousOptions] = useState<ScoredCobrancaRow[] | null>(null);

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
          const { error } = await supabase.rpc("link_whatsapp_conversation_cobranca", {
            p_conversation_id: conversation.id,
            p_cobranca_id: row.id,
            p_contact_name: nome,
          });
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
    setAmbiguousOptions(null);
    try {
      if (user?.id) {
        const { data: me } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .maybeSingle();
        setCurrentUserName(me?.full_name || "");
      }

      let nameHint: string | null = null;
      if (conversation.id) {
        const { data: outbound } = await supabase
          .from("whatsapp_messages")
          .select("body, sent_by_name")
          .eq("conversation_id", conversation.id)
          .eq("direction", "out")
          .order("created_at", { ascending: false })
          .limit(12);
        for (const msg of outbound || []) {
          const fromGatilho = (msg.sent_by_name || "").toLowerCase().includes("gatilho");
          const hint = extractGatilhoNameHint(msg.body);
          if (hint && (fromGatilho || hint.length > 3)) {
            nameHint = hint;
            break;
          }
        }
      }

      if (conversation.card_id) {
        const { data: byId } = await supabase
          .from("crm_cobrancas")
          .select("id, data, status, valor, company_id")
          .eq("id", conversation.card_id)
          .maybeSingle();
        if (byId) {
          const linkedName = String((byId.data as Record<string, unknown>)?.nome || "");
          const hintOk = nameHint ? namesLooselyMatch(linkedName, nameHint) : true;
          const contactOk = conversation.contact_name
            ? namesLooselyMatch(linkedName, conversation.contact_name)
            : true;
          if (hintOk && (contactOk || !nameHint)) {
            await applyCobranca(byId as CobrancaRow, conversation.module !== "cobrancas");
            return;
          }
        }
      }

      const searchPhones = phoneSearchVariants(
        nationalDigits,
        conversation.wa_id,
        conversation.phone_display,
      );

      if (searchPhones.length === 0) {
        return;
      }

      let ranked: ScoredCobrancaRow[] = [];
      for (const phone of searchPhones) {
        const { data: rpcRows, error: rpcError } = await supabase.rpc("find_cobrancas_by_phone", {
          p_phone: phone,
          p_contact_name: conversation.contact_name,
          p_prefer_card_id: conversation.card_id,
          p_name_hint: nameHint,
        });
        if (rpcError) {
          console.warn("find_cobrancas_by_phone:", rpcError.message, "phone=", phone);
          continue;
        }
        if (rpcRows?.length) {
          ranked = rpcRows as ScoredCobrancaRow[];
          break;
        }
      }

      if (ranked.length > 0) {
        const { best, ambiguous } = pickCobrancaMatch(ranked);
        if (best) {
          await applyCobranca(best, true);
          return;
        }
        if (ambiguous.length > 0) {
          setAmbiguousOptions(ambiguous);
          return;
        }
      }

      const last8 = nationalPhoneDigits(nationalDigits).slice(-8);
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

      const matched = (candidates || []).filter((c) =>
        phonesMatchNational(extractPhoneFromCobrancaData(c.data as Record<string, unknown>), nationalDigits),
      ) as CobrancaRow[];

      if (matched.length === 1) {
        await applyCobranca(matched[0], true);
        return;
      }

      if (matched.length > 1) {
        setAmbiguousOptions(
          matched.map((row) => ({ ...row, match_score: 0 })),
        );
      }
    } catch {
      toast.error("Não foi possível carregar os dados da cobrança.");
    } finally {
      setLoading(false);
    }
  }, [user?.id, conversation.card_id, conversation.module, conversation.id, conversation.contact_name, conversation.wa_id, conversation.phone_display, nationalDigits, applyCobranca]);

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

  if (!cobranca && ambiguousOptions && ambiguousOptions.length > 0) {
    return (
      <div className="space-y-3 border-t pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cobrança no CRM</p>
        <p className="text-sm text-muted-foreground">
          Vários clientes usam o telefone {displayPhone}. Selecione o card correto:
        </p>
        <div className="space-y-2">
          {ambiguousOptions.map((row) => {
            const d = row.data || {};
            const nome = String(d.nome || "Cliente");
            const valor =
              row.valor > 0
                ? row.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : null;
            return (
              <Button
                key={row.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto w-full flex-col items-start gap-1 py-2 text-left"
                onClick={() => {
                  setAmbiguousOptions(null);
                  void applyCobranca(row, true);
                }}
              >
                <span className="font-semibold">{nome}</span>
                {valor ? <span className="text-xs text-muted-foreground">{valor}</span> : null}
              </Button>
            );
          })}
        </div>
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
