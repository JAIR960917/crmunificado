// Gera src/data/municipiosBrasil.json com a lista de municípios por UF,
// usada pelo seletor offline de Cidade/Estado (PWA sem internet).
// Execução única (dados raramente mudam): node scripts/fetch-municipios-brasil.mjs

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const result = {};

for (const uf of UFS) {
  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao buscar ${uf}: ${res.status}`);
  const data = await res.json();
  result[uf] = data.map((m) => m.nome);
  console.log(`${uf}: ${result[uf].length} municípios`);
}

const outPath = join(__dirname, "..", "src", "data", "municipiosBrasil.json");
writeFileSync(outPath, JSON.stringify(result), "utf-8");
console.log(`Salvo em ${outPath}`);
