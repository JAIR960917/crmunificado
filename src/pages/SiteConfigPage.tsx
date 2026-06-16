import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings, Save } from "lucide-react";

type Cfg = Record<string, string>;
type Service = { icon: string; title: string; text: string };
type Testimonial = { quote: string; author: string; location: string };

const TABS = [
  { key: "identidade", label: "Identidade" },
  { key: "hero",       label: "Hero" },
  { key: "numeros",    label: "Números" },
  { key: "sobre",      label: "Sobre" },
  { key: "servicos",   label: "Serviços" },
  { key: "depoimentos",label: "Depoimentos" },
  { key: "franquia",   label: "Franquia" },
  { key: "rodape",     label: "Rodapé" },
];

function Field({ label, k, cfg, set, multi = false, type = "text", placeholder = "" }: {
  label: string; k: string; cfg: Cfg; set: (k: string, v: string) => void;
  multi?: boolean; type?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {multi ? (
        <textarea
          className="w-full min-h-[80px] rounded-md border border-input px-3 py-2 text-sm bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          value={cfg[k] ?? ""} placeholder={placeholder}
          onChange={e => set(k, e.target.value)}
        />
      ) : (
        <Input type={type} placeholder={placeholder}
          value={cfg[k] ?? ""} onChange={e => set(k, e.target.value)} />
      )}
    </div>
  );
}

