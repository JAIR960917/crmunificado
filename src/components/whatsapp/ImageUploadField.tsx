import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
}

export default function ImageUploadField({ value, onChange, label = "Imagem (opcional)" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem deve ter no máximo 5MB");
      return;
    }

    setUploading(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error("Faça login para enviar imagens");
      }

      const ext = file.name.split(".").pop() || "jpg";
      // RLS do bucket whatsapp-media exige pasta = auth.uid()
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("whatsapp-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success("Imagem enviada");
    } catch (e: any) {
      toast.error("Erro ao enviar imagem: " + (e.message || ""));
    }
    setUploading(false);
  };

  const handleRemove = () => {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {value ? (
        <div className="flex items-start gap-2">
          <img
            src={value}
            alt="Pré-visualização"
            className="h-20 w-20 rounded-md border object-cover"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleRemove}>
            <X className="h-3.5 w-3.5 mr-1" /> Remover
          </Button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5 mr-1" />
            )}
            Anexar imagem
          </Button>
          <p className="text-[10px] text-muted-foreground mt-1">PNG/JPG até 5MB</p>
        </div>
      )}
    </div>
  );
}
