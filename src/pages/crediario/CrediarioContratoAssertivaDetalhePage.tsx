import { ShieldCheck } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioContratoAssertivaDetalhePage() {
  return (
    <CrediarioComingSoon
      icon={ShieldCheck}
      title="Detalhe do Contrato Assertiva"
      description="Detalhes do contrato importado do Assertiva."
      sourceFile="ContratoAssertivaDetalhe.tsx"
    />
  );
}
