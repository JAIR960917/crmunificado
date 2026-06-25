import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Search, History, TrendingUp, CheckCircle2, XCircle } from "lucide-react";
import { brl } from "@/lib/crediarioFinance";
import { useAuth } from "@/contexts/AuthContext";

export default function CrediarioDashboardPage() {
  const { user, isGerente } = useAuth();
  const [stats, setStats] = useState({ consultas: 0, vendas: 0, aprovadas: 0, recusadas: 0, total: 0 });

  useEffect(() => {
    const load = async () => {
      const now = new Date();
      const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const inicioProxMes = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

      const [{ count: c1 }, { data: vendas }] = await Promise.all([
        supabase
          .from("crediario_consultas")
          .select("*", { count: "exact", head: true })
          .gte("created_at", inicioMes)
          .lt("created_at", inicioProxMes),
        supabase
          .from("crediario_vendas")
          .select("status, valor_total, created_at")
          .gte("created_at", inicioMes)
          .lt("created_at", inicioProxMes),
      ]);
      const aprov = vendas?.filter((v) => v.status === "aprovado") ?? [];
      const recus = vendas?.filter((v) => v.status === "recusado") ?? [];
      setStats({
        consultas: c1 ?? 0,
        vendas: vendas?.length ?? 0,
        aprovadas: aprov.length,
        recusadas: recus.length,
        total: aprov.reduce((s, v) => s + Number(v.valor_total), 0),
      });
    };
    load();
  }, []);

  const cards = [
    { label: "Consultas", value: stats.consultas, icon: Search, color: "text-primary" },
    { label: "Vendas aprovadas", value: stats.aprovadas, icon: CheckCircle2, color: "text-emerald-500" },
    { label: "Vendas recusadas", value: stats.recusadas, icon: XCircle, color: "text-destructive" },
    { label: "Volume aprovado", value: brl(stats.total), icon: TrendingUp, color: "text-amber-500" },
  ];

  return (
    <AppLayout>
      <header className="mb-8">
        <p className="text-sm text-muted-foreground">Olá, {user?.email?.split("@")[0]}</p>
        <h1 className="text-3xl font-bold tracking-tight">Crediário</h1>
      </header>

      {!isGerente && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <c.icon className={`h-5 w-5 ${c.color}`} />
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <Search className="h-7 w-7 text-primary" />
            <h3 className="mt-4 text-xl font-semibold">Vender no Boleto</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Busque dados, score e simule a venda na hora.
            </p>
            <Button asChild className="mt-4">
              <Link to="/crediario/consulta">Consultar CPF</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <History className="h-7 w-7 text-primary" />
            <h3 className="mt-4 text-xl font-semibold">Pagamento na Entrega</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Gere promissórias para vendas com pagamento na entrega.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/crediario/pagamento-entrega">Gerar promissória</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
