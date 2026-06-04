import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";

export type BulkTransferProfile = {
  user_id: string;
  full_name: string;
};

type BulkTransferModule = "leads" | "renovacoes";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: BulkTransferModule;
  entityLabel: string;
  sourceProfiles: BulkTransferProfile[];
  destProfiles: BulkTransferProfile[];
  companyId?: string | null;
  onSuccess: () => void;
};

export default function BulkTransferDialog({
  open,
  onOpenChange,
  module,
  entityLabel,
  sourceProfiles,
  destProfiles,
  companyId,
  onSuccess,
}: Props) {
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [available, setAvailable] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const sortedSource = useMemo(
    () => [...sourceProfiles].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [sourceProfiles],
  );
  const sortedDest = useMemo(
    () => [...destProfiles].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [destProfiles],
  );

  const destOptions = useMemo(
    () => sortedDest.filter((p) => p.user_id !== fromUserId),
    [sortedDest, fromUserId],
  );

  const refreshCount = useCallback(async (fromId: string) => {
    if (!fromId) {
      setAvailable(null);
      return;
    }
    setLoadingCount(true);
    try {
      const { data, error } = await supabase.rpc("count_transferable_crm_records", {
        p_module: module,
        p_from_user_id: fromId,
        p_company_id: companyId && companyId !== "all" ? companyId : null,
      });
      if (error) throw error;
      setAvailable(typeof data === "number" ? data : 0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao contar registros";
      toast.error(msg);
      setAvailable(null);
    } finally {
      setLoadingCount(false);
    }
  }, [module, companyId]);

  useEffect(() => {
    if (!open) return;
    if (fromUserId) void refreshCount(fromUserId);
  }, [open, fromUserId, refreshCount]);

  useEffect(() => {
    if (!open) {
      setFromUserId("");
      setToUserId("");
      setQuantity("10");
      setAvailable(null);
    }
  }, [open]);

  useEffect(() => {
    if (toUserId && toUserId === fromUserId) setToUserId("");
  }, [fromUserId, toUserId]);

  const parsedQty = parseInt(quantity, 10);
  const qtyValid = Number.isFinite(parsedQty) && parsedQty >= 1;
  const canSubmit =
    !!fromUserId &&
    !!toUserId &&
    fromUserId !== toUserId &&
    qtyValid &&
    !transferring &&
    (available === null || parsedQty <= available);

  const handleTransfer = async () => {
    if (!canSubmit) return;
    setTransferring(true);
    try {
      const { data, error } = await supabase.rpc("bulk_transfer_crm_records", {
        p_module: module,
        p_from_user_id: fromUserId,
        p_to_user_id: toUserId,
        p_quantity: parsedQty,
        p_company_id: companyId && companyId !== "all" ? companyId : null,
      });
      if (error) throw error;
      const result = data as { transferred?: number; requested?: number } | null;
      const transferred = result?.transferred ?? 0;
      const requested = result?.requested ?? parsedQty;
      if (transferred === 0) {
        toast.info(`Nenhum ${entityLabel.slice(0, -1) || "registro"} disponível para transferir.`);
      } else if (transferred < requested) {
        toast.success(`${transferred} ${entityLabel} transferido(s) (solicitados: ${requested}).`);
      } else {
        toast.success(`${transferred} ${entityLabel} transferido(s) com sucesso.`);
      }
      onOpenChange(false);
      onSuccess();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro na transferência";
      toast.error(msg);
    } finally {
      setTransferring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Transferência em massa
          </DialogTitle>
          <DialogDescription>
            Transfira {entityLabel} de um usuário para outro. Os mais antigos são transferidos primeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>De quem saem os {entityLabel}</Label>
            <Select value={fromUserId} onValueChange={setFromUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a origem" />
              </SelectTrigger>
              <SelectContent>
                {sortedSource.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || "Sem nome"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fromUserId && (
              <p className="text-xs text-muted-foreground">
                {loadingCount
                  ? "Contando disponíveis…"
                  : available !== null
                    ? `${available} ${entityLabel} disponível(is) para transferência`
                    : null}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Para quem vão os {entityLabel}</Label>
            <Select value={toUserId} onValueChange={setToUserId} disabled={!fromUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o destino" />
              </SelectTrigger>
              <SelectContent>
                {destOptions.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>
                    {p.full_name || "Sem nome"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              max={available ?? 5000}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ex: 50"
            />
            {available !== null && qtyValid && parsedQty > available && (
              <p className="text-xs text-destructive">
                Máximo disponível: {available}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={transferring}>
            Cancelar
          </Button>
          <Button onClick={handleTransfer} disabled={!canSubmit}>
            {transferring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferindo…
              </>
            ) : (
              "Transferir"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
