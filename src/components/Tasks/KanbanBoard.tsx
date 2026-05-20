import { useMemo, useState, type ReactElement } from 'react'
import { Play, Workflow } from 'lucide-react'
import type { Task, TaskColumn } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'
import { KanbanColumn } from './KanbanColumn'

export const KANBAN_COLUMNS: Array<{ id: TaskColumn; label: string }> = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
  { id: 'running', label: 'Running' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' }
]

interface KanbanBoardProps {
  workspaceId: string
  tasks: Task[]
  onEdit: (task: Task) => void
}

export function KanbanBoard({ onEdit, tasks, workspaceId }: KanbanBoardProps): ReactElement {
  const reorderTasks = useTasksStore((state) => state.reorderTasks)
  const runPipeline = useTasksStore((state) => state.runPipeline)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Pipeline button is enabled only when there's at least one task whose deps are all done.
  const readyCount = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    return tasks.filter((task) => {
      if (task.column === 'done' || task.runStatus === 'running' || task.runStatus === 'passed') return false
      return (task.dependsOn ?? []).every((depId) => byId.get(depId)?.runStatus === 'passed')
    }).length
  }, [tasks])

  const handleRunPipeline = async (): Promise<void> => {
    setRunning(true)
    setMessage(null)
    try {
      const result = await runPipeline(workspaceId)
      const parts: string[] = []
      if (result.dispatched.length > 0) parts.push(`${result.dispatched.length} disparada(s)`)
      if (result.pending.length > 0) parts.push(`${result.pending.length} pendente(s) (terminal não encontrado)`)
      setMessage(parts.length > 0 ? parts.join(' · ') : 'Nenhuma tarefa pronta para rodar.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="kanban-board-wrapper" data-testid="kanban-board">
      <header className="kanban-board-header">
        <div className="kanban-board-title">
          <Workflow size={13} aria-hidden="true" />
          <strong>Pipeline</strong>
          <span className="kanban-board-ready-count">{readyCount} pronta(s)</span>
        </div>
        <button
          type="button"
          className="kanban-pipeline-btn"
          onClick={() => void handleRunPipeline()}
          disabled={running || readyCount === 0}
        >
          <Play size={11} aria-hidden="true" />
          {running ? 'Disparando…' : 'Run pipeline'}
        </button>
      </header>
      {message ? <div className="kanban-pipeline-message">{message}</div> : null}
      <div className="kanban-board">
        {KANBAN_COLUMNS.map((column) => {
          const columnTasks = tasks
            .filter((task) => task.column === column.id)
            .sort((a, b) => a.position - b.position)
          return (
            <KanbanColumn
              key={column.id}
              column={column.id}
              label={column.label}
              tasks={columnTasks}
              onEdit={onEdit}
              onDropTask={(taskId, targetTaskId, placement = 'after') => {
                const orderedIds = buildOrderedTaskIds(columnTasks, taskId, targetTaskId, placement)
                void reorderTasks({ workspaceId, column: column.id, orderedIds })
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export function buildOrderedTaskIds(
  columnTasks: Task[],
  draggedTaskId: string,
  targetTaskId?: string,
  placement: 'before' | 'after' = 'after'
): string[] {
  const orderedIds = columnTasks.filter((task) => task.id !== draggedTaskId).map((task) => task.id)
  if (!targetTaskId) return [...orderedIds, draggedTaskId]

  const targetIndex = orderedIds.indexOf(targetTaskId)
  if (targetIndex === -1) return [...orderedIds, draggedTaskId]

  const insertAt = placement === 'before' ? targetIndex : targetIndex + 1
  return [...orderedIds.slice(0, insertAt), draggedTaskId, ...orderedIds.slice(insertAt)]
}
