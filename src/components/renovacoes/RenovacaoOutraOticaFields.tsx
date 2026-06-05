import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS } from "@/lib/renovacaoFlow";

type Props = {
  renovou: boolean;
  onRenovouChange: (value: boolean) => void;
  examDate: Date | undefined;
  onExamDateChange: (date: Date | undefined) => void;
};

export default function RenovacaoOutraOticaFields({
  renovou,
  onRenovouChange,
  examDate,
  onExamDateChange,
}: Props) {
  return (
    <div className="space-y-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <Store className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide">Outra ótica</span>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="renovou-outra-otica-form"
          checked={renovou}
          onCheckedChange={(v) => onRenovouChange(v === true)}
        />
        <div className="space-y-1">
          <Label htmlFor="renovou-outra-otica-form" className="cursor-pointer text-sm font-medium leading-snug">
            Cliente renovou consulta de vista em outra ótica
          </Label>
          <p className="text-[11px] text-muted-foreground leading-snug">
            A coluna do card passará a usar a data do exame abaixo. Tarefa automática em{" "}
            {RENOVACAO_OUTRA_OTICA_FOLLOWUP_DAYS} dias.
          </p>
        </div>
      </div>

      {renovou && (
        <div className="space-y-2">
          <Label className="text-xs">Data do último exame na outra ótica</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-9 text-sm",
                  !examDate && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {examDate ? format(examDate, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={examDate}
                onSelect={onExamDateChange}
                locale={ptBR}
                disabled={(d) => d > new Date()}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
