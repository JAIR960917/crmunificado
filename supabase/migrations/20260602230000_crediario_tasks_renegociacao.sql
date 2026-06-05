-- Registro de renegociação nas tarefas do crediário.

ALTER TABLE public.crediario_tasks
  ADD COLUMN IF NOT EXISTS renegociacao_status text
    CHECK (renegociacao_status IS NULL OR renegociacao_status IN ('sim', 'nao')),
  ADD COLUMN IF NOT EXISTS renegociacao_comentario text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid
    REFERENCES public.crediario_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crediario_tasks_parent
  ON public.crediario_tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

COMMENT ON COLUMN public.crediario_tasks.renegociacao_status IS
  'Resultado da renegociação: sim, nao ou null (pendente).';
COMMENT ON COLUMN public.crediario_tasks.renegociacao_comentario IS
  'Comentários sobre a renegociação realizada ou tentativa.';
COMMENT ON COLUMN public.crediario_tasks.completed_at IS
  'Quando a tarefa foi concluída/registrada.';
COMMENT ON COLUMN public.crediario_tasks.parent_task_id IS
  'Tarefa anterior que gerou este agendamento de retorno.';
