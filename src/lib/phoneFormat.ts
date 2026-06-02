/**
 * ============================================================================
 * phoneFormat.ts — Formatação de telefone brasileiro
 * ============================================================================
 * Usado em TODOS os formulários de lead/cliente para mostrar (XX) XXXXX-XXXX.
 * No banco salvamos apenas dígitos (use unformatPhone antes de enviar).
 * ============================================================================
 */

/**
 * Formata uma string de telefone como brasileiro:
 *   - Celular: (XX) XXXXX-XXXX  (11 dígitos)
 *   - Fixo:    (XX) XXXX-XXXX   (10 dígitos)
 *
 * Aceita string parcial (ex.: digitando) e formata progressivamente.
 *
 * @param value Texto bruto digitado pelo usuário (com ou sem máscara)
 * @returns Telefone formatado para exibição
 */
export function formatPhoneBR(value: string): string {
  // 1) Mantém só dígitos e limita a 11 (DDD + 9 dígitos).
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;                                                    // (XX
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;                    // (XX) XXXX
  if (digits.length <= 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;                    // fixo
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;                      // celular
}

/**
 * Remove a máscara, mantendo apenas dígitos.
 * Use SEMPRE antes de salvar no banco ou enviar para a API do WhatsApp.
 *
 * @param value Telefone formatado
 * @returns String só com números (ex.: "11987654321")
 */
export function unformatPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Telefone só com dígitos nacionais (DDD + número), sem código do país 55.
 * Ex.: "+55 84 92000-7039" ou "5584920007039" → "84920007039"
 */
export function nationalPhoneDigits(value: string): string {
  let d = unformatPhone(value);
  while (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  while (d.startsWith("0") && d.length > 11) d = d.slice(1);
  return d;
}

/** DDD + celular com 9 dígitos (insere o 9 após o DDD quando faltar). */
export function nationalMobileDigits(value: string): string {
  let d = nationalPhoneDigits(value);
  if (d.length === 10 && d.charAt(2) !== "9") {
    d = `${d.slice(0, 2)}9${d.slice(2)}`;
  }
  return d;
}

/** Variantes para busca no CRM (sempre sem +55 / código 55). */
export function phoneSearchVariants(...values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    if (!raw?.trim()) continue;
    for (const d of [nationalPhoneDigits(raw), nationalMobileDigits(raw)]) {
      if (d.length < 8) continue;
      out.add(d);
      if (d.length >= 10) out.add(d.slice(-10));
      out.add(d.slice(-8));
    }
  }
  return [...out];
}

/** Compara telefones pelo número nacional (ignora +55, máscaras e espaços). */
export function phonesMatchNational(a: string, b: string): boolean {
  const variants = [
    nationalPhoneDigits(a),
    nationalMobileDigits(a),
    nationalPhoneDigits(b),
    nationalMobileDigits(b),
  ];
  const da = nationalMobileDigits(a);
  const db = nationalMobileDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 8 && db.length >= 8 && da.slice(-8) === db.slice(-8)) return true;
  for (const x of variants) {
    for (const y of variants) {
      if (x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8)) return true;
    }
  }
  return false;
}

const COBRANCA_PHONE_KEYS = ["telefone", "celular", "whatsapp", "telefone_principal", "fone"] as const;

/** Extrai o primeiro telefone encontrado no JSON do card de cobrança. */
export function extractPhoneFromCobrancaData(data: Record<string, unknown> | null | undefined): string {
  if (!data) return "";
  for (const key of COBRANCA_PHONE_KEYS) {
    const v = data[key];
    if (v != null && String(v).trim()) return String(v);
  }
  return "";
}
