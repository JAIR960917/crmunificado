import { ShieldCheck } from "lucide-react";
import CrediarioComingSoon from "@/components/crediario/CrediarioComingSoon";

export default function CrediarioContratosImportadosPage() {
  return (
    <CrediarioComingSoon
      icon={ShieldCheck}
      title="Contratos Assertiva"
      description="Contratos sincronizados do Assertiva (via Google Drive), com status e PDF."
      sourceFile="ContratosImportados.tsx"
    />
  );
}
