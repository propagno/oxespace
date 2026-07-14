import { useMemo, useState, type ReactElement } from 'react'
import { Play, Plus } from 'lucide-react'
import type { Task, TaskColumn } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'
import { KanbanColumn } from './KanbanColumn'

export const KANBAN_COLUMNS: Array<{ id: TaskColumn; label: string; tone: string }> = [
  { id: 'backlog', label: 'Backlog', tone: 'muted' },
  { id: 'ready', label: 'Ready', tone: 'cyan' },
  { id: 'running', label: 'Running', tone: 'amber' },
  { id: 'review', label: 'Review', tone: 'violet' },
  { id: 'done', label: 'Done', tone: 'green' }
]

interface KanbanBoardProps {
  workspaceId: string
  tasks: Task[]
  onEdit: (task: Task) => void
  onCreate: () => void
}

export function KanbanBoard({ onCreate, onEdit, tasks, workspaceId }: KanbanBoardProps): ReactElement {
  const reorderTasks = useTasksStore((state) => state.reorderTasks)
  const runPipeline = useTasksStore((state) => state.runPipeline)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

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
      if (result.dispatched.length > 0) parts.push(`${result.dispatched.length} dispatched`)
      if (result.pending.length > 0) parts.push(`${result.pending.length} pending (no terminal)`)
      setMessage(parts.length > 0 ? parts.join(' · ') : 'No task ready to run.')
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
          <h2>Issues</h2>
          <span className="kanban-board-count">{tasks.length}</span>
          {readyCount > 0 ? (
            <span className="kanban-board-ready-count">{readyCount} ready</span>
          ) : null}
        </div>
        <div className="kanban-board-actions">
          <button
            type="button"
            className="kanban-pipeline-btn"
            onClick={() => void handleRunPipeline()}
            disabled={running || readyCount === 0}
            title="Run all unblocked tasks in available terminals"
          >
            <Play size={12} aria-hidden="true" />
            {running ? 'Dispatching…' : 'Run pipeline'}
          </button>
          <button
            type="button"
            className="kanban-new-btn"
            onClick={onCreate}
            aria-label="Create issue"
          >
            <Plus size={14} aria-hidden="true" />
            New
          </button>
        </div>
      </header>

      {message ? (
        <div className="kanban-pipeline-message" role="status">
          {message}
          <button type="button" className="kanban-pipeline-message-dismiss" onClick={() => setMessage(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

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
              tone={column.tone}
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
