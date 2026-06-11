/** Ordem em que as perguntas aparecem ao preencher o formulário (mesma lógica do Novo Lead). */
export type FormFieldOrderNode = {
  id: string;
  parent_field_id: string | null;
  position: number;
  label?: string;
  show_at_end?: boolean;
  appear_after_field_id?: string | null;
};

export type FormFieldOrderInfo = {
  order: number;
  total: number;
};

function childrenOf(fields: FormFieldOrderNode[], parentId: string | null) {
  return fields
    .filter((f) => (f.parent_field_id || null) === parentId)
    .sort((a, b) => a.position - b.position);
}

/** Campo reposicionado fora da árvore condicional (final ou após pergunta âncora). */
function isRelocated(field: FormFieldOrderNode): boolean {
  return !!field.show_at_end || !!field.appear_after_field_id;
}

function anchoredAfter(fields: FormFieldOrderNode[], anchorId: string) {
  return fields
    .filter((f) => f.appear_after_field_id === anchorId && !f.show_at_end)
    .sort((a, b) => a.position - b.position);
}

/** Índice global de sequência (raiz → filhos; âncoras e final tratados à parte). */
export function buildFormFillOrderIndex(
  fields: FormFieldOrderNode[],
): Map<string, FormFieldOrderInfo> {
  const map = new Map<string, FormFieldOrderInfo>();
  let order = 0;
  const deferred: FormFieldOrderNode[] = [];

  const insertAnchoredAfter = (anchorId: string) => {
    anchoredAfter(fields, anchorId).forEach(visit);
  };

  const visit = (field: FormFieldOrderNode) => {
    if (isRelocated(field)) {
      if (field.show_at_end) {
        deferred.push(field);
        childrenOf(fields, field.id)
          .filter((c) => !isRelocated(c))
          .forEach(visit);
        return;
      }
      // Inserido via insertAnchoredAfter — registra ordem aqui.
      if (field.appear_after_field_id) {
        order += 1;
        map.set(field.id, { order, total: 0 });
        childrenOf(fields, field.id)
          .filter((c) => !isRelocated(c))
          .forEach(visit);
        insertAnchoredAfter(field.id);
      }
      return;
    }

    order += 1;
    map.set(field.id, { order, total: 0 });
    childrenOf(fields, field.id)
      .filter((c) => !isRelocated(c))
      .forEach(visit);
    insertAnchoredAfter(field.id);
  };

  childrenOf(fields, null).forEach(visit);
  deferred.forEach((field) => {
    order += 1;
    map.set(field.id, { order, total: 0 });
  });

  for (const info of map.values()) {
    info.total = order;
  }
  return map;
}

export function getFormFieldParent(
  fields: FormFieldOrderNode[],
  field: FormFieldOrderNode,
): FormFieldOrderNode | null {
  if (!field.parent_field_id) return null;
  return fields.find((f) => f.id === field.parent_field_id) ?? null;
}

/** Lista plana na ordem de preenchimento, respeitando visibilidade, âncoras e final. */
export function buildVisibleFormFieldOrder<T extends FormFieldOrderNode>(
  fields: T[],
  isVisible: (field: T) => boolean,
): T[] {
  const result: T[] = [];
  const deferred: T[] = [];

  const insertAnchoredAfter = (anchorId: string) => {
    anchoredAfter(fields, anchorId).forEach(addWithChildren);
  };

  const addWithChildren = (field: T) => {
    if (!isVisible(field)) return;
    if (isRelocated(field)) {
      if (field.show_at_end) {
        deferred.push(field);
        fields
          .filter((f) => f.parent_field_id === field.id)
          .filter((c) => !isRelocated(c))
          .sort((a, b) => a.position - b.position)
          .forEach(addWithChildren);
        return;
      }
      // Inserido via insertAnchoredAfter após a pergunta âncora.
      if (field.appear_after_field_id) {
        result.push(field);
        fields
          .filter((f) => f.parent_field_id === field.id)
          .filter((c) => !isRelocated(c))
          .sort((a, b) => a.position - b.position)
          .forEach(addWithChildren);
        insertAnchoredAfter(field.id);
      }
      return;
    }

    result.push(field);
    fields
      .filter((f) => f.parent_field_id === field.id)
      .filter((c) => !isRelocated(c))
      .sort((a, b) => a.position - b.position)
      .forEach(addWithChildren);
    insertAnchoredAfter(field.id);
  };

  fields
    .filter((f) => !f.parent_field_id)
    .sort((a, b) => a.position - b.position)
    .forEach(addWithChildren);

  return [...result, ...deferred];
}
