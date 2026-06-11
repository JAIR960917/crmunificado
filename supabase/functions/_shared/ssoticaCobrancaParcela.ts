/** Regras compartilhadas para identificar parcelas ativas de cobrança (SSótica). */

export function normalizeSituacaoLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function getAjuizadoVariantFromSituacao(situacao: string): "ajuizado_saniely" | "ajuizado_navde" | null {
  const isJuridico =
    situacao.startsWith("ajuizado") ||
    situacao.startsWith("cobranca dr") ||
    situacao.startsWith("cobranca dra") ||
    situacao.startsWith("escritorio de cobranca") ||
    situacao.startsWith("escritorio cobranca");
  if (!isJuridico) return null;
  if (situacao.includes("saniely")) return "ajuizado_saniely";
  if (situacao.includes("navde")) return "ajuizado_navde";
  return "ajuizado_navde";
}

export type ParsedParcelaCobranca = {
  parcela_id: number | null;
  titulo_id: number | null;
  numero_parcela: number | null;
  vencimento: string;
  dias_atraso: number;
  valor: number;
  situacao: string;
  forma_pagamento: string;
  numero_documento: string;
  descricao: string;
  boleto_nosso_numero: string | null;
  ssotica_raw: unknown;
};

/** Retorna a parcela normalizada se estiver em aberto para cobrança; caso contrário null. */
export function parseParcelaCobrancaAtiva(
  parcela: any,
  today: Date,
  clienteId: number,
): ParsedParcelaCobranca | null {
  const situacaoRaw = String(parcela.situacao ?? parcela["situação"] ?? "");
  const situacao = normalizeSituacaoLabel(situacaoRaw);
  const cliRef = parcela.titulo?.cliente ?? parcela.cliente ?? {};
  if (!cliRef?.id || Number(cliRef.id) !== clienteId) return null;

  const ajuizadoVariant = getAjuizadoVariantFromSituacao(situacao);
  const isAjuizado = !!ajuizadoVariant;
  const isNegativadoSerasa = situacao.startsWith("negativado") && situacao.includes("serasa");
  const isEmAtraso = situacao === "em atraso" || situacao === "atrasado" || situacao === "atrasada";
  const isEmAberto = situacao === "em aberto" || situacao === "aberto" || situacao === "aberta";
  const isVencido = situacao === "vencido" || situacao === "vencida";
  const isAVencer = situacao === "a vencer" || situacao === "avencer" || situacao === "pendente";
  const isAtiva = isEmAberto || isEmAtraso || isVencido || isAVencer || isNegativadoSerasa || isAjuizado;

  // Só ignora quando a situação explícita é de renegociação — o objeto
  // `renegociacao` no JSON costuma existir em crediários ainda em aberto.
  const foiRenegociada = situacao.startsWith("renegoc");
  const isNegativada = isNegativadoSerasa || isAjuizado;
  const foiBaixada = !isNegativada && !!parcela.baixado_em;
  const foiCancelada = !isNegativada && !!parcela.cancelado_em;
  const foiEstornada = !isNegativada && !!parcela.estornado_em;
  const dataPagamento = parcela.data_pagamento ?? parcela.dataPagamento ?? null;
  const valorRecebido = Number(parcela.valor_recebido ?? parcela.valorRecebido ?? 0);
  const valorParcela = Number(parcela.valor ?? 0);
  const foiPaga =
    !isNegativada && (
      !!dataPagamento ||
      situacao === "pago" ||
      situacao === "paga" ||
      situacao === "quitado" ||
      situacao === "quitada" ||
      situacao === "liquidado" ||
      situacao === "liquidada" ||
      (valorParcela > 0 && valorRecebido >= valorParcela)
    );

  if (!isAtiva || foiRenegociada || foiBaixada || foiCancelada || foiEstornada || foiPaga) {
    return null;
  }

  const vencimento = parcela.vencimento as string | null;
  if (!vencimento) return null;
  const vencDate = new Date(vencimento + "T00:00:00Z");
  const diasAtraso = daysBetween(vencDate, today);
  if (diasAtraso <= -2 && !isNegativadoSerasa && !isAjuizado) return null;

  return {
    parcela_id: parcela.id ? Number(parcela.id) : null,
    titulo_id: parcela.titulo?.id ? Number(parcela.titulo.id) : null,
    numero_parcela: parcela.numero_parcela ?? null,
    vencimento,
    dias_atraso: diasAtraso,
    valor: Number(parcela.valor_reajustado ?? parcela.valor_original ?? 0),
    situacao: situacaoRaw,
    forma_pagamento: parcela.forma_pagamento ?? "",
    numero_documento: parcela.titulo?.numero_documento ?? "",
    descricao: parcela.titulo?.descricao ?? "",
    boleto_nosso_numero: parcela.boleto?.nosso_numero ?? null,
    ssotica_raw: parcela,
  };
}
