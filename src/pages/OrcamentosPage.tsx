import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Receipt,
  CalendarIcon,
  Pencil,
  Trash2,
  Phone,
  User,
  Package,
  MessageSquare,
  AlertCircle,
  TrendingUp,
  Wallet,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import OrcamentoEditDialog from "@/components/orcamentos/OrcamentoEditDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ProdutoItem = { nome: string; valor: string };

type Orcamento = {
  id: string;
  lead_id: string | null;
  scheduled_by: string;
  scheduled_datetime: string;
  nome: string;
  telefone: string;
  idade: string;
  venda: string;
  nao_vendido_motivo: string | null;
  fez_orcamento: boolean;
  orcamento_valor: number | null;
  orcamento_produtos: string | null;
  orcamento_produtos_itens: ProdutoItem[] | null;
  orcamento_observacao: string | null;
};

type Profile = { user_id: string; full_name: string };
type Company = { id: string; name: string };
type ProfileFull = { user_id: string; full_name: string; company_id: string | null };

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const getInitials = (nome: string) => {
  const parts = (nome || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
};

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60", tone)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-lg font-bold tracking-tight truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function OrcamentoCardSkeleton() {
  return (
    <Card className="overflow-hidden animate-pulse">
      <div className="h-1 bg-muted" />
      <CardHeader className="pb-3">
        <div className="flex gap-3">
          <div className="h-11 w-11 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-2/5" />
            <div className="h-3 bg-muted rounded w-3/5" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="h-8 bg-muted rounded w-full" />
        <div className="h-12 bg-muted rounded w-full" />
      </CardContent>
    </Card>
  );
}

