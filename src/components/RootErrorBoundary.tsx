import { Component, type ErrorInfo, type ReactNode } from "react";
import { isRecoverableBootError, shouldHardRecover, tryAutoRecoverOnce } from "@/lib/appRecover";
import { clearPwaState } from "@/lib/clearPwaState";

const NETWORK_ERROR_PATTERN = /ChunkLoadError|dynamically imported module|Loading chunk|Failed to fetch/i;

type Props = { children: ReactNode };
type State = { error: Error | null; recovering: boolean };

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[CRM] Erro fatal na interface:", error, info);
    if (shouldHardRecover(error.message)) {
      void tryAutoRecoverOnce();
    }
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
    const isDomRace = isRecoverableBootError(msg);
    const isOffline = !navigator.onLine;
    const isOfflineChunkError = NETWORK_ERROR_PATTERN.test(msg) && isOffline;
    // Offline, limpar cache nunca ajuda (não há rede pra recarregar /login do
    // zero) e destrói o shell que permite o app abrir sem internet — então
    // "Tentar novamente" deve sempre ser um retry leve, nunca o hardRecover.
    const allowHardRecoverButton = isDomRace && !isOffline;

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
          {isOfflineChunkError
            ? "Você está sem conexão. Esta tela ainda não foi aberta neste aparelho — conecte-se à internet para carregá-la pela primeira vez."
            : isConfig
              ? "A configuração do servidor não foi carregada. Peça ao administrador para rodar o deploy novamente."
              : "Ocorreu um erro ao iniciar o sistema no seu aparelho."}
        </p>
        {isDomRace && !isOfflineChunkError && !isOffline && (
          <p style={{ fontSize: "0.85rem", opacity: 0.75, marginBottom: "12px", lineHeight: 1.5 }}>
            Isso costuma acontecer no primeiro acesso ou com cache antigo do app. Use o botão abaixo para limpar e tentar de novo.
          </p>
        )}
        {isDomRace && isOffline && !isOfflineChunkError && (
          <p style={{ fontSize: "0.85rem", opacity: 0.75, marginBottom: "12px", lineHeight: 1.5 }}>
            Você está sem conexão — tentar novamente apenas continua o app sem apagar nada. Limpar o cache só
            funciona com internet (precisa recarregar o app do zero).
          </p>
        )}
        <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "20px", wordBreak: "break-word" }}>{msg}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "320px" }}>
          {isOfflineChunkError ? (
            <button
              type="button"
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
          ) : (
            <>
              {allowHardRecoverButton && (
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
              )}
              <button
                type="button"
                disabled={this.state.recovering}
                onClick={() => (allowHardRecoverButton ? void this.hardRecover() : this.setState({ error: null }))}
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
            </>
          )}
        </div>
        <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "20px", lineHeight: 1.5 }}>
          iPhone: abra no Safari (não pelo WhatsApp), ou remova o app da tela inicial e acesse pelo navegador.
          Android: abra no Chrome e use Instalar app em vez de atalho pelo WhatsApp.
        </p>
      </div>
    );
  }
}
