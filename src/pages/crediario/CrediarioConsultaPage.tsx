import { ScanLine } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioConsultaPage() {
  return (
    <CrediarioComingSoon
      icon={ScanLine}
      title="Vender no boleto"
      description="Consulta de score (Serasa), simulação de financiamento e aprovação da venda no boleto."
      sourceFile="Consulta.tsx"
    />
  );
}
