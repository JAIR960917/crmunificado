import { RefreshCw } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioRenegociacaoPage() {
  return (
    <CrediarioComingSoon
      icon={RefreshCw}
      title="Renegociação"
      description="Renegociação de contratos existentes: ajuste de entrada, parcelas e nova consulta de score."
      sourceFile="Renegociacao.tsx"
    />
  );
}
