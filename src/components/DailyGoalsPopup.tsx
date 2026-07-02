import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target, Store } from "lucide-react";
import { format } from "date-fns";

type Scope = "user" | "company";
type SalesGoal = {
  id: string;
  scope: Scope;
  company_id: string;
  user_id: string | null;
  label: string | null;
  period_start: string;
  period_end: string;
  target_amount: number;
  atingido_amount: number;
};
type Company = { id: string; name: string };

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => format(new Date(d + "T00:00:00"), "dd/MM/yyyy");
const todayKey = () => new Date().toISOString().slice(0, 10);

/** Popup exibido uma vez por dia (por usuário/navegador) com a meta da loja
 * e, quando existir, a meta individual do usuário logado. */
export default function DailyGoalsPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [minhaMeta, setMinhaMeta] = useState<SalesGoal | null>(null);
  const [metaLoja, setMetaLoja] = useState<SalesGoal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    const storageKey = `metas_popup_shown:${user.id}:${todayKey()}`;
    if (localStorage.getItem(storageKey)) return;

    (async () => {
      const { data } = await supabase
        .from("sales_goals")
        .select("*")
        .order("period_start", { ascending: false });
      const rows = (data as SalesGoal[]) || [];
      const own = rows.find((g) => g.scope === "user" && g.user_id === user.id) || null;
      const loja = rows.filter((g) => g.scope === "company");

      // Marca como exibido hoje independente de haver meta ou não, para não
      // ficar reconsultando a cada página aberta no mesmo dia.
      localStorage.setItem(storageKey, "1");

      if (!own && loja.length === 0) return;

      const companyIds = Array.from(
        new Set([own?.company_id, ...loja.map((g) => g.company_id)].filter(Boolean)),
      ) as string[];
      if (companyIds.length > 0) {
        const { data: comps } = await supabase.from("companies").select("id, name").in("id", companyIds);
        setCompanies((comps as Company[]) || []);
      }
      setMinhaMeta(own);
      setMetaLoja(loja);
      setOpen(true);
    })();
  }, [user?.id]);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || "—";

  const GoalRow = ({ g, title }: { g: SalesGoal; title: string }) => {
    const pct = g.target_amount > 0 ? (g.atingido_amount / g.target_amount) * 100 : 0;
    return (
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-sm">{title}</div>
            <div className="text-xs text-muted-foreground">
              {companyName(g.company_id)} · {fmtDate(g.period_start)} a {fmtDate(g.period_end)}
            </div>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/30 shrink-0">
            {pct.toFixed(2)}%
          </Badge>
        </div>
        <Progress value={Math.min(100, Math.max(0, pct))} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Atingido: <span className="font-medium text-foreground">{fmtBRL(g.atingido_amount)}</span>
          </span>
          <span>
            Meta: <span className="font-medium text-foreground">{fmtBRL(g.target_amount)}</span>
          </span>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Metas do período
          </DialogTitle>
          <DialogDescription>Confira o quanto já foi realizado até agora.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {minhaMeta && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Target className="h-3 w-3" />
                Minha meta
              </div>
              <GoalRow g={minhaMeta} title={minhaMeta.label || "Minha meta"} />
            </div>
          )}

          {metaLoja.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Store className="h-3 w-3" />
                Meta da loja
              </div>
              {metaLoja.map((g) => (
                <GoalRow key={g.id} g={g} title={g.label || companyName(g.company_id)} />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          <Button onClick={() => { setOpen(false); navigate("/metas"); }}>Ver todas as metas</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
