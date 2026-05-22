## Mudanças solicitadas

### 1. Bug: lead criado como "Recomendação" continua na coluna mesmo após tratativa

**Diagnóstico:** A reavaliação atual em `LeadFormDialog.tsx` (linha 929) usa `resolveLeadStatusFromData` com `excludeFieldsMappingTo: [formStatus]` e fallback para o próprio `formStatus`. Quando o lead foi criado **sem responder** os campos do funil (data do exame, sintomas, etc.), nenhuma regra resolve e o fallback mantém em "recomendacao".

**Solução:** Após registrar a tratativa, se nenhuma regra resolveu para um status diferente, mover automaticamente para o status inicial padrão do funil de leads (primeira coluna após "recomendacao", normalmente "novo_lead" ou similar). Buscar a primeira coluna ativa de `crm_statuses` que **não** seja a atual e usar como fallback. Alternativa mais segura: usar o status padrão configurado em `system_settings` (`lead_default_status`), se existir; caso contrário, primeira coluna por `position`.

### 2. Botão "Não atendeu" deve exibir campo de observação

**Arquivo:** `src/components/leads/ContactAttemptForm.tsx`

Hoje, ao clicar em "Não atendeu", o form salva apenas a nota fixa "Cliente NÃO ATENDEU". Adicionar um `Textarea` "Como tentou contato? (descreva as tentativas)" exibido quando `atendeu === "nao"`, obrigatório, e incluí-lo em `buildNoteContent`.

Aplicar a mesma mudança em `RenovacaoContactAttemptForm.tsx` e `CobrancaContactAttemptForm.tsx` para consistência.

### 3. Expandir opções do campo "Venda" na tela Agendamentos

**Arquivo:** `src/pages/AppointmentsPage.tsx`

Trocar `VENDA_OPTIONS` de `["Pendente", "Vendido", "Não Vendido"]` para:
```
["Pendente", "Vendido", "Não Vendido", "Laudo", "Doença no Olho"]
```

**Novo fluxo "Não Vendido":** ao selecionar essa opção (tanto no inline select da tabela quanto no dialog de edição), abrir `Dialog` com:
- "Por que o cliente não comprou?" (textarea, obrigatório)
- "Fez orçamento para o cliente?" (Sim/Não)
- Se Sim: "Valor do orçamento" (number) + "Produtos passados" (textarea)
- "Observação" (textarea, sempre visível, opcional)

Persistir os dados em colunas novas em `crm_appointments`:
- `nao_vendido_motivo TEXT`
- `fez_orcamento BOOLEAN DEFAULT false`
- `orcamento_valor NUMERIC`
- `orcamento_produtos TEXT`
- `orcamento_observacao TEXT`

A migration adiciona apenas colunas (sem mudar RLS existente).

### 4. Tela "Orçamentos"

Quando o agendamento é marcado como "Não Vendido" com "Fez orçamento = Sim", o registro fica disponível em uma nova página `/orcamentos` (item de menu).

**Implementação:**
- Nova rota `OrcamentosPage.tsx` que lista `crm_appointments` filtrando `fez_orcamento = true`.
- Colunas: Cliente, Telefone, Data do agendamento, Valor do orçamento, Produtos, Observação, Vendedor, Ações (editar).
- Filtros: data range e empresa (mesma lógica de filtros do AppointmentsPage).
- Botão para reabrir o dialog "Não Vendido" e editar os dados do orçamento.
- O registro **continua aparecendo** na tela Agendamentos (não é movido, apenas espelhado por filtro).
- Adicionar entrada no `AppSidebar` ("Orçamentos") e em `pagePermissions.ts` (`page_orcamentos`).
- Adicionar rota em `App.tsx`.

### Ordem de execução

1. Criar migration (colunas novas em `crm_appointments`).
2. Corrigir bug do status pós-tratativa em `LeadFormDialog.tsx`.
3. Adicionar campo de observação no `ContactAttemptForm.tsx` (e nas variações renovação/cobrança).
4. Atualizar `VENDA_OPTIONS` + dialog "Não Vendido" em `AppointmentsPage.tsx`.
5. Criar `OrcamentosPage.tsx`, registrar rota, sidebar e permissão.

### Deploy

Após implementar, na VPS:
```
cd /opt/crm && ./deploy.sh --migrations --frontend
```