export default function SiteConfigPage() {
  const db = supabase as any;
  const [tab, setTab] = useState("identidade");
  const [cfg, setCfg] = useState<Cfg>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // JSON arrays
  const [services, setServices] = useState<Service[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);

  const set = (k: string, v: string) => setCfg(p => ({ ...p, [k]: v }));

  useEffect(() => {
    (async () => {
      const { data } = await db.from("site_web_config").select("key, value");
      const map: Cfg = {};
      for (const r of (data || [])) map[r.key] = r.value;
      setCfg(map);
      try { setServices(JSON.parse(map["services_items"] || "[]")); } catch { setServices([]); }
      try { setTestimonials(JSON.parse(map["testimonials_items"] || "[]")); } catch { setTestimonials([]); }
      setLoading(false);
    })();
  }, []);

  const saveSection = async (keys: string[], extra?: Cfg) => {
    setSaving(true);
    const merged = { ...cfg, ...extra };
    const upserts = keys.map(k => ({ key: k, value: merged[k] ?? "", updated_at: new Date().toISOString() }));
    const { error } = await db.from("site_web_config").upsert(upserts, { onConflict: "key" });
    if (error) { toast.error("Erro ao salvar"); setSaving(false); return; }
    toast.success("Salvo com sucesso");
    setSaving(false);
  };

  const saveServices = () => {
    const val = JSON.stringify(services);
    setCfg(p => ({ ...p, services_items: val }));
    saveSection(["services_badge", "services_title", "services_subtitle", "services_items"],
      { services_items: val });
  };

  const saveTestimonials = () => {
    const val = JSON.stringify(testimonials);
    setCfg(p => ({ ...p, testimonials_items: val }));
    saveSection(["testimonials_badge", "testimonials_title", "testimonials_items"],
      { testimonials_items: val });
  };

  const setSvc = (i: number, f: keyof Service, v: string) =>
    setServices(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));

  const setTst = (i: number, f: keyof Testimonial, v: string) =>
    setTestimonials(prev => prev.map((t, idx) => idx === i ? { ...t, [f]: v } : t));

  if (loading) return <AppLayout><p className="p-6 text-sm text-muted-foreground">Carregando...</p></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <div>
            <h1 className="text-2xl font-bold">Configurações do Site</h1>
            <p className="text-sm text-muted-foreground">Edite todos os textos e aparência do site institucional.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap border-b">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── IDENTIDADE ── */}
        {tab === "identidade" && (
          <Card><CardHeader><CardTitle className="text-base">Identidade da Marca</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Nome da empresa" k="company_name" cfg={cfg} set={set} />
              <Field label="WhatsApp (com DDI, ex: 5511999999999)" k="whatsapp" cfg={cfg} set={set} placeholder="5511999999999" />
              <div className="space-y-1.5">
                <Label>Cor principal (vermelho da marca)</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={cfg["color_primary"] || "#c8102e"}
                    onChange={e => set("color_primary", e.target.value)}
                    className="h-10 w-16 rounded border cursor-pointer" />
                  <Input value={cfg["color_primary"] || "#c8102e"}
                    onChange={e => set("color_primary", e.target.value)}
                    className="w-36 font-mono" placeholder="#c8102e" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Cor escura (fundo hero / navbar)</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={cfg["color_dark"] || "#0d0d0d"}
                    onChange={e => set("color_dark", e.target.value)}
                    className="h-10 w-16 rounded border cursor-pointer" />
                  <Input value={cfg["color_dark"] || "#0d0d0d"}
                    onChange={e => set("color_dark", e.target.value)}
                    className="w-36 font-mono" placeholder="#0d0d0d" />
                </div>
              </div>
              <Field label="URL da logo (deixe vazio para usar a inicial)" k="logo_url" cfg={cfg} set={set} placeholder="https://..." />
              {cfg["logo_url"] && (
                <img src={cfg["logo_url"]} alt="Logo preview" className="h-16 object-contain rounded border p-1" />
              )}
              <Button onClick={() => saveSection(["company_name","whatsapp","color_primary","color_dark","logo_url"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar identidade"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── HERO ── */}
        {tab === "hero" && (
          <Card><CardHeader><CardTitle className="text-base">Seção Hero (topo)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Badge (ex: NO MERCADO DESDE 2018)" k="hero_badge" cfg={cfg} set={set} />
              <Field label="Título linha 1" k="hero_title_1" cfg={cfg} set={set} />
              <Field label="Palavra em destaque (cor da marca)" k="hero_title_highlight" cfg={cfg} set={set} />
              <Field label="Título linha 2" k="hero_title_2" cfg={cfg} set={set} />
              <Field label="Subtítulo" k="hero_subtitle" cfg={cfg} set={set} multi />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Botão primário" k="hero_btn_primary" cfg={cfg} set={set} />
                <Field label="Botão secundário" k="hero_btn_secondary" cfg={cfg} set={set} />
              </div>
              <Field label="Card — Título" k="hero_card_title" cfg={cfg} set={set} />
              <Field label="Card — Subtítulo" k="hero_card_subtitle" cfg={cfg} set={set} />
              <div className="space-y-1.5">
                <Label>Card — Itens (um por linha)</Label>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-input px-3 py-2 text-sm bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={(() => { try { return (JSON.parse(cfg["hero_card_items"] || "[]") as string[]).join("\n"); } catch { return ""; } })()}
                  onChange={e => set("hero_card_items", JSON.stringify(e.target.value.split("\n").filter(Boolean)))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label='Destaque "Nº1" — Label' k="hero_badge_label" cfg={cfg} set={set} />
                <Field label='Destaque "Nº1" — Sub' k="hero_badge_sub" cfg={cfg} set={set} />
              </div>
              <Button onClick={() => saveSection(["hero_badge","hero_title_1","hero_title_highlight","hero_title_2","hero_subtitle","hero_btn_primary","hero_btn_secondary","hero_card_title","hero_card_subtitle","hero_card_items","hero_badge_label","hero_badge_sub"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar hero"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── NÚMEROS ── */}
        {tab === "numeros" && (
          <Card><CardHeader><CardTitle className="text-base">Barra de números</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[1,2,3,4].map(n => (
                <div key={n} className="grid grid-cols-2 gap-4">
                  <Field label={`Número ${n} — Valor`} k={`stat_${n}_value`} cfg={cfg} set={set} placeholder="10+" />
                  <Field label={`Número ${n} — Legenda`} k={`stat_${n}_label`} cfg={cfg} set={set} placeholder="LOJAS" />
                </div>
              ))}
              <Button onClick={() => saveSection(["stat_1_value","stat_1_label","stat_2_value","stat_2_label","stat_3_value","stat_3_label","stat_4_value","stat_4_label"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar números"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── SOBRE ── */}
        {tab === "sobre" && (
          <Card><CardHeader><CardTitle className="text-base">Seção Sobre</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Badge" k="about_badge" cfg={cfg} set={set} />
              <Field label="Título" k="about_title" cfg={cfg} set={set} />
              <Field label="Texto principal" k="about_text" cfg={cfg} set={set} multi />
              <Field label="Legenda da imagem" k="about_image_caption" cfg={cfg} set={set} />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pt-2">Diferenciais</p>
              {[1,2,3].map(n => (
                <div key={n} className="space-y-2 border rounded-md p-3">
                  <Field label={`Diferencial ${n} — Título`} k={`about_f${n}_title`} cfg={cfg} set={set} />
                  <Field label={`Diferencial ${n} — Texto`} k={`about_f${n}_text`} cfg={cfg} set={set} multi />
                </div>
              ))}
              <Button onClick={() => saveSection(["about_badge","about_title","about_text","about_image_caption","about_f1_title","about_f1_text","about_f2_title","about_f2_text","about_f3_title","about_f3_text"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar sobre"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── SERVIÇOS ── */}
        {tab === "servicos" && (
          <Card><CardHeader><CardTitle className="text-base">Seção Serviços</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Badge" k="services_badge" cfg={cfg} set={set} />
              <Field label="Título" k="services_title" cfg={cfg} set={set} />
              <Field label="Subtítulo" k="services_subtitle" cfg={cfg} set={set} multi />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pt-2">Itens de serviço</p>
              {services.map((s, i) => (
                <div key={i} className="border rounded-md p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Serviço {i + 1}</p>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1.5">
                      <Label>Ícone (emoji)</Label>
                      <Input value={s.icon} onChange={e => setSvc(i, "icon", e.target.value)} placeholder="👁️" />
                    </div>
                    <div className="col-span-3 space-y-1.5">
                      <Label>Título</Label>
                      <Input value={s.title} onChange={e => setSvc(i, "title", e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrição</Label>
                    <textarea className="w-full min-h-[60px] rounded-md border border-input px-3 py-2 text-sm bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                      value={s.text} onChange={e => setSvc(i, "text", e.target.value)} />
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setServices(p => [...p, { icon: "⭐", title: "Novo serviço", text: "" }])}>
                  + Adicionar serviço
                </Button>
                {services.length > 1 && (
                  <Button variant="outline" onClick={() => setServices(p => p.slice(0, -1))}>
                    − Remover último
                  </Button>
                )}
              </div>
              <Button onClick={saveServices} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar serviços"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── DEPOIMENTOS ── */}
        {tab === "depoimentos" && (
          <Card><CardHeader><CardTitle className="text-base">Seção Depoimentos</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Badge" k="testimonials_badge" cfg={cfg} set={set} />
              <Field label="Título" k="testimonials_title" cfg={cfg} set={set} />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pt-2">Depoimentos</p>
              {testimonials.map((t, i) => (
                <div key={i} className="border rounded-md p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Depoimento {i + 1}</p>
                  <div className="space-y-1.5">
                    <Label>Texto do depoimento</Label>
                    <textarea className="w-full min-h-[80px] rounded-md border border-input px-3 py-2 text-sm bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                      value={t.quote} onChange={e => setTst(i, "quote", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Nome</Label>
                      <Input value={t.author} onChange={e => setTst(i, "author", e.target.value)} placeholder="Ana Carolina S." />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cidade</Label>
                      <Input value={t.location} onChange={e => setTst(i, "location", e.target.value)} placeholder="São Paulo, SP" />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setTestimonials(p => [...p, { quote: "", author: "", location: "" }])}>
                  + Adicionar depoimento
                </Button>
                {testimonials.length > 1 && (
                  <Button variant="outline" onClick={() => setTestimonials(p => p.slice(0, -1))}>
                    − Remover último
                  </Button>
                )}
              </div>
              <Button onClick={saveTestimonials} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar depoimentos"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── FRANQUIA ── */}
        {tab === "franquia" && (
          <Card><CardHeader><CardTitle className="text-base">Seção Franquia (CTA)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Badge" k="franchise_badge" cfg={cfg} set={set} />
              <Field label="Título" k="franchise_title" cfg={cfg} set={set} />
              <Field label="Subtítulo" k="franchise_subtitle" cfg={cfg} set={set} multi />
              <div className="space-y-1.5">
                <Label>Diferenciais (um por linha)</Label>
                <textarea
                  className="w-full min-h-[120px] rounded-md border border-input px-3 py-2 text-sm bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  value={(() => { try { return (JSON.parse(cfg["franchise_features"] || "[]") as string[]).join("\n"); } catch { return ""; } })()}
                  onChange={e => set("franchise_features", JSON.stringify(e.target.value.split("\n").filter(Boolean)))}
                />
              </div>
              <Field label="Texto do botão" k="franchise_btn" cfg={cfg} set={set} />
              <Button onClick={() => saveSection(["franchise_badge","franchise_title","franchise_subtitle","franchise_features","franchise_btn"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar franquia"}
              </Button>
            </CardContent></Card>
        )}

        {/* ── RODAPÉ ── */}
        {tab === "rodape" && (
          <Card><CardHeader><CardTitle className="text-base">Rodapé</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Texto sobre a empresa" k="footer_about" cfg={cfg} set={set} multi />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Telefone" k="footer_phone" cfg={cfg} set={set} placeholder="(11) 9999-9999" />
                <Field label="E-mail" k="footer_email" cfg={cfg} set={set} placeholder="contato@joonker.com.br" />
              </div>
              <Field label="Endereço" k="footer_address" cfg={cfg} set={set} placeholder="São Paulo, SP" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Instagram (URL)" k="footer_instagram" cfg={cfg} set={set} placeholder="https://instagram.com/..." />
                <Field label="Facebook (URL)" k="footer_facebook" cfg={cfg} set={set} placeholder="https://facebook.com/..." />
              </div>
              <Button onClick={() => saveSection(["footer_about","footer_phone","footer_email","footer_address","footer_instagram","footer_facebook"])} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar rodapé"}
              </Button>
            </CardContent></Card>
        )}
      </div>
    </AppLayout>
  );
}
