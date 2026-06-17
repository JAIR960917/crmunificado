import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Loader2, MapPin, Building2 } from "lucide-react";

type Company = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  onSuccess: () => void;
};

type Mode = "cidade" | "empresa";

export default function AllocateUnassignedDialog({ open, onOpenChange, companies, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>("cidade");
  const [companyId, setCompanyId] = useState("");
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [allocating, setAllocating] = useState(false);

  const sortedCompanies = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  useEffect(() => {
    if (!open) {
      setMode("cidade");
      setCompanyId("");
      setUnassignedCount(null);
      return;
    }
    setLoadingCount(true);
    supabase
      .rpc("count_unassigned_leads")
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          setUnassignedCount(null);
        } else {
          setUnassignedCount(typeof data === "number" ? data : 0);
        }
      })
      .finally(() => setLoadingCount(false));
  }, [open]);

  const canSubmit =
    !allocating &&
    (unassignedCount ?? 0) > 0 &&
    (mode === "cidade" || !!companyId);

  const handleAllocateByCity = async () => {
    const { data, error } = await supabase.functions.invoke("allocate-leads-by-city", { body: {} });
    if (error) throw error;
    const result = data as {
      total_assigned?: number;
      sem_cidade?: number;
      sem_empresa_mapeada?: number;
      companies?: Record<string, { assigned: number; vendedores: number }>;
      error?: string;
    } | null;
    if (result?.error) throw new Error(result.error);
    const totalAssigned = result?.total_assigned ?? 0;
    const semCidade = result?.sem_cidade ?? 0;
    const semEmpresa = result?.sem_empresa_mapeada ?? 0;
    if (totalAssigned === 0) {
      toast.info("Nenhum lead pôde ser alocado por cidade (verifique o mapeamento de cidades/lojas).");
    } else {
      const empresasAtingidas = Object.keys(result?.companies ?? {}).length;
      toast.success(`${totalAssigned} lead(s) distribuído(s) entre ${empresasAtingidas} empresa(s) pela cidade.`);
    }
    if (semCidade > 0 || semEmpresa > 0) {
      toast.warning(
        `${semCidade} sem cidade informada, ${semEmpresa} com cidade sem empresa mapeada — permanecem sem usuário.`,
      );
    }
  };

  const handleAllocateByCompany = async () => {
    const { data, error } = await supabase.rpc("allocate_unassigned_leads_round_robin", {
      p_company_id: companyId,
    });
    if (error) throw error;
    const result = data as { assigned?: number; vendedores?: number } | null;
    const assigned = result?.assigned ?? 0;
    const vendedores = result?.vendedores ?? 0;
    if (assigned === 0) {
      toast.info("Nenhum lead sem usuário alocado para distribuir.");
    } else {
      toast.success(`${assigned} lead(s) distribuído(s) entre ${vendedores} usuário(s) de ${companyName(companyId)}.`);
    }
  };

  const handleAllocate = async () => {
    if (!canSubmit) return;
    setAllocating(true);
    try {
      if (mode === "cidade") {
        await handleAllocateByCity();
      } else {
        await handleAllocateByCompany();
      }
      onOpenChange(false);
      onSuccess();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao alocar leads";
      toast.error(msg);
    } finally {
      setAllocating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Alocar leads sem usuário
          </DialogTitle>
          <DialogDescription>
            Distribui automaticamente (round-robin) os leads sem vendedor/gerente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {loadingCount
              ? "Contando leads sem usuário…"
              : unassignedCount !== null
                ? `${unassignedCount} lead(s) sem usuário alocado no momento.`
                : null}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "cidade" ? "default" : "outline"}
              onClick={() => setMode("cidade")}
              className="h-auto w-full flex-col items-start justify-start gap-1 whitespace-normal py-2 text-left"
            >
              <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                <MapPin className="h-4 w-4 shrink-0" /> Por cidade
              </span>
              <span className="block w-full whitespace-normal text-xs font-normal leading-snug opacity-80">
                Envia cada lead para a empresa correta, conforme a cidade dele
              </span>
            </Button>
            <Button
              type="button"
              variant={mode === "empresa" ? "default" : "outline"}
              onClick={() => setMode("empresa")}
              className="h-auto w-full flex-col items-start justify-start gap-1 whitespace-normal py-2 text-left"
            >
              <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                <Building2 className="h-4 w-4 shrink-0" /> Empresa específica
              </span>
              <span className="block w-full whitespace-normal text-xs font-normal leading-snug opacity-80">
                Envia todos os leads sem usuário para uma única empresa escolhida
              </span>
            </Button>
          </div>

          {mode === "empresa" && (
            <div className="space-y-2">
              <Label>Empresa de destino</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {sortedCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "cidade" && (
            <p className="text-xs text-muted-foreground">
              Usa o mesmo mapeamento de cidades configurado em Campanha Copa. Leads sem
              cidade informada ou com cidade não mapeada para nenhuma empresa permanecem
              sem usuário.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={allocating}>
            Cancelar
          </Button>
          <Button onClick={handleAllocate} disabled={!canSubmit}>
            {allocating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Alocando…
              </>
            ) : (
              "Alocar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
