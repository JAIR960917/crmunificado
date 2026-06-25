import { FileSignature } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioContratosPage() {
  return (
    <CrediarioComingSoon
      icon={FileSignature}
      title="Contratos"
      description="Lista de contratos gerados (assinado, aguardando assinatura, pendente), com download de PDF e assinatura via Zapsign."
      sourceFile="Contratos.tsx"
    />
  );
}
