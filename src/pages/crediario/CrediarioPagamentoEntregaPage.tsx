import { Receipt } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioPagamentoEntregaPage() {
  return (
    <CrediarioComingSoon
      icon={Receipt}
      title="Pagamento na Entrega"
      description="Registro de venda com pagamento total na entrega e geração de promissória, sem boleto."
      sourceFile="PagamentoEntrega.tsx"
    />
  );
}
