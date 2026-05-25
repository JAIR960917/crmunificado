/**
 * MaintenancePage — exibida para usuários comuns quando o sistema está em
 * modo manutenção. Apenas os 2 admins escolhidos em /configuracoes têm acesso.
 */
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Wrench, LogOut } from "lucide-react";

export default function MaintenancePage() {
  const { settings } = useSystemSettings();
  const { signOut, session } = useAuth();

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6 text-center">
      {settings.logo_url ? (
        <img src={settings.logo_url} alt="Logo" className="h-20 w-20 object-contain mb-6" />
      ) : (
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <Wrench className="h-8 w-8 text-primary" />
        </div>
      )}
      <h1 className="text-2xl sm:text-3xl font-bold mb-3">Sistema em manutenção</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        Estamos realizando uma manutenção no {settings.system_name}. Volte em breve — agradecemos a sua paciência.
      </p>
      {session && (
        <Button variant="outline" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </Button>
      )}
    </div>
  );
}
