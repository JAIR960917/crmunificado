/**
 * ============================================================================
 * Login.tsx — Tela de login (rota /login)
 * ============================================================================
 * - Formulário simples de e-mail + senha.
 * - Usa supabase.auth.signInWithPassword — o redirecionamento acontece
 *   automaticamente porque <PublicRoute> em App.tsx detecta a sessão e
 *   joga o usuário para "/" (vendedor) ou "/dashboard" (admin).
 * - Não há cadastro público: usuários são criados pelo admin em /usuarios.
 * ============================================================================
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import joonkerLogo from "@/assets/joonker-logo.png";

export default function Login() {
  const { settings } = useSystemSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * Submete o formulário de login.
   * @param e Evento do form (usado para preventDefault)
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error("Credenciais inválidas");
        setLoading(false);
      }
      // Em caso de sucesso, NÃO desligamos o loading — mantemos o spinner
      // até o redirect automático do <PublicRoute> acontecer.
    } catch {
      toast.error("Erro de conexão");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-4">
      <Card className="w-full max-w-sm shadow-xl border-0 bg-neutral-900 text-white">
        <CardHeader className="text-center pb-2">
          {/* Logo Joonker */}
          <img src={joonkerLogo} alt="Joonker" className="mx-auto mb-3 h-20 object-contain" />
          <CardTitle className="text-2xl font-bold text-white">{settings.system_name || "CRM"}</CardTitle>
          <p className="text-sm text-neutral-300">Faça login para acessar o sistema</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Campo: e-mail */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500"
              />
            </div>

            {/* Campo: senha */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500"
              />
            </div>

            {/* Botão de envio (desabilita enquanto carrega) */}
            <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
