import { FileSignature } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioContratoDetalhePage() {
  return (
    <CrediarioComingSoon
      icon={FileSignature}
      title="Detalhe do Contrato"
      description="Visualização do contrato, status de assinatura e emissão/gestão dos boletos (Cora) da venda."
      sourceFile="Contrato.tsx"
    />
  );
}
