import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Pencil, Trash2, CloudOff, CheckCircle2, CalendarPlus, CalendarClock, AlertTriangle, Plus, Clock, Phone, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { resolveLeadIdentity } from "@/lib/leadIdentity";
import { formatPhoneBR } from "@/lib/phoneFormat";

type Profile = { user_id: string; full_name: string; email?: string; avatar_url?: string | null };

type FormFieldInfo = {
  id: string;
  label: string;
  is_name_field?: boolean;
  is_phone_field?: boolean;
  show_on_card?: boolean;
};

type LeadActivity = {
  id: string;
  title: string;
  scheduled_date: string;
  completed_at: string | null;
};

type LeadCardProps = {
  lead: {
    id: string;
    data: Record<string, any>;
    assigned_to: string | null;
    status: string;
    created_at: string;
    scheduled_date?: string | null;
    comprou?: boolean;
  };
  columns: { field_key: string; name: string }[];
  formFields: FormFieldInfo[];
  profiles: Profile[];
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onSchedule?: () => void;
  onToggleComprou?: (value: boolean) => void;
  onRestore?: () => void;
  syncStatus?: "offline" | "synced" | null;
  activities?: LeadActivity[];
};

export default function LeadCard({
  lead, columns, formFields, profiles, isAdmin,
  onEdit, onDelete, onHistory, onSchedule, onToggleComprou, onRestore, syncStatus, activities,
}: LeadCardProps) {
  const data = typeof lead.data === "object" ? (lead.data as Record<string, any>) : {};
  const assignedProfile = profiles.find((p) => p.user_id === lead.assigned_to);

  const nameFields = formFields.filter((f) => f.is_name_field);
  const phoneFields = formFields.filter((f) => f.is_phone_field);

  // Robust resolution: tries field_<id>, legacy keys (nome_lead, telefone), and label-matching
  const identity = resolveLeadIdentity(data, formFields as any);

  const displayName =
    identity.nome
    || nameFields.reduce<string | null>((found, f) => found || data[`field_${f.id}`] || null, null)
    || data.nome_lead
    || (columns[0] && data[columns[0].field_key])
    || "Sem nome";

  const displayPhone =
    identity.telefone
    || phoneFields.reduce<string | null>((found, f) => found || data[`field_${f.id}`] || null, null)
    || data.telefone
    || null;

  const isOffline = syncStatus === "offline";
  const isSynced = syncStatus === "synced";

  let createdDate = "";
  try {
    createdDate = format(new Date(lead.created_at), "d 'de' MMMM", { locale: ptBR });
  } catch {
    createdDate = "";
  }

  const nameFieldIds = new Set(nameFields.map((f) => f.id));
  const phoneFieldIds = new Set(phoneFields.map((f) => f.id));


  // Activity status
  const pendingActivities = (activities || []).filter(a => !a.completed_at);
  const overdueActivities = pendingActivities.filter(a => new Date(a.scheduled_date) < new Date());
  const todayActivities = pendingActivities.filter(a => {
    const d = new Date(a.scheduled_date);
    const now = new Date();
    return d.toDateString() === now.toDateString() && d >= now;
  });

  const hasOverdue = overdueActivities.length > 0;
  const hasToday = todayActivities.length > 0;
  const hasPending = pendingActivities.length > 0 && !hasOverdue && !hasToday;

  const tratativaAtendeu = (data?.tratativa_atendeu as string | undefined) || null;

  let cardBorderClass = "";
  if (isOffline) {
    cardBorderClass = "border-amber-500/50 bg-amber-500/5";
  } else if (isSynced) {
    cardBorderClass = "border-emerald-500/50 bg-emerald-500/5";
  } else if (tratativaAtendeu === "sim") {
    cardBorderClass = "border-emerald-500 bg-emerald-500/10 shadow-emerald-500/20 shadow-md";
  } else if (tratativaAtendeu === "nao") {
    cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
  } else if (hasOverdue) {
    cardBorderClass = "border-red-500 bg-red-500/10 shadow-red-500/20 shadow-md";
  } else if (hasToday) {
    cardBorderClass = "border-amber-400 bg-amber-500/5";
  } else if (hasPending) {
    cardBorderClass = "border-blue-400/50 bg-blue-500/5";
  }

  const nextActivity = [...pendingActivities].sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())[0];

  return (
    <div className={`rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing group ${cardBorderClass}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {syncStatus && (
            <div className="shrink-0 mt-0.5">
              {isOffline ? (
                <CloudOff className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground truncate">{displayName}</p>
            {createdDate && (
              <p className="text-xs text-muted-foreground mt-0.5">{createdDate}</p>
            )}
          </div>
        </div>
        {!isOffline && (
          <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
            {onSchedule && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onSchedule(); }}>
                <CalendarPlus className="h-3.5 w-3.5 text-primary" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {isAdmin && onRestore && lead.status === "excluidos" && (
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Restaurar / Atribuir" onClick={(e) => { e.stopPropagation(); onRestore(); }}>
                <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Excluir card" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {isOffline && (
        <p className="text-xs text-amber-500 mt-1 font-medium">Aguardando sincronização...</p>
      )}
      {isSynced && (
        <p className="text-xs text-emerald-500 mt-1 font-medium">Sincronizado ✓</p>
      )}

      {/* Telefone oculto propositalmente — vendedor precisa abrir o card para ver */}

      {/* Fields marked as show_on_card OR matching key labels (exame, dores, sintomas, doenças) */}
      {formFields
        .filter((f) => {
          if (nameFieldIds.has(f.id) || phoneFieldIds.has(f.id)) return false;
          if (f.show_on_card) return true;
          const label = (f.label || "").toLowerCase();
          return /exame|dor|sintoma|doen|idade|cidade/.test(label);
        })
        .map((f) => {
          const value = data[`field_${f.id}`];
          if (value === undefined || value === null || value === "") return null;
          const display = Array.isArray(value) ? value.join(", ") : String(value);
          if (!display.trim()) return null;
          return (
            <div key={f.id} className="mt-1.5">
              <p className="text-[11px] text-muted-foreground leading-tight">{f.label}</p>
              <p className="text-xs font-medium text-foreground line-clamp-2">{display}</p>
            </div>
          );
        })}

      {assignedProfile && (
        <div className="mt-2 pt-2 border-t">
          <p className="text-[11px] text-muted-foreground leading-tight">Pessoa responsável</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Avatar className="h-5 w-5 text-[9px]">
              <AvatarImage src={assignedProfile.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-[9px]">
                {(assignedProfile.full_name || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium text-foreground truncate">
              {assignedProfile.full_name || assignedProfile.email}
            </span>
          </div>
        </div>
      )}

      {/* Activity section */}
      <div className="mt-2 pt-2 border-t">
        {/* Overdue badge */}
        {hasOverdue && (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-red-500 px-2 py-0.5 rounded-full uppercase">
              <AlertTriangle className="h-3 w-3" />
              Atrasada
            </span>
          </div>
        )}

        {/* Today badge */}
        {hasToday && !hasOverdue && (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
              <CalendarClock className="h-3 w-3" />
              Hoje
            </span>
          </div>
        )}

        {/* Pending badge */}
        {hasPending && (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
              <Clock className="h-3 w-3" />
              Pendente
            </span>
          </div>
        )}

        {/* All clear badge */}
        {!hasOverdue && !hasToday && !hasPending && (
          <div className="mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded-full uppercase">
              <CheckCircle2 className="h-3 w-3" />
              Em dia
            </span>
          </div>
        )}

        {/* Next activity info */}
        {nextActivity && (
          <div className={`text-xs mb-1.5 ${hasOverdue ? "text-red-600" : hasToday ? "text-amber-600" : "text-muted-foreground"}`}>
            <p className="font-medium truncate">{nextActivity.title}</p>
            <p className="text-[10px]">
              {(() => {
                try { return format(new Date(nextActivity.scheduled_date), "dd/MM 'às' HH:mm", { locale: ptBR }); }
                catch { return ""; }
              })()}
            </p>
          </div>
        )}

        {/* + Atividade button */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Atividade
        </button>
      </div>
    </div>
  );
}
