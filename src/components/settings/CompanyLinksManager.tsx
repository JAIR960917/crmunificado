/**
 * Gerencia os links da página pública "/links" (estilo Linktree): Instagram,
 * WhatsApp oficial, site, Campanha Copa, etc. Exibidos publicamente via a
 * edge function get-company-links (service role) — esta tabela só é lida
 * aqui pelo admin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, ExternalLink, Heading, ImagePlus, Type, AlignLeft, Upload, Bold } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveStoragePublicUrl } from "@/lib/storage-url";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type LinkType = "link" | "header" | "banner" | "title" | "paragraph";

type CompanyLink = {
  id: string;
  label: string;
  url: string;
  link_type: LinkType;
  position: number;
  active: boolean;
  bold: boolean;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

export default function CompanyLinksManager() {
  const [links, setLinks] = useState<CompanyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingBannerId, setUploadingBannerId] = useState<string | null>(null);
  const bannerInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchLinks = useCallback(async () => {
    const { data, error } = await supabase
      .from("company_links")
      .select("id, label, url, link_type, position, active, bold")
      .order("position", { ascending: true });
    if (error) {
      toast.error("Erro ao carregar links");
    } else {
      setLinks((data || []) as CompanyLink[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchLinks();
  }, [fetchLinks]);

  const patchLocal = (id: string, patch: Partial<CompanyLink>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const persist = async (id: string, patch: Partial<CompanyLink>) => {
    setSavingId(id);
    const { error } = await supabase.from("company_links").update(patch).eq("id", id);
    if (error) toast.error("Erro ao salvar");
    setSavingId(null);
  };

  const handleAdd = async (type: LinkType) => {
    const nextPosition = links.length > 0 ? Math.max(...links.map((l) => l.position)) + 1 : 0;
    const defaults: Record<LinkType, { label: string; url: string }> = {
      link: { label: "Novo link", url: "https://" },
      header: { label: "Nova categoria", url: "" },
      banner: { label: "", url: "" },
      title: { label: "Novo título", url: "" },
      paragraph: { label: "Novo parágrafo de texto.", url: "" },
    };
    const { data, error } = await supabase
      .from("company_links")
      .insert({ ...defaults[type], link_type: type, position: nextPosition, active: true, bold: false })
      .select("id, label, url, link_type, position, active, bold")
      .single();
    if (error || !data) {
      toast.error("Erro ao criar item");
      return;
    }
    setLinks((prev) => [...prev, data as CompanyLink]);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("company_links").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    setLinks((prev) => prev.filter((l) => l.id !== id));
    toast.success("Excluído");
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const reordered = [...links];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const withPositions = reordered.map((l, idx) => ({ ...l, position: idx }));
    setLinks(withPositions);
    await Promise.all(
      withPositions.map((l) => supabase.from("company_links").update({ position: l.position }).eq("id", l.id)),
    );
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>, linkId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 5 MB)");
      e.target.value = "";
      return;
    }
    setUploadingBannerId(linkId);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fileName = `banner_${Date.now()}.${ext}`;
      const data = await fileToBase64(file);
      const contentType = file.type || "image/png";
      const { data: result, error } = await supabase.functions.invoke("upload-system-logo", {
        body: { fileName, contentType, data, returnUrlOnly: true },
      });
      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);
      const publicUrl = resolveStoragePublicUrl(result.publicUrl as string);
      patchLocal(linkId, { url: publicUrl });
      await persist(linkId, { url: publicUrl });
      toast.success("Banner enviado!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar imagem");
    } finally {
      setUploadingBannerId(null);
      e.target.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links públicos (página /links)</CardTitle>
        <CardDescription>
          Gerencie os links exibidos em{" "}
          <a href="/links" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
            /links <ExternalLink className="h-3 w-3" />
          </a>
          . Arraste para reordenar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="company-links">
              {(provided) => (
                <div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
                  {links.map((link, index) => (
                    <Draggable key={link.id} draggableId={link.id} index={index}>
                      {(dragProvided) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className="flex flex-col sm:flex-row sm:items-start gap-2 rounded-md border p-3"
                        >
                          {/* Drag handle */}
                          <div
                            {...dragProvided.dragHandleProps}
                            className="flex items-center justify-center h-9 w-9 shrink-0 cursor-grab text-muted-foreground mt-0"
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>

                          {/* Type selector */}
                          <Select
                            value={link.link_type}
                            onValueChange={(v) => {
                              patchLocal(link.id, { link_type: v as LinkType });
                              void persist(link.id, { link_type: v as LinkType });
                            }}
                          >
                            <SelectTrigger className="h-9 w-full sm:w-[130px] shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="link">Link</SelectItem>
                              <SelectItem value="header">Cabeçalho</SelectItem>
                              <SelectItem value="banner">Banner</SelectItem>
                              <SelectItem value="title">Título</SelectItem>
                              <SelectItem value="paragraph">Parágrafo</SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Content area — varies by type */}
                          <div className="flex-1 min-w-0 flex flex-col gap-2">
                            {/* Banner: upload button + preview */}
                            {link.link_type === "banner" && (
                              <div className="flex items-center gap-3">
                                {link.url && link.url !== "https://" && link.url !== "" && (
                                  <img
                                    src={resolveStoragePublicUrl(link.url)}
                                    alt="banner"
                                    className="h-12 rounded object-cover border shrink-0"
                                  />
                                )}
                                <label className="cursor-pointer">
                                  <Button variant="outline" size="sm" asChild disabled={uploadingBannerId === link.id}>
                                    <span>
                                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                                      {uploadingBannerId === link.id ? "Enviando..." : "Enviar imagem"}
                                    </span>
                                  </Button>
                                  <input
                                    ref={(el) => { bannerInputRefs.current[link.id] = el; }}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => handleBannerUpload(e, link.id)}
                                  />
                                </label>
                                <Input
                                  value={link.url}
                                  placeholder="ou cole a URL da imagem"
                                  className="h-9 flex-1 min-w-0"
                                  onChange={(e) => patchLocal(link.id, { url: e.target.value })}
                                  onBlur={(e) => void persist(link.id, { url: e.target.value })}
                                />
                              </div>
                            )}

                            {/* Title */}
                            {link.link_type === "title" && (
                              <div className="flex flex-col gap-2">
                                <Input
                                  value={link.label}
                                  placeholder="Texto do título"
                                  className="h-9"
                                  onChange={(e) => patchLocal(link.id, { label: e.target.value })}
                                  onBlur={(e) => void persist(link.id, { label: e.target.value })}
                                />
                                <div className="flex items-center gap-2">
                                  <Bold className="h-3.5 w-3.5 text-muted-foreground" />
                                  <Label className="text-xs text-muted-foreground">Negrito</Label>
                                  <Switch
                                    checked={link.bold}
                                    onCheckedChange={(checked) => {
                                      patchLocal(link.id, { bold: checked });
                                      void persist(link.id, { bold: checked });
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Paragraph */}
                            {link.link_type === "paragraph" && (
                              <div className="flex flex-col gap-2">
                                <Textarea
                                  value={link.label}
                                  placeholder="Texto do parágrafo..."
                                  className="min-h-[72px] resize-y"
                                  onChange={(e) => patchLocal(link.id, { label: e.target.value })}
                                  onBlur={(e) => void persist(link.id, { label: e.target.value })}
                                />
                                <div className="flex items-center gap-2">
                                  <Bold className="h-3.5 w-3.5 text-muted-foreground" />
                                  <Label className="text-xs text-muted-foreground">Negrito</Label>
                                  <Switch
                                    checked={link.bold}
                                    onCheckedChange={(checked) => {
                                      patchLocal(link.id, { bold: checked });
                                      void persist(link.id, { bold: checked });
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Header (category) */}
                            {link.link_type === "header" && (
                              <Input
                                value={link.label}
                                placeholder="Título da seção"
                                className="h-9"
                                onChange={(e) => patchLocal(link.id, { label: e.target.value })}
                                onBlur={(e) => void persist(link.id, { label: e.target.value })}
                              />
                            )}

                            {/* Link: label + URL */}
                            {link.link_type === "link" && (
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                  value={link.label}
                                  placeholder="Rótulo (ex.: Instagram)"
                                  className="h-9 sm:w-[200px]"
                                  onChange={(e) => patchLocal(link.id, { label: e.target.value })}
                                  onBlur={(e) => void persist(link.id, { label: e.target.value })}
                                />
                                <Input
                                  value={link.url}
                                  placeholder="https://..."
                                  className="h-9 flex-1 min-w-0"
                                  onChange={(e) => patchLocal(link.id, { url: e.target.value })}
                                  onBlur={(e) => void persist(link.id, { url: e.target.value })}
                                />
                              </div>
                            )}
                          </div>

                          {/* Active + delete */}
                          <div className="flex items-center gap-2 shrink-0">
                            <Label className="text-xs text-muted-foreground">Ativo</Label>
                            <Switch
                              checked={link.active}
                              disabled={savingId === link.id}
                              onCheckedChange={(checked) => {
                                patchLocal(link.id, { active: checked });
                                void persist(link.id, { active: checked });
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive"
                              onClick={() => handleDelete(link.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => handleAdd("link")}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar link
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleAdd("header")}>
            <Heading className="h-4 w-4 mr-1" /> Adicionar categoria
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleAdd("banner")}>
            <ImagePlus className="h-4 w-4 mr-1" /> Adicionar banner
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleAdd("title")}>
            <Type className="h-4 w-4 mr-1" /> Adicionar título
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => handleAdd("paragraph")}>
            <AlignLeft className="h-4 w-4 mr-1" /> Adicionar parágrafo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
