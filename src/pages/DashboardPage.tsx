import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Users, Receipt, CalendarHeart, Phone, PhoneOff, CalendarCheck, CalendarX, Calendar as CalIcon, Building2, ChevronDown, X, ThumbsUp, ThumbsDown, HandCoins } from "lucide-react";

type Profile = { user_id: string; full_name: string; avatar_url: string | null; company_id: string | null };
type Company = { id: string; name: string };

type Totals = { leads: number; cobrancas: number; renovacoes: number };

type SellerRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  company_id: string | null;
  company_name: string;
  atendidos: number;
  agendou: number;
  naoAtendeu: number;
  atendeuSemAgendar: number;
};

type CobrancaRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  company_id: string | null;
  company_name: string;
  contatos: number;
  atendeu: number;
  naoAtendeu: number;
  renegociou: number;
  naoRenegociou: number;
};

const ALL = "__all__";

const rangeBounds = (startStr: string, endStr: string) => {
  const [ys, ms, ds] = startStr.split("-").map(Number);
  const [ye, me, de] = endStr.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
  const end = new Date(ye, me - 1, de, 23, 59, 59, 999);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
};

const formatDateForInput = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export default function DashboardPage() {
  const { user, isAdmin, isGerente, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState<Totals>({ leads: 0, cobrancas: 0, renovacoes: 0 });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [allRows, setAllRows] = useState<SellerRow[]>([]);
  const [cobrancaRows, setCobrancaRows] = useState<CobrancaRow[]>([]);
  const [dateMode, setDateMode] = useState<"day" | "range">("day");
  const [selectedDate, setSelectedDate] = useState<string>(formatDateForInput(new Date()));
  const [startDate, setStartDate] = useState<string>(formatDateForInput(new Date()));
  const [endDate, setEndDate] = useState<string>(formatDateForInput(new Date()));
  // Filtros próprios do Relatório de Cobranças
  const [cobDateMode, setCobDateMode] = useState<"day" | "range">("day");
  const [cobSelectedDate, setCobSelectedDate] = useState<string>(formatDateForInput(new Date()));
  const [cobStartDate, setCobStartDate] = useState<string>(formatDateForInput(new Date()));
  const [cobEndDate, setCobEndDate] = useState<string>(formatDateForInput(new Date()));
  const [loadingCob, setLoadingCob] = useState(true);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());

  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [sellerFilter, setSellerFilter] = useState<string[]>([]); // empty = all

  const canSee = isAdmin || isGerente;

  const fetchTotals = async (companyId: string) => {
    if (companyId === ALL) {
      const [leadsRes, cobRes, renRes] = await Promise.all([
        supabase.from("crm_leads").select("id", { count: "exact", head: true }),
        supabase.from("crm_cobrancas").select("id", { count: "exact", head: true }),
        supabase.from("crm_renovacoes").select("id", { count: "exact", head: true }),
      ]);
      setTotals({
        leads: leadsRes.count || 0,
        cobrancas: cobRes.count || 0,
        renovacoes: renRes.count || 0,
      });
      return;
    }

    // Leads/renovacoes não têm company_id direto — filtramos pelo assigned_to
    // dos vendedores daquela empresa.
    const { data: companyProfiles } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("company_id", companyId);
    const userIds = (companyProfiles || []).map((p: any) => p.user_id);

    if (userIds.length === 0) {
      const cobRes = await supabase
        .from("crm_cobrancas")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      setTotals({ leads: 0, cobrancas: cobRes.count || 0, renovacoes: 0 });
      return;
    }

    const [leadsRes, cobRes, renRes] = await Promise.all([
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .in("assigned_to", userIds),
      supabase
        .from("crm_cobrancas")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("crm_renovacoes")
        .select("id", { count: "exact", head: true })
        .or(`ssotica_company_id.eq.${companyId},assigned_to.in.(${userIds.join(",")})`),
    ]);
    setTotals({
      leads: leadsRes.count || 0,
      cobrancas: cobRes.count || 0,
      renovacoes: renRes.count || 0,
    });
  };

  const fetchReport = async (startStr: string, endStr: string) => {
    const { startISO, endISO } = rangeBounds(startStr, endStr);

    // Profiles + companies + admins (RLS already scopes for gerente)
    const [{ data: profilesData }, { data: companiesData }, { data: adminRoles }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, avatar_url, company_id"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    const profs = (profilesData || []) as Profile[];
    const comps = (companiesData || []) as Company[];
    const adminSet = new Set<string>((adminRoles || []).map((r: any) => r.user_id));
    setProfiles(profs.filter((p) => !adminSet.has(p.user_id)));
    setCompanies(comps);
    setAdminIds(adminSet);
    const compById = new Map(comps.map((c) => [c.id, c.name]));

    const { data: opens } = await supabase
      .from("lead_card_opens")
      .select("user_id, card_type, lead_id, renovacao_id, opened_at")
      .gte("opened_at", startISO)
      .lte("opened_at", endISO);

    // Atendidos: cards distintos abertos por vendedor por dia
    // Chave: vendedor -> Set("dia|tipo:cardId")
    const atendidosMap = new Map<string, Set<string>>();
    const dayKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    (opens || []).forEach((o: any) => {
      if (adminSet.has(o.user_id)) return;
      const cardId = o.lead_id || o.renovacao_id;
      if (!cardId) return;
      const key = `${dayKey(o.opened_at)}|${o.card_type}:${cardId}`;
      if (!atendidosMap.has(o.user_id)) atendidosMap.set(o.user_id, new Set());
      atendidosMap.get(o.user_id)!.add(key);
    });

    const [{ data: leadNotes }, { data: renovNotes }] = await Promise.all([
      supabase
        .from("crm_lead_notes")
        .select("user_id, lead_id, content, created_at")
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      supabase
        .from("crm_renovacao_notes" as any)
        .select("user_id, renovacao_id, content, created_at")
        .gte("created_at", startISO)
        .lte("created_at", endISO),
    ]);

    // Para cada (vendedor, card, dia) armazenamos APENAS a última tentativa de contato.
    // Assim o lead aparece em apenas uma categoria no dia (a mais recente).
    type Cat = "agendou" | "naoAtendeu" | "atendeuSemAgendar";
    type LastEntry = { ts: number; cat: Cat };
    const latestPerCardDay = new Map<string, LastEntry>();
    // chave: `${userId}|${dayKey}|${cardType}:${cardId}`

    const classify = (content: string): Cat | null => {
      if (!content.startsWith("📞 Tentativa de contato")) return null;
      if (content.includes("NÃO ATENDEU")) return "naoAtendeu";
      if (content.includes("ATENDEU")) {
        if (content.includes("✅ Consulta marcada")) return "agendou";
        return "atendeuSemAgendar";
      }
      return null;
    };

    const ingestNote = (
      userId: string,
      cardType: "lead" | "renovacao",
      cardId: string,
      content: string,
      createdAt: string,
    ) => {
      if (adminSet.has(userId)) return;
      const cat = classify(content);
      if (!cat) return;
      const ts = new Date(createdAt).getTime();
      const key = `${userId}|${dayKey(createdAt)}|${cardType}:${cardId}`;
      const prev = latestPerCardDay.get(key);
      if (!prev || ts > prev.ts) latestPerCardDay.set(key, { ts, cat });
    };

    (leadNotes || []).forEach((n: any) =>
      ingestNote(n.user_id, "lead", n.lead_id, n.content || "", n.created_at),
    );
    ((renovNotes as any[]) || []).forEach((n: any) =>
      ingestNote(n.user_id, "renovacao", n.renovacao_id, n.content || "", n.created_at),
    );

    const agendou = new Map<string, number>();
    const naoAtendeu = new Map<string, number>();
    const atendeuSemAgendar = new Map<string, number>();

    latestPerCardDay.forEach((entry, key) => {
      const userId = key.split("|")[0];
      const target =
        entry.cat === "agendou"
          ? agendou
          : entry.cat === "naoAtendeu"
          ? naoAtendeu
          : atendeuSemAgendar;
      target.set(userId, (target.get(userId) || 0) + 1);
    });

    const userIds = new Set<string>([
      ...atendidosMap.keys(),
      ...agendou.keys(),
      ...naoAtendeu.keys(),
      ...atendeuSemAgendar.keys(),
    ]);

    const rows: SellerRow[] = Array.from(userIds).map((uid) => {
      const p = profs.find((x) => x.user_id === uid);
      return {
        user_id: uid,
        full_name: p?.full_name || "(usuário desconhecido)",
        avatar_url: p?.avatar_url || null,
        company_id: p?.company_id || null,
        company_name: p?.company_id ? compById.get(p.company_id) || "—" : "—",
        atendidos: atendidosMap.get(uid)?.size || 0,
        agendou: agendou.get(uid) || 0,
        naoAtendeu: naoAtendeu.get(uid) || 0,
        atendeuSemAgendar: atendeuSemAgendar.get(uid) || 0,
      };
    });

    rows.sort((a, b) => b.atendidos - a.atendidos);
    setAllRows(rows);
  };

  const fetchCobrancaReport = async (startStr: string, endStr: string) => {
    const { startISO, endISO } = rangeBounds(startStr, endStr);

    const [{ data: profilesData }, { data: companiesData }, { data: adminRoles }] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, avatar_url, company_id"),
      supabase.from("companies").select("id, name").order("name"),
      supabase.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    const profs = (profilesData || []) as Profile[];
    const comps = (companiesData || []) as Company[];
    const adminSet = new Set<string>((adminRoles || []).map((r: any) => r.user_id));
    const compById = new Map(comps.map((c) => [c.id, c.name]));

    const { data: notes } = await supabase
      .from("crm_cobranca_notes")
      .select("user_id, cobranca_id, content, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO)
      .order("created_at", { ascending: true });

    type LeadOutcome = {
      lastAt: number;
      atendeu: boolean;
      naoAtendeu: boolean;
      renegociou: boolean;
      naoRenegociou: boolean;
    };
    // Por (user_id|cobranca_id) consolidamos o desfecho do lead no período
    // usando SEMPRE o registro mais recente (última tratativa do dia/período).
    // As notas vêm em ordem ascendente, então o último parse vence.
    const byUserLead = new Map<string, LeadOutcome>();

    (notes || []).forEach((n: any) => {
      if (adminSet.has(n.user_id)) return;
      if (!n.cobranca_id) return;
      const content: string = n.content || "";
      if (!content.startsWith("📞 Tentativa de contato")) return;

      const ts = new Date(n.created_at).getTime();
      const key = `${n.user_id}|${n.cobranca_id}`;
      const prev = byUserLead.get(key);
      if (prev && prev.lastAt > ts) return; // mantém o mais recente

      const outcome: LeadOutcome = {
        lastAt: ts,
        atendeu: false,
        naoAtendeu: false,
        renegociou: false,
        naoRenegociou: false,
      };

      if (content.includes("NÃO ATENDEU")) {
        outcome.naoAtendeu = true;
      } else if (content.includes("ATENDEU")) {
        outcome.atendeu = true;
        if (content.includes("✅ Cliente RENEGOCIOU")) outcome.renegociou = true;
        else if (content.includes("❌ Cliente NÃO renegociou")) outcome.naoRenegociou = true;
      }

      byUserLead.set(key, outcome);
    });

    type Stats = { contatos: number; atendeu: number; naoAtendeu: number; renegociou: number; naoRenegociou: number };
    const byUser = new Map<string, Stats>();
    const ensure = (uid: string) => {
      if (!byUser.has(uid)) {
        byUser.set(uid, { contatos: 0, atendeu: 0, naoAtendeu: 0, renegociou: 0, naoRenegociou: 0 });
      }
      return byUser.get(uid)!;
    };

    byUserLead.forEach((outcome, key) => {
      const uid = key.split("|")[0];
      const s = ensure(uid);
      // Cada lead único conta como 1 contato
      s.contatos += 1;
      // Usa o desfecho mais recente registrado para esse lead
      if (outcome.atendeu) {
        s.atendeu += 1;
        if (outcome.renegociou) s.renegociou += 1;
        else if (outcome.naoRenegociou) s.naoRenegociou += 1;
      } else if (outcome.naoAtendeu) {
        s.naoAtendeu += 1;
      }
    });

    const rows: CobrancaRow[] = Array.from(byUser.entries()).map(([uid, s]) => {
      const p = profs.find((x) => x.user_id === uid);
      return {
        user_id: uid,
        full_name: p?.full_name || "(usuário desconhecido)",
        avatar_url: p?.avatar_url || null,
        company_id: p?.company_id || null,
        company_name: p?.company_id ? compById.get(p.company_id) || "—" : "—",
        contatos: s.contatos,
        atendeu: s.atendeu,
        naoAtendeu: s.naoAtendeu,
        renegociou: s.renegociou,
        naoRenegociou: s.naoRenegociou,
      };
    });

    rows.sort((a, b) => b.contatos - a.contatos);
    setCobrancaRows(rows);
  };

  useEffect(() => {
    if (!canSee || !user) return;
    setLoading(true);
    const start = dateMode === "day" ? selectedDate : startDate;
    const end = dateMode === "day" ? selectedDate : endDate;
    Promise.all([
      fetchTotals(companyFilter),
      fetchReport(start, end),
    ]).finally(() => setLoading(false));
  }, [canSee, user, dateMode, selectedDate, startDate, endDate, companyFilter]);

  // Relatório de Cobranças usa filtros de período próprios
  useEffect(() => {
    if (!canSee || !user) return;
    setLoadingCob(true);
    const start = cobDateMode === "day" ? cobSelectedDate : cobStartDate;
    const end = cobDateMode === "day" ? cobSelectedDate : cobEndDate;
    fetchCobrancaReport(start, end).finally(() => setLoadingCob(false));
  }, [canSee, user, cobDateMode, cobSelectedDate, cobStartDate, cobEndDate]);

  // Realtime: refresh reports when opens or notes change
  useEffect(() => {
    if (!canSee || !user) return;

    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const start = dateMode === "day" ? selectedDate : startDate;
        const end = dateMode === "day" ? selectedDate : endDate;
        const cobStart = cobDateMode === "day" ? cobSelectedDate : cobStartDate;
        const cobEnd = cobDateMode === "day" ? cobSelectedDate : cobEndDate;
        fetchReport(start, end);
        fetchCobrancaReport(cobStart, cobEnd);
        fetchTotals(companyFilter);
      }, 400);
    };

    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_card_opens" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_notes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_renovacao_notes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cobranca_notes" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canSee, user, dateMode, selectedDate, startDate, endDate, companyFilter, cobDateMode, cobSelectedDate, cobStartDate, cobEndDate]);

  // Reset seller filter when company changes
  useEffect(() => {
    setSellerFilter([]);
  }, [companyFilter]);

  // Sellers available given company filter (from profiles, so admin can pick anyone in that company even if no activity yet)
  const availableSellers = useMemo(() => {
    const list = profiles
      .filter((p) => companyFilter === ALL || p.company_id === companyFilter)
      .map((p) => ({ user_id: p.user_id, full_name: p.full_name || "(sem nome)" }));
    list.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return list;
  }, [profiles, companyFilter]);

  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (companyFilter !== ALL && r.company_id !== companyFilter) return false;
      if (sellerFilter.length > 0 && !sellerFilter.includes(r.user_id)) return false;
      return true;
    });
  }, [allRows, companyFilter, sellerFilter]);

  const reportTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        atendidos: acc.atendidos + r.atendidos,
        agendou: acc.agendou + r.agendou,
        naoAtendeu: acc.naoAtendeu + r.naoAtendeu,
        atendeuSemAgendar: acc.atendeuSemAgendar + r.atendeuSemAgendar,
      }),
      { atendidos: 0, agendou: 0, naoAtendeu: 0, atendeuSemAgendar: 0 },
    );
  }, [filteredRows]);

  const filteredCobrancaRows = useMemo(() => {
    return cobrancaRows.filter((r) => {
      if (companyFilter !== ALL && r.company_id !== companyFilter) return false;
      if (sellerFilter.length > 0 && !sellerFilter.includes(r.user_id)) return false;
      return true;
    });
  }, [cobrancaRows, companyFilter, sellerFilter]);

  const cobrancaTotals = useMemo(() => {
    return filteredCobrancaRows.reduce(
      (acc, r) => ({
        contatos: acc.contatos + r.contatos,
        atendeu: acc.atendeu + r.atendeu,
        naoAtendeu: acc.naoAtendeu + r.naoAtendeu,
        renegociou: acc.renegociou + r.renegociou,
        naoRenegociou: acc.naoRenegociou + r.naoRenegociou,
      }),
      { contatos: 0, atendeu: 0, naoAtendeu: 0, renegociou: 0, naoRenegociou: 0 },
    );
  }, [filteredCobrancaRows]);

  const toggleSeller = (uid: string) => {
    setSellerFilter((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  };

  const sellerLabel =
    sellerFilter.length === 0
      ? "Todos os vendedores"
      : sellerFilter.length === 1
      ? availableSellers.find((s) => s.user_id === sellerFilter[0])?.full_name || "1 selecionado"
      : `${sellerFilter.length} selecionados`;

  if (authLoading) {
    return (
      <AppLayout>
        <Skeleton className="h-32 w-full" />
      </AppLayout>
    );
  }

  if (!canSee) return <Navigate to="/" replace />;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral do CRM e relatório diário de atendimentos por vendedor.
          </p>
        </div>

        {/* Totais */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(() => {
            const selectedCompanyName =
              companyFilter === ALL
                ? null
                : companies.find((c) => c.id === companyFilter)?.name || null;
            const suffix = selectedCompanyName ? ` — ${selectedCompanyName}` : "";
            return (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Leads</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold">{totals.leads}</div>}
                    <p className="text-xs text-muted-foreground mt-1">Total de leads cadastrados{suffix}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Cobranças</CardTitle>
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold">{totals.cobrancas}</div>}
                    <p className="text-xs text-muted-foreground mt-1">Total de cobranças no sistema{suffix}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Renovação</CardTitle>
                    <CalendarHeart className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    {loading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold">{totals.renovacoes}</div>}
                    <p className="text-xs text-muted-foreground mt-1">Clientes em renovação{suffix}</p>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>

        {/* Relatório diário */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle>Relatório de atendimentos</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Filtre por empresa e selecione vendedores específicos para detalhar as métricas.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-end gap-2">
                {/* Company */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">Empresa</label>
                  <Select value={companyFilter} onValueChange={setCompanyFilter}>
                    <SelectTrigger className="h-9 w-[220px]">
                      <Building2 className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="Todas as empresas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Todas as empresas</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Sellers (multi) */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">Vendedores</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-9 w-[220px] justify-between font-normal">
                        <span className="truncate">{sellerLabel}</span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0" align="end">
                      <div className="p-2 border-b flex items-center justify-between">
                        <span className="text-xs font-medium">
                          {sellerFilter.length} de {availableSellers.length}
                        </span>
                        {sellerFilter.length > 0 && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSellerFilter([])}>
                            <X className="h-3 w-3 mr-1" /> Limpar
                          </Button>
                        )}
                      </div>
                      <div className="max-h-[260px] overflow-y-auto py-1">
                        {availableSellers.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-4 px-3 text-center">
                            Nenhum vendedor para esta empresa.
                          </p>
                        ) : (
                          availableSellers.map((s) => (
                            <label
                              key={s.user_id}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
                            >
                              <Checkbox
                                checked={sellerFilter.includes(s.user_id)}
                                onCheckedChange={() => toggleSeller(s.user_id)}
                              />
                              <span className="truncate">{s.full_name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Date mode */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">Período</label>
                  <Select value={dateMode} onValueChange={(v) => setDateMode(v as "day" | "range")}>
                    <SelectTrigger className="h-9 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Dia</SelectItem>
                      <SelectItem value="range">Intervalo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date(s) */}
                {dateMode === "day" ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">Data</label>
                    <div className="relative">
                      <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="h-9 w-[170px] pl-7"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground uppercase">De</label>
                      <div className="relative">
                        <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          type="date"
                          value={startDate}
                          max={endDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="h-9 w-[160px] pl-7"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground uppercase">Até</label>
                      <div className="relative">
                        <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          type="date"
                          value={endDate}
                          min={startDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="h-9 w-[160px] pl-7"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Resumo */}
            <div className="grid gap-3 sm:grid-cols-4 mb-4">
              <SummaryStat label="Atendidos" value={reportTotals.atendidos} icon={Users} tone="default" />
              <SummaryStat label="Agendaram" value={reportTotals.agendou} icon={CalendarCheck} tone="success" />
              <SummaryStat label="Não atenderam" value={reportTotals.naoAtendeu} icon={PhoneOff} tone="danger" />
              <SummaryStat label="Sem agendar" value={reportTotals.atendeuSemAgendar} icon={CalendarX} tone="warning" />
            </div>

            <Tabs defaultValue="vendedores">
              <TabsContent value="vendedores" className="mt-0">
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : filteredRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Nenhum atendimento registrado para os filtros selecionados.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendedor</TableHead>
                          <TableHead>Empresa</TableHead>
                          <TableHead className="text-center">
                            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Atendidos</span>
                          </TableHead>
                          <TableHead className="text-center">
                            <span className="inline-flex items-center gap-1 text-emerald-600"><CalendarCheck className="h-3.5 w-3.5" /> Agendaram</span>
                          </TableHead>
                          <TableHead className="text-center">
                            <span className="inline-flex items-center gap-1 text-destructive"><PhoneOff className="h-3.5 w-3.5" /> Não atenderam</span>
                          </TableHead>
                          <TableHead className="text-center">
                            <span className="inline-flex items-center gap-1 text-amber-600"><CalendarX className="h-3.5 w-3.5" /> Sem agendar</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.map((row) => (
                          <TableRow key={row.user_id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7">
                                  <AvatarImage src={row.avatar_url ?? undefined} />
                                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                    {(row.full_name || "?").slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{row.full_name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{row.company_name}</TableCell>
                            <TableCell className="text-center font-semibold">{row.atendidos}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 bg-emerald-500/10">
                                {row.agendou}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10">
                                {row.naoAtendeu}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-500/10">
                                {row.atendeuSemAgendar}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <p className="text-[11px] text-muted-foreground mt-4">
              <Phone className="h-3 w-3 inline mr-1" />
              "Atendidos" = cards distintos abertos pelo vendedor no dia. "Agendaram", "Não atenderam" e
              "Sem agendar" vêm das tentativas de contato registradas em cada card.
            </p>
          </CardContent>
        </Card>

        {/* Relatório de Cobranças */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle>Relatório de Cobranças</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Tentativas de contato registradas em cobranças. Os filtros de empresa e vendedores
                  acima continuam valendo; o período abaixo é exclusivo deste relatório.
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase">Período</label>
                  <Select value={cobDateMode} onValueChange={(v) => setCobDateMode(v as "day" | "range")}>
                    <SelectTrigger className="h-9 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Dia</SelectItem>
                      <SelectItem value="range">Intervalo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {cobDateMode === "day" ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground uppercase">Data</label>
                    <div className="relative">
                      <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        type="date"
                        value={cobSelectedDate}
                        onChange={(e) => setCobSelectedDate(e.target.value)}
                        className="h-9 w-[170px] pl-7"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground uppercase">De</label>
                      <div className="relative">
                        <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          type="date"
                          value={cobStartDate}
                          max={cobEndDate}
                          onChange={(e) => setCobStartDate(e.target.value)}
                          className="h-9 w-[160px] pl-7"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-muted-foreground uppercase">Até</label>
                      <div className="relative">
                        <CalIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          type="date"
                          value={cobEndDate}
                          min={cobStartDate}
                          onChange={(e) => setCobEndDate(e.target.value)}
                          className="h-9 w-[160px] pl-7"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
              <SummaryStat label="Contatos" value={cobrancaTotals.contatos} icon={Phone} tone="default" />
              <SummaryStat label="Atenderam" value={cobrancaTotals.atendeu} icon={Phone} tone="success" />
              <SummaryStat label="Não atenderam" value={cobrancaTotals.naoAtendeu} icon={PhoneOff} tone="danger" />
              <SummaryStat label="Renegociaram" value={cobrancaTotals.renegociou} icon={HandCoins} tone="success" />
              <SummaryStat label="Não renegociaram" value={cobrancaTotals.naoRenegociou} icon={ThumbsDown} tone="warning" />
            </div>

            {loadingCob ? (
              <Skeleton className="h-40 w-full" />
            ) : filteredCobrancaRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma tentativa de contato em cobranças no período selecionado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead className="text-center">
                        <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> Contatos</span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="inline-flex items-center gap-1 text-emerald-600"><Phone className="h-3.5 w-3.5" /> Atenderam</span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="inline-flex items-center gap-1 text-destructive"><PhoneOff className="h-3.5 w-3.5" /> Não atenderam</span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="inline-flex items-center gap-1 text-emerald-600"><ThumbsUp className="h-3.5 w-3.5" /> Renegociaram</span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="inline-flex items-center gap-1 text-amber-600"><ThumbsDown className="h-3.5 w-3.5" /> Não renegociaram</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCobrancaRows.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={row.avatar_url ?? undefined} />
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {(row.full_name || "?").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{row.full_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{row.company_name}</TableCell>
                        <TableCell className="text-center font-semibold">{row.contatos}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 bg-emerald-500/10">
                            {row.atendeu}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10">
                            {row.naoAtendeu}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 bg-emerald-500/10">
                            {row.renegociou}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-500/10">
                            {row.naoRenegociou}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-4">
              <Phone className="h-3 w-3 inline mr-1" />
              "Contatos" conta cada lead único com tentativa registrada (mesmo que aberto várias vezes no dia).
              "Renegociaram" e "Não renegociaram" são contadas apenas quando o cliente atendeu.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: any;
  tone: "default" | "success" | "danger" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
      : tone === "danger"
      ? "text-destructive bg-destructive/10 border-destructive/30"
      : tone === "warning"
      ? "text-amber-700 bg-amber-500/10 border-amber-500/30"
      : "text-foreground bg-muted/40 border-border";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
