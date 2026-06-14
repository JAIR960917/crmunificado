import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ESTADOS_BR, formatCidadeUf, getMunicipios, parseCidadeUf } from "@/lib/brazilLocations";

type CidadeEstadoInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  compact?: boolean;
};

export default function CidadeEstadoInput({ value, onChange, className, compact }: CidadeEstadoInputProps) {
  const { cidade, uf } = parseCidadeUf(value);
  const [open, setOpen] = useState(false);
  const municipios = useMemo(() => getMunicipios(uf), [uf]);
  const triggerHeight = compact ? "h-9 text-sm" : "";

  const handleUfChange = (newUf: string) => {
    onChange(formatCidadeUf("", newUf));
  };

  const handleCidadeChange = (nome: string) => {
    onChange(formatCidadeUf(nome, uf));
    setOpen(false);
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Select value={uf} onValueChange={handleUfChange}>
        <SelectTrigger className={cn("w-[110px] shrink-0", triggerHeight)}>
          <SelectValue placeholder="UF" />
        </SelectTrigger>
        <SelectContent>
          {ESTADOS_BR.map((e) => (
            <SelectItem key={e.sigla} value={e.sigla}>{e.sigla}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={!uf}
            className={cn(
              "flex-1 min-w-0 justify-between font-normal",
              triggerHeight,
              !cidade && "text-muted-foreground",
            )}
          >
            <span className="truncate">{cidade || (uf ? "Selecione a cidade" : "Selecione o estado")}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar cidade..." />
            <CommandList>
              <CommandEmpty>Nenhuma cidade encontrada.</CommandEmpty>
              <CommandGroup>
                {municipios.map((nome) => (
                  <CommandItem key={nome} value={nome} onSelect={() => handleCidadeChange(nome)}>
                    <Check className={cn("mr-2 h-4 w-4", cidade === nome ? "opacity-100" : "opacity-0")} />
                    {nome}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
