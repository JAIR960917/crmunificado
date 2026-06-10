import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearPwaState } from "@/lib/clearPwaState";

type Props = { children: ReactNode };
type State = { error: Error | null; recovering: boolean };

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CRM] Erro fatal na interface:", error, info);
  }

  private async hardRecover() {
    this.setState({ recovering: true });
    try {
      await clearPwaState();
    } catch {
      // no-op
    }
    const base = `${window.location.origin}/login`;
    window.location.replace(`${base}?recover=${Date.now()}`);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || "Erro desconhecido";
    const isConfig = /backend ausente|runtime-config|VITE_SUPABASE/i.test(msg);
    const isDomRace = /removeChild|insertBefore|not a child/i.test(msg);

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: "24px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", marginBottom: "12px" }}>Não foi possível abrir o CRM</h1>
        <p style={{ opacity: 0.85, marginBottom: "16px", lineHeight: 1.5 }}>
          {isConfig
            ? "A configuração do servidor não foi carregada. Peça ao administrador para rodar o deploy novamente."
            : "Ocorreu um erro ao iniciar o sistema no seu aparelho."}
        </p>
        {isDomRace && (
          <p style={{ fontSize: "0.85rem", opacity: 0.75, marginBottom: "12px", lineHeight: 1.5 }}>
            Isso costuma acontecer no primeiro acesso ou com cache antigo do app. Use o botão abaixo para limpar e tentar de novo.
          </p>
        )}
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "20px", wordBreak: "break-word" }}>{msg}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "320px" }}>
          <button
            type="button"
            disabled={this.state.recovering}
            onClick={() => void this.hardRecover()}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              border: "none",
              background: "#dc2626",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {this.state.recovering ? "Limpando cache..." : "Limpar cache e abrir de novo"}
          </button>
          <button
            type="button"
            disabled={this.state.recovering}
            onClick={() => this.setState({ error: null })}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid #475569",
              background: "transparent",
              color: "#f8fafc",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
        <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "20px", lineHeight: 1.5 }}>
          iPhone: abra no Safari (não pelo WhatsApp), ou remova o app da tela inicial e acesse pelo navegador.
          Android: abra no Chrome e use Instalar app em vez de atalho pelo WhatsApp.
        </p>
      </div>
    );
  }
}
