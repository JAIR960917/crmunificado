/** Atividades geradas pelo sistema (mudança de coluna, WhatsApp do fluxo) — não são tarefas manuais do usuário. */
export function isSystemCobrancaActivity(title: string | null | undefined): boolean {
  const t = (title || "").trim();
  return t.startsWith("Mudou de coluna:") || t.startsWith("WhatsApp enviado —");
}

export function isManualCobrancaActivity(title: string | null | undefined): boolean {
  return !isSystemCobrancaActivity(title);
}
