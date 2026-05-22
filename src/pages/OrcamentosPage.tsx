import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Receipt, CalendarIcon, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

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

export default function OrcamentosPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Orcamento[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesFull, setProfilesFull] = useState<ProfileFull[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState<Date | undefined>();
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");

  const fetchAll = async () => {
    setLoading(true);
    let q = supabase.from("crm_appointments").select("*").eq("fez_orcamento", true).order("scheduled_datetime", { ascending: false });
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

  const getName = (uid: string) => profiles.find(p => p.user_id === uid)?.full_name || "—";

  const handleEdit = async (o: Orcamento) => {
    if (o.lead_id) {
      navigate(`/?edit=${o.lead_id}`);
      return;
    }
    const phone = (o.telefone || "").replace(/\D/g, "");
    if (phone) {
      const { data } = await supabase.from("crm_leads").select("id, data").limit(500);
      const tail = phone.slice(-8);
      const match = (data || []).find((l: any) => {
        const d = l.data || {};
        const phones: string[] = [];
        const walk = (v: any) => {
          if (typeof v === "string") phones.push(v);
          else if (v && typeof v === "object") Object.values(v).forEach(walk);
        };
        walk(d);
        return phones.some((p) => p.replace(/\D/g, "").endsWith(tail));
      });
      if (match) {
        navigate(`/?edit=${match.id}`);
        return;
      }
    }
    toast.info("Lead não localizado. Cadastre o cliente na tela de Leads para continuar a tratativa.");
  };

  const renderProdutos = (o: Orcamento) => {
    const itens = Array.isArray(o.orcamento_produtos_itens) ? o.orcamento_produtos_itens : [];
    if (itens.length > 0) {
      return (
        <div className="space-y-0.5 text-xs">
          {itens.map((p, i) => (
            <div key={i} className="truncate">{p.nome} — R$ {Number(p.valor || 0).toFixed(2)}</div>
          ))}
        </div>
      );
    }
    return <span className="text-xs">{o.orcamento_produtos || "—"}</span>;
  };

  return (
    <AppLayout>
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="h-6 w-6 text-primary" />
            <h1 className="text-xl sm:text-2xl font-bold">Orçamentos</h1>
          </div>
          <p className="text-sm text-muted-foreground">{filtered.length} orçamento(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && companies.length > 0 && (
            <Select value={filterCompanyId} onValueChange={setFilterCompanyId}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas empresas</SelectItem>
                {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("justify-start text-left font-normal", !filterDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4 text-destructive" />
                {filterDate ? format(filterDate, "dd/MM/yyyy", { locale: ptBR }) : "Todos os dias"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={filterDate} onSelect={setFilterDate} locale={ptBR} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {filterDate && <Button variant="ghost" size="sm" onClick={() => setFilterDate(undefined)}>Limpar</Button>}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground py-8">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Nenhum orçamento encontrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/70 border-b">
                <th className="text-left px-3 py-2.5 font-medium">Cliente</th>
                <th className="text-left px-3 py-2.5 font-medium">Telefone</th>
                <th className="text-left px-3 py-2.5 font-medium">Data agendamento</th>
                <th className="text-left px-3 py-2.5 font-medium">Vendedor</th>
                <th className="text-left px-3 py-2.5 font-medium">Valor do Orçamento</th>
                <th className="text-left px-3 py-2.5 font-medium">Produtos</th>
                <th className="text-left px-3 py-2.5 font-medium">Motivo não compra</th>
                <th className="text-left px-3 py-2.5 font-medium">Observação</th>
                <th className="text-left px-3 py-2.5 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((o) => {
                let dt = "—";
                try { dt = format(new Date(o.scheduled_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR }); } catch {}
                return (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{o.nome || "—"}</td>
                    <td className="px-3 py-2">{o.telefone || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dt}</td>
                    <td className="px-3 py-2">{getName(o.scheduled_by)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">R$ {Number(o.orcamento_valor || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 max-w-[240px]">{renderProdutos(o)}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={o.nao_vendido_motivo || ""}>{o.nao_vendido_motivo || "—"}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={o.orcamento_observacao || ""}>{o.orcamento_observacao || "—"}</td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={o.lead_id ? "Editar lead e registrar tentativa de contato" : "Sem lead vinculado"}
                        onClick={() => handleEdit(o)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
