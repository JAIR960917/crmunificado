import { CalendarIcon, ThumbsDown, ThumbsUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type RenegociacaoStatus = "sim" | "nao" | null;

type Props = {
  status: RenegociacaoStatus;
  onStatusChange: (status: RenegociacaoStatus) => void;
  comentario: string;
  onComentarioChange: (value: string) => void;
  proximaData: Date | undefined;
  onProximaDataChange: (date: Date | undefined) => void;
  proximaTime: string;
  onProximaTimeChange: (value: string) => void;
};

export default function CrediarioRenegociacaoPanel({
  status,
  onStatusChange,
  comentario,
  onComentarioChange,
  proximaData,
  onProximaDataChange,
  proximaTime,
  onProximaTimeChange,
}: Props) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-4 h-full">
      <div>
        <h3 className="text-sm font-semibold">Renegociação</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Informe se conseguiu realizar a renegociação com o lead.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Conseguiu realizar a renegociação?</Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            size="sm"
            variant={status === "sim" ? "default" : "outline"}
            className={cn("flex-1", status === "sim" && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => onStatusChange("sim")}
          >
            <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Sim, renegociei
          </Button>
          <Button
            type="button"
            size="sm"
            variant={status === "nao" ? "destructive" : "outline"}
            className="flex-1"
            onClick={() => onStatusChange("nao")}
          >
            <ThumbsDown className="h-3.5 w-3.5 mr-1" /> Não renegociei
          </Button>
        </div>
      </div>

      {status === "sim" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">
              Comentários da renegociação <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={comentario}
              onChange={(e) => onComentarioChange(e.target.value)}
              rows={4}
              placeholder="Descreva o que foi acordado com o cliente..."
              className="text-sm min-h-[96px]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">
              Próxima renegociação <span className="text-destructive">*</span>
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Será criada uma nova tarefa no calendário para este lead.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !proximaData && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {proximaData ? format(proximaData, "PPP", { locale: ptBR }) : "Data do retorno"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={proximaData}
                    onSelect={onProximaDataChange}
                    locale={ptBR}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={proximaTime}
                onChange={(e) => onProximaTimeChange(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {status === "nao" && (
        <div className="space-y-2">
          <Label className="text-xs">Comentários (opcional)</Label>
          <Textarea
            value={comentario}
            onChange={(e) => onComentarioChange(e.target.value)}
            rows={4}
            placeholder="Motivo ou observações sobre a tentativa..."
            className="text-sm min-h-[96px]"
          />
        </div>
      )}
    </div>
  );
}