export default function OrcamentosPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Orcamento[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesFull, setProfilesFull] = useState<ProfileFull[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState<Date | undefined>();
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Orcamento | null>(null);
  const [deleting, setDeleting] = useState<Orcamento | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    const { error } = await supabase
      .from("crm_appointments")
      .update({
        venda: "Pendente",
        nao_vendido_motivo: null,
        fez_orcamento: false,
        orcamento_valor: null,
        orcamento_produtos: null,
        orcamento_produtos_itens: [],
        orcamento_observacao: null,
      })
      .eq("id", deleting.id);
    setDeleteLoading(false);
    if (error) {
      toast.error("Erro ao excluir orçamento: " + error.message);
      return;
    }
    toast.success("Orçamento excluído");
    setDeleting(null);
    fetchAll();
  };

  const fetchAll = async () => {
    setLoading(true);
    let q = supabase
      .from("crm_appointments")
      .select("*")
      .in("venda", ["Gerou Orçamento", "Não Gerou Orçamento"])
      .order("scheduled_datetime", { ascending: false });
    if (filterDate) {
      const a = new Date(filterDate); a.setHours(0, 0, 0, 0);
      const b = new Date(filterDate); b.setHours(23, 59, 59, 999);
      q = q.gte("scheduled_datetime", a.toISOString()).lte("scheduled_datetime", b.toISOString());
    }
    const [r, p] = await Promise.all([q, supabase.rpc("get_profile_names")]);
    setItems((r.data || []) as unknown as Orcamento[]);
    setProfiles((p.data || []) as Profile[]);
    if (isAdmin) {
      const [c, pf] = await Promise.all([
        supabase.from("companies").select("id, name").order("name"),
        supabase.from("profiles").select("user_id, full_name, company_id"),
      ]);
      setCompanies((c.data || []) as Company[]);
      setProfilesFull((pf.data || []) as ProfileFull[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [filterDate]);

  const filtered = isAdmin && filterCompanyId !== "all"
    ? items.filter((i) => profilesFull.find(p => p.user_id === i.scheduled_by)?.company_id === filterCompanyId)
    : items;

  const stats = useMemo(() => {
    const total = filtered.length;
    const comOrcamento = filtered.filter((o) => o.venda === "Gerou Orçamento").length;
    const semOrcamento = filtered.filter((o) => o.venda === "Não Gerou Orçamento").length;
    const valorTotal = filtered.reduce((acc, o) => acc + Number(o.orcamento_valor || 0), 0);
    const ticketMedio = comOrcamento > 0
      ? filtered.filter((o) => o.venda === "Gerou Orçamento").reduce((acc, o) => acc + Number(o.orcamento_valor || 0), 0) / comOrcamento
      : 0;
    return { total, comOrcamento, semOrcamento, valorTotal, ticketMedio };
  }, [filtered]);

  const getName = (uid: string) => profiles.find(p => p.user_id === uid)?.full_name || "—";

  const handleEdit = (o: Orcamento) => {
    setEditing(o);
    setEditOpen(true);
  };

  const formatDateTime = (iso: string) => {
    try {
      return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
    } catch {
      return "—";
    }
  };

  const getProdutos = (o: Orcamento): ProdutoItem[] => {
    const itens = Array.isArray(o.orcamento_produtos_itens) ? o.orcamento_produtos_itens : [];
    if (itens.length > 0) return itens;
    if (o.orcamento_produtos) {
      return o.orcamento_produtos.split(";").map((chunk) => {
        const [nome, valorPart] = chunk.split(" - R$ ");
        return { nome: nome?.trim() || chunk.trim(), valor: valorPart?.trim() || "0" };
      });
    }
    return [];
  };

  const hasActiveFilters = !!filterDate || (isAdmin && filterCompanyId !== "all");

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Cabeçalho */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
              <Receipt className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Orçamentos</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Leads que geraram orçamento ou não compraram após a consulta
              </p>
            </div>
          </div>

          <Card className="border-border/60 bg-muted/20 lg:min-w-[320px]">
            <CardContent className="p-3 flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              {isAdmin && companies.length > 0 && (
                <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
                  <SelectTrigger className="h-9 flex-1 min-w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas empresas</SelectItem>
                    {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn("h-9 justify-start text-left font-normal flex-1 min-w-[140px]", !filterDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                    {filterDate ? format(filterDate, "dd/MM/yyyy", { locale: ptBR }) : "Todos os dias"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={filterDate} onSelect={setFilterDate} locale={ptBR} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => { setFilterDate(undefined); setFilterCompanyId("all"); }}
                >
                  Limpar
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Estatísticas */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Receipt}
            label="Total de orçamentos"
            value={loading ? "…" : String(stats.total)}
            tone="text-primary"
          />
          <StatCard
            icon={Wallet}
            label="Valor total"
            value={loading ? "…" : formatBRL(stats.valorTotal)}
            tone="text-emerald-500"
          />
          <StatCard
            icon={TrendingUp}
            label="Gerou orçamento"
            value={loading ? "…" : String(stats.comOrcamento)}
            tone="text-cyan-500"
          />
          <StatCard
            icon={AlertCircle}
            label="Não gerou orçamento"
            value={loading ? "…" : String(stats.semOrcamento)}
            tone="text-amber-500"
          />
        </div>

        {/* Lista */}
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((i) => <OrcamentoCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed border-border/80">
            <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60 mb-4">
                <Receipt className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-lg mb-1">Nenhum orçamento encontrado</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {hasActiveFilters
                  ? "Tente ajustar os filtros de data ou empresa para ver outros resultados."
                  : "Os orçamentos aparecem aqui quando registrados em agendamentos sem venda."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((o) => {
              const produtos = getProdutos(o);
              const valor = Number(o.orcamento_valor || 0);
              const gerouOrcamento = o.venda === "Gerou Orçamento";

              return (
                <Card
                  key={o.id}
                  className="group overflow-hidden border-border/60 bg-card/90 hover:border-primary/35 hover:shadow-md hover:shadow-primary/5 transition-all duration-200"
                >
                  <div className={cn(
                    "h-1 bg-gradient-to-r to-transparent",
                    gerouOrcamento ? "from-primary via-primary/60" : "from-amber-500 via-amber-500/60",
                  )} />

                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary ring-2 ring-primary/20">
                          {getInitials(o.nome)}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold truncate">{o.nome || "—"}</CardTitle>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {o.telefone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3 w-3 shrink-0" />
                                {o.telefone}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <CalendarIcon className="h-3 w-3 shrink-0" />
                              {formatDateTime(o.scheduled_datetime)}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <User className="h-3 w-3 shrink-0" />
                              {getName(o.scheduled_by)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {gerouOrcamento ? (
                          <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/20 text-sm font-semibold px-2.5 py-1">
                            {formatBRL(valor)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold px-2.5 py-1">
                            Não gerou orçamento
                          </Badge>
                        )}
                        <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                            title="Editar orçamento"
                            onClick={() => handleEdit(o)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title="Excluir orçamento"
                              onClick={() => setDeleting(o)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-0">
                    {produtos.length > 0 && (
                      <div className="rounded-lg border border-border/50 bg-muted/25 p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5" />
                          Produtos
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {produtos.map((p, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs"
                            >
                              <span className="font-medium">{p.nome}</span>
                              <span className="mx-1.5 text-muted-foreground">·</span>
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                {formatBRL(Number(p.valor || 0))}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {o.nao_vendido_motivo?.trim() && (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Motivo da não compra
                        </p>
                        <p className="text-sm leading-snug">{o.nao_vendido_motivo}</p>
                      </div>
                    )}

                    {o.orcamento_observacao?.trim() && (
                      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5" />
                          Observação
                        </p>
                        <p className="text-sm text-muted-foreground leading-snug whitespace-pre-wrap">
                          {o.orcamento_observacao}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <OrcamentoEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        orcamento={editing}
        onSaved={fetchAll}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir orçamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O orçamento de <strong>{deleting?.nome || "—"}</strong> será removido. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
