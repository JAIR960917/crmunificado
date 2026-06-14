import municipiosPorUf from "@/data/municipiosBrasil.json";

export type EstadoBR = { sigla: string; nome: string };

export const ESTADOS_BR: EstadoBR[] = [
  { sigla: "AC", nome: "Acre" },
  { sigla: "AL", nome: "Alagoas" },
  { sigla: "AP", nome: "Amapá" },
  { sigla: "AM", nome: "Amazonas" },
  { sigla: "BA", nome: "Bahia" },
  { sigla: "CE", nome: "Ceará" },
  { sigla: "DF", nome: "Distrito Federal" },
  { sigla: "ES", nome: "Espírito Santo" },
  { sigla: "GO", nome: "Goiás" },
  { sigla: "MA", nome: "Maranhão" },
  { sigla: "MT", nome: "Mato Grosso" },
  { sigla: "MS", nome: "Mato Grosso do Sul" },
  { sigla: "MG", nome: "Minas Gerais" },
  { sigla: "PA", nome: "Pará" },
  { sigla: "PB", nome: "Paraíba" },
  { sigla: "PR", nome: "Paraná" },
  { sigla: "PE", nome: "Pernambuco" },
  { sigla: "PI", nome: "Piauí" },
  { sigla: "RJ", nome: "Rio de Janeiro" },
  { sigla: "RN", nome: "Rio Grande do Norte" },
  { sigla: "RS", nome: "Rio Grande do Sul" },
  { sigla: "RO", nome: "Rondônia" },
  { sigla: "RR", nome: "Roraima" },
  { sigla: "SC", nome: "Santa Catarina" },
  { sigla: "SP", nome: "São Paulo" },
  { sigla: "SE", nome: "Sergipe" },
  { sigla: "TO", nome: "Tocantins" },
];

const MUNICIPIOS_POR_UF = municipiosPorUf as Record<string, string[]>;

export function getMunicipios(uf: string): string[] {
  return MUNICIPIOS_POR_UF[uf] || [];
}

/** Monta o valor armazenado no formato "Cidade/UF". */
export function formatCidadeUf(cidade: string, uf: string): string {
  if (!cidade && !uf) return "";
  if (!uf) return cidade;
  return `${cidade}/${uf}`;
}

/** Extrai { cidade, uf } a partir do valor armazenado "Cidade/UF". */
export function parseCidadeUf(value: string): { cidade: string; uf: string } {
  const trimmed = (value || "").trim();
  if (!trimmed) return { cidade: "", uf: "" };
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return { cidade: trimmed, uf: "" };
  const uf = trimmed.slice(idx + 1).trim().toUpperCase();
  const cidade = trimmed.slice(0, idx).trim();
  if (uf.length === 2 && ESTADOS_BR.some((e) => e.sigla === uf)) {
    return { cidade, uf };
  }
  return { cidade: trimmed, uf: "" };
}
