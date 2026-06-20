import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CidadeLojaRoute } from "@/lib/campanha-copa-cidade";

type Company = { id: string; name: string };

type Props = {
  onSaved?: () => void;
};

export default function CampanhaCopaCidadeLojaConfigCard({ onSaved }: Props) {
  const [routes, setRoutes] = useState<(CidadeLojaRoute & { company_name?: string })[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [cidadeLabel, setCidadeLabel] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    const [routeRes, compRes] = await Promise.all([
      supabase
        .from("campanha_copa_cidade_lojas" as never)
        .select("id, cidade_label, company_id")
        .order("cidade_label"),
      supabase.from("companies").select("id, name").order("name"),
    ]);
    const comps = (compRes.data || []) as Company[];
    setCompanies(comps);
    const compMap = new Map(comps.map((c) => [c.id, c.name]));
    setRoutes(
      ((routeRes.data || []) as CidadeLojaRoute[]).map((r) => ({
        ...r,
        company_name: compMap.get(r.company_id) || r.company_id.slice(0, 8),
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const addRoute = async () => {
    if (!cidadeLabel.trim() || !companyId) {
      toast.error("Informe a cidade e selecione a loja.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("campanha_copa_cidade_lojas" as never).insert({
        cidade_label: cidadeLabel.trim(),
        company_id: companyId,
      } as never);
      if (error) throw error;
      toast.success("Cidade vinculada à loja.");
      setCidadeLabel("");
      setCompanyId("");
      await load();
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar vínculo");
    } finally {
      setSaving(false);
    }
  };

  const removeRoute = async (id: string) => {
    const { error } = await supabase
      .from("campanha_copa_cidade_lojas" as never)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao remover vínculo");
      return;
    }
    toast.success("Vínculo removido.");
    await load();
    onSaved?.();
  };

  const companyOptions = useMemo(() => companies, [companies]);
  const VISIBLE_LIMIT = 3;
  const visibleRoutes = expanded ? routes : routes.slice(0, VISIBLE_LIMIT);
  const hiddenCount = routes.length - visibleRoutes.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Cidades e lojas
        </CardTitle>
        <CardDescription>
          Vincule cada cidade do formulário a uma loja (empresa). A atribuição a vendedores e gerentes
          só ocorre quando você usar o botão &quot;Distribuir sem responsável&quot; na lista de inscrições.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="cidade-label">Cidade (como no formulário)</Label>
            <Input
              id="cidade-label"
              value={cidadeLabel}
              onChange={(e) => setCidadeLabel(e.target.value)}
              placeholder="Ex.: Caicó/RN ou Parelhas-RN"
            />
          </div>
          <div className="space-y-2">
            <Label>Loja (empresa)</Label>
            <Select value={companyId || undefined} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a loja" />
              </SelectTrigger>
              <SelectContent>
                {companyOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void addRoute()} disabled={saving}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando vínculos...</p>
        ) : routes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma cidade configurada. Inscrições ficarão sem responsável até você vincular.
          </p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRoutes.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.cidade_label}</TableCell>
                    <TableCell>{r.company_name}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => void removeRoute(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && routes.length > VISIBLE_LIMIT && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Ver menos
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Ver todas ({hiddenCount} ocultas)
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
