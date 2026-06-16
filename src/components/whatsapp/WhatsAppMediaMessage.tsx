import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ZoomIn } from "lucide-react";
import WhatsAppImageLightbox from "@/components/whatsapp/WhatsAppImageLightbox";

type MediaMessage = {
  id: string;
  body: string | null;
  message_type?: string | null;
  media_type?: string | null;
  media_id?: string | null;
  media_filename?: string | null;
  caption?: string | null;
};

async function parseInvokeError(data: unknown, error: { message?: string } | null): Promise<string> {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return fromData;
  return error?.message || "Erro ao carregar mídia";
}

export default function WhatsAppMediaMessage({ message }: { message: MediaMessage }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const isMedia =
    (message.message_type || "").toLowerCase() === "media" ||
    !!message.media_id ||
    !!message.media_type;

  const mediaType =
    message.media_type ||
    (message.body === "[audio]" || message.body?.includes("🎤") ? "audio" : null) ||
    (message.body?.includes("📷") ? "image" : null) ||
    "document";

  useEffect(() => {
    if (!isMedia || !message.media_id) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("whatsapp-chat", {
          body: { action: "get-media", message_id: message.id },
        });
        if (fnErr) throw new Error(await parseInvokeError(data, fnErr));
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);

        const base64 = (data as { base64?: string })?.base64;
        const mime = (data as { mime_type?: string })?.mime_type || "application/octet-stream";
        if (!base64) throw new Error("Resposta sem conteúdo");

        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        if (!cancelled) setSrc(objectUrl);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar mídia");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isMedia, message.id, message.media_id]);

  if (!isMedia) {
    const body = message.body || "—";
    if (body === "[unsupported]") {
      return (
        <p className="text-xs italic text-muted-foreground">
          📵 Mensagem não suportada (enquete, evento ou outro tipo)
        </p>
      );
    }
    if (body.startsWith("[") && body.endsWith("]") && body !== "[audio]") {
      return (
        <p className="text-xs italic text-muted-foreground">
          Tipo de mensagem desconhecido: {body}
        </p>
      );
    }
    return <p className="whitespace-pre-wrap leading-relaxed">{body}</p>;
  }

  if (!message.media_id) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {mediaType === "audio" ? "🎤 Áudio" : mediaType === "image" ? "📷 Imagem" : "📎 Anexo"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Mídia recebida antes da atualização do sistema (sem ID). Peça para reenviar ou aguarde novas mensagens.
        </p>
        {message.body && message.body !== "[audio]" ? (
          <p className="whitespace-pre-wrap text-sm">{message.body}</p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando mídia…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">Não foi possível carregar a mídia</p>
        <p className="text-[11px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if ((mediaType === "image" || mediaType === "sticker") && src) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group relative block max-w-full rounded-md overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Clique para ampliar"
        >
          <img
            src={src}
            alt={message.media_filename || "imagem"}
            className="max-h-64 max-w-full rounded-md object-contain bg-black/5 group-hover:opacity-90 transition-opacity"
          />
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <ZoomIn className="h-3 w-3" />
            Ampliar
          </span>
        </button>
        {message.caption ? <p className="whitespace-pre-wrap text-sm">{message.caption}</p> : null}
        <WhatsAppImageLightbox
          src={src}
          alt={message.media_filename || "imagem"}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      </div>
    );
  }

  if (mediaType === "audio" && src) {
    return (
      <div className="space-y-1 min-w-[220px]">
        <audio controls src={src} className="w-full" />
      </div>
    );
  }

  if (mediaType === "video" && src) {
    return (
      <div className="space-y-1">
        <video controls src={src} className="max-h-64 rounded-md w-full" />
        {message.caption ? <p className="whitespace-pre-wrap text-sm">{message.caption}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">📄 {message.media_filename || "Documento"}</p>
      {src ? (
        <a href={src} download={message.media_filename || "arquivo"} className="text-xs text-primary underline">
          Baixar arquivo
        </a>
      ) : null}
      {message.caption ? <p className="whitespace-pre-wrap text-sm">{message.caption}</p> : null}
    </div>
  );
}
