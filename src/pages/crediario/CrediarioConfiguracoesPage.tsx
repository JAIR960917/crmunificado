import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, EyeOff, Settings as SettingsIcon } from "lucide-react";
import type { ScoreTier } from "@/lib/crediarioFinance";

interface Settings {
  id: string;
  min_score: number;
  max_installments: number;
  score_tiers: ScoreTier[];
  renegociacao_max_parcelas: number;
  renegociacao_juros_percent: number;
}

const defaultTiers: ScoreTier[] = [
  { min: 0, max: 100, entry_suggested_percent: 100, entry_min_percent: 100, rate: 0 },
  { min: 101, max: 299, entry_suggested_percent: 40, entry_min_percent: 35, rate: 4.0 },
  { min: 300, max: 400, entry_suggested_percent: 35, entry_min_percent: 30, rate: 3.5 },
  { min: 401, max: 500, entry_suggested_percent: 30, entry_min_percent: 25, rate: 3.0 },
  { min: 501, max: 600, entry_suggested_percent: 25, entry_min_percent: 20, rate: 2.5 },
  { min: 601, max: 1000, entry_suggested_percent: 20, entry_min_percent: 15, rate: 2.0 },
];

function normalizeTier(t: Partial<ScoreTier>): ScoreTier {
  const min_pct = t.entry_min_percent ?? 0;
  const sug_pct = t.entry_suggested_percent ?? min_pct;
  return {
    min: t.min ?? 0,
    max: t.max ?? 0,
    entry_suggested_percent: sug_pct,
    entry_min_percent: min_pct,
    rate: t.rate ?? 0,
  };
}

export default function CrediarioConfiguracoesPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("crediario_settings").select("*").limit(1).maybeSingle();
      if (data) {
        const raw = (data.score_tiers as unknown as Array<Partial<ScoreTier>>) ?? [];
        const tiers = raw.map(normalizeTier);
        setS({
          id: data.id,
          min_score: data.min_score,
          max_installments: data.max_installments,
          score_tiers: tiers.length ? tiers : defaultTiers,
          renegociacao_max_parcelas: data.renegociacao_max_parcelas ?? 12,
          renegociacao_juros_percent: data.renegociacao_juros_percent ?? 0,
        });
      } else {
        // Primeira vez: cria a linha de configuração padrão.
        const { data: created } = await supabase
          .from("crediario_settings")
          .insert({ score_tiers: defaultTiers as unknown as never })
          .select("*")
          .single();
        if (created) {
          setS({
            id: created.id,
            min_score: created.min_score,
            max_installments: created.max_installments,
            score_tiers: defaultTiers,
            renegociacao_max_parcelas: created.renegociacao_max_parcelas,
            renegociacao_juros_percent: created.renegociacao_juros_percent,
          });
        }
      }
    })();
  }, []);

  if (!s) return <AppLayout><Loader2 className="h-6 w-6 animate-spin" /></AppLayout>;

  const setField = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  const updateTier = (idx: number, patch: Partial<ScoreTier>) => {
    const next = s.score_tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setField("score_tiers", next);
  };

  const removeTier = (idx: number) => {
    setField("score_tiers", s.score_tiers.filter((_, i) => i !== idx));
  };

  const addTier = () => {
    const last = s.score_tiers[s.score_tiers.length - 1];
    const min = last ? last.max + 1 : 0;
    setField("score_tiers", [
      ...s.score_tiers,
      { min, max: Math.max(min + 99, 1000), entry_suggested_percent: 20, entry_min_percent: 15, rate: 2.0 },
    ]);
  };

  const save = async () => {
    for (const t of s.score_tiers) {
      if (
        t.min < 0 || t.max < t.min ||
        t.entry_suggested_percent < 0 || t.entry_suggested_percent > 100 ||
        t.entry_min_percent < 0 || t.entry_min_percent > 100 ||
        t.entry_suggested_percent < t.entry_min_percent ||
        t.rate < 0
      ) {
        toast.error("Faixa inválida", {
          description: `Faixa ${t.min}-${t.max}: a entrada sugerida deve ser ≥ entrada mínima e todos os valores entre 0 e 100.`,
        });
        return;
      }
    }
    setSaving(true);
    const tiersSorted = [...s.score_tiers].sort((a, b) => a.min - b.min);
    const { error } = await supabase.from("crediario_settings").update({
      min_score: s.min_score,
      max_installments: s.max_installments,
      score_tiers: tiersSorted as unknown as never,
      renegociacao_max_parcelas: s.renegociacao_max_parcelas,
      renegociacao_juros_percent: s.renegociacao_juros_percent,
    }).eq("id", s.id);
    setSaving(false);
    if (error) toast.error("Erro ao salvar", { description: error.message });
    else {
      toast.success("Configurações salvas");
      setField("score_tiers", tiersSorted);
    }
  };

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-7 w-7 text-primary" /> Configurações do Crediário
        </h1>
        <p className="text-muted-foreground">
          Regras de negócio (score, taxas, renegociação). Marca/template de contrato, Cora, ZapSign e papéis seguem
          as configurações gerais do sistema — ainda não portados para esta tela.
        </p>
      </header>

      <div className="grid gap-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Critérios gerais</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Score mínimo para financiar</Label>
                <Input
                  type="number"
                  value={s.min_score}
                  onChange={(e) => setField("min_score", parseInt(e.target.value || "0"))}
                />
                <p className="text-xs text-muted-foreground">
                  Abaixo deste score a venda só pode ser à vista (entrada 100%).
                </p>
              </div>
              <div className="space-y-2">
                <Label>Parcelas máximas</Label>
                <Input
                  type="number"
                  value={s.max_installments}
                  onChange={(e) => setField("max_installments", parseInt(e.target.value || "0"))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Faixas de score</h2>
                <p className="text-sm text-muted-foreground">
                  Para cada faixa: entrada <strong>sugerida</strong> (mostrada ao vendedor),
                  entrada <strong>mínima</strong> (oculta — vendas abaixo exigem autorização do administrador)
                  e taxa de juros mensal.
                </p>
              </div>
              <Button onClick={addTier} variant="outline" size="sm">
                <Plus className="mr-1 h-4 w-4" />Nova faixa
              </Button>
            </div>

            <div className="overflow-x-auto">
              <div className="grid grid-cols-[1fr_1fr_1.2fr_1.2fr_1fr_auto] gap-2 px-2 pb-2 text-xs font-medium text-muted-foreground">
                <div>Score mín.</div>
                <div>Score máx.</div>
                <div>Entrada sugerida (%)</div>
                <div className="flex items-center gap-1">
                  <EyeOff className="h-3 w-3" />Entrada mínima (%)
                </div>
                <div>Juros (% a.m.)</div>
                <div></div>
              </div>
              <div className="space-y-2">
                {s.score_tiers.map((t, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1.2fr_1.2fr_1fr_auto] items-center gap-2 rounded-lg border bg-card p-2">
                    <Input
                      type="number"
                      value={t.min}
                      onChange={(e) => updateTier(idx, { min: parseInt(e.target.value || "0") })}
                    />
                    <Input
                      type="number"
                      value={t.max}
                      onChange={(e) => updateTier(idx, { max: parseInt(e.target.value || "0") })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={t.entry_suggested_percent}
                      onChange={(e) => updateTier(idx, { entry_suggested_percent: parseFloat(e.target.value || "0") })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={t.entry_min_percent}
                      onChange={(e) => updateTier(idx, { entry_min_percent: parseFloat(e.target.value || "0") })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={t.rate}
                      onChange={(e) => updateTier(idx, { rate: parseFloat(e.target.value || "0") })}
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeTier(idx)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Exemplo: faixa <strong>501–600</strong> com sugerida <strong>25%</strong>, mínima <strong>20%</strong> e juros <strong>2,5%</strong> a.m. —
              o vendedor verá a sugestão de 25% e poderá reduzir até 20%; abaixo disso o sistema bloqueia.
              A entrada mínima nunca aparece para o vendedor.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Renegociação</h2>
            <p className="text-sm text-muted-foreground">
              Regras aplicadas na tela de renegociação. Se a taxa de juros for <strong>0</strong>, as parcelas serão sem juros.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Parcelas máximas (renegociação)</Label>
                <Input
                  type="number"
                  min={1}
                  value={s.renegociacao_max_parcelas}
                  onChange={(e) => setField("renegociacao_max_parcelas", parseInt(e.target.value || "1"))}
                />
              </div>
              <div className="space-y-2">
                <Label>Juros mensal da renegociação (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={s.renegociacao_juros_percent}
                  onChange={(e) => setField("renegociacao_juros_percent", parseFloat(e.target.value || "0"))}
                />
                <p className="text-xs text-muted-foreground">Use 0 para renegociação sem juros.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={save} disabled={saving} size="lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar configurações"}
        </Button>
      </div>
    </AppLayout>
  );
}
