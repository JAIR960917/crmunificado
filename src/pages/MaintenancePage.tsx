/**
 * MaintenancePage — exibida para usuários comuns quando o sistema está em
 * modo manutenção. Apenas os 2 admins escolhidos em /configuracoes têm acesso.
 */
import { useEffect } from "react";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Wrench, LogOut } from "lucide-react";

export default function MaintenancePage() {
  const { settings } = useSystemSettings();
  const { signOut, session } = useAuth();

  // Força modo escuro nesta tela
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  return (
    <div className="dark min-h-[100dvh] flex flex-col items-center justify-center bg-background text-foreground px-6 text-center">
      {settings.logo_url ? (
        <img src={settings.logo_url} alt="Logo" className="h-48 w-48 sm:h-64 sm:w-64 object-contain mb-8" />
      ) : (
        <div className="h-32 w-32 rounded-full bg-primary/10 flex items-center justify-center mb-8">
          <Wrench className="h-16 w-16 text-primary" />
        </div>
      )}
      <h1 className="text-3xl sm:text-4xl font-bold mb-3 text-foreground">{settings.maintenance_title || "Sistema em manutenção"}</h1>
      <p className="text-muted-foreground max-w-md mb-8 whitespace-pre-line">
        {settings.maintenance_message || `Estamos realizando uma manutenção no ${settings.system_name}. Volte em breve — agradecemos a sua paciência.`}
      </p>
      {session && (
        <Button variant="outline" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </Button>
      )}
    </div>
  );
}
