export const CAMPANHA_COPA_PERIODO_INICIO_KEY = "campanha_copa_periodo_inicio";
export const CAMPANHA_COPA_PERIODO_FIM_KEY = "campanha_copa_periodo_fim";

export type CampanhaCopaPeriodoConfig = {
  inicio: string | null;
  fim: string | null;
};

export type CampanhaCopaPeriodoStatus = {
  aberto: boolean;
  mensagem: string;
  inicio: string | null;
  fim: string | null;
};

export function parsePeriodDate(value: string | null | undefined): Date | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function evaluateCampanhaCopaPeriodo(
  inicioRaw: string | null | undefined,
  fimRaw: string | null | undefined,
  now = new Date(),
): CampanhaCopaPeriodoStatus {
  const inicio = parsePeriodDate(inicioRaw);
  const fim = parsePeriodDate(fimRaw);

  if (!inicio && !fim) {
    return {
      aberto: true,
      mensagem: "",
      inicio: inicioRaw?.trim() || null,
      fim: fimRaw?.trim() || null,
    };
  }

  const fmt = (d: Date) =>
    d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (inicio && now < inicio) {
    return {
      aberto: false,
      mensagem: `O período para envio de palpites ainda não começou. Início em ${fmt(inicio)}.`,
      inicio: inicio.toISOString(),
      fim: fim?.toISOString() || null,
    };
  }

  if (fim && now > fim) {
    return {
      aberto: false,
      mensagem: "O período para envio de palpites foi encerrado.",
      inicio: inicio?.toISOString() || null,
      fim: fim.toISOString(),
    };
  }

  return {
    aberto: true,
    mensagem: "",
    inicio: inicio?.toISOString() || null,
    fim: fim?.toISOString() || null,
  };
}

export async function loadCampanhaCopaPeriodoConfig(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
): Promise<CampanhaCopaPeriodoConfig> {
  const { data } = await supabase
    .from("system_settings")
    .select("setting_key, setting_value")
    .in("setting_key", [CAMPANHA_COPA_PERIODO_INICIO_KEY, CAMPANHA_COPA_PERIODO_FIM_KEY]);

  const map = new Map((data || []).map((r: { setting_key: string; setting_value: string }) => [
    r.setting_key,
    r.setting_value || "",
  ]));

  const inicio = map.get(CAMPANHA_COPA_PERIODO_INICIO_KEY)?.trim() || null;
  const fim = map.get(CAMPANHA_COPA_PERIODO_FIM_KEY)?.trim() || null;

  return { inicio, fim };
}
