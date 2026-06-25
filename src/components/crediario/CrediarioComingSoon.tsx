import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Construction, type LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Nome do arquivo original em consultasjoonker-5c055c82/src/pages, para referência de quem for portar. */
  sourceFile: string;
}

/**
 * Placeholder para telas do Crediário cuja porta completa (integrações Serasa/Cora/
 * Zapsign/Assertiva, geração de PDF/boleto) ainda não foi migrada para o crm-my-way.
 * A rota, permissão e item de menu já existem — falta portar a lógica da tela.
 */
export default function CrediarioComingSoon({ icon: Icon, title, description, sourceFile }: Props) {
  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Icon className="h-7 w-7 text-primary" /> {title}
        </h1>
        <p className="text-muted-foreground">{description}</p>
      </header>
      <Card>
        <CardContent className="p-8 flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Construction className="h-8 w-8" />
          <p className="font-medium">Esta tela ainda não foi portada para o módulo unificado.</p>
          <p className="text-xs">
            Lógica original em <code>consultasjoonker-5c055c82/src/pages/{sourceFile}</code> — depende de
            integrações (Serasa, Cora, Zapsign ou Assertiva) que serão portadas na Fase 4.
          </p>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
