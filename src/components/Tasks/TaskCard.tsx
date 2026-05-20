import { useState, type DragEvent, type ReactElement } from 'react'
import { CheckCircle2, FilePenLine, Lock, Play, ShieldCheck, Trash2 } from 'lucide-react'
import type { Task } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'

interface TaskCardProps {
  task: Task
  onEdit: () => void
  onDropTask?: (taskId: string, targetTaskId: string, placement: 'before' | 'after') => void
}

export function TaskCard({ onDropTask, onEdit, task }: TaskCardProps): ReactElement {
  const deleteTask = useTasksStore((state) => state.deleteTask)
  const runTask = useTasksStore((state) => state.runTask)
  const verifyTask = useTasksStore((state) => state.verifyTask)
  const verifyOutput = useTasksStore((state) => state.verifyOutputByTask[task.id] ?? '')
  const allTasks = useTasksStore((state) => state.tasksByWorkspace[task.workspaceId] ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Compute "blocked" state — deps that haven't passed yet.
  const blockingDeps = (task.dependsOn ?? [])
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((dep): dep is Task => dep !== undefined && dep.runStatus !== 'passed')
  const isBlocked = blockingDeps.length > 0

  const handleDragStart = (event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.setData('text/task-id', task.id)
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const taskId = event.dataTransfer.getData('text/task-id')
    if (!taskId || taskId === task.id) return
    const rect = event.currentTarget.getBoundingClientRect()
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    onDropTask?.(taskId, task.id, placement)
  }

  const handleRun = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      // Writes the task prompt to the workspace's first running terminal.
      await runTask({ taskId: task.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      await verifyTask({ taskId: task.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={`task-card${isBlocked ? ' blocked' : ''}`}
      draggable
      onDragOver={(event) => event.preventDefault()}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      data-testid="task-card"
    >
      <div className="task-card-topline">
        <span className={`task-status-dot status-${task.runStatus}`} aria-label={task.runStatus} />
        <strong>{task.title}</strong>
        {isBlocked ? (
          <span
            className="task-card-blocked"
            title={`Bloqueada por: ${blockingDeps.map((d) => d.title).join(', ')}`}
            aria-label="Bloqueada por dependências"
          >
            <Lock size={11} aria-hidden="true" />
            {blockingDeps.length}
          </span>
        ) : null}
      </div>
      {task.description ? <p>{task.description}</p> : null}
      {verifyOutput ? <pre className="task-output">{verifyOutput.slice(-500)}</pre> : null}
      {error ? <div className="task-card-error" role="status">{error}</div> : null}
      <footer className="task-card-actions">
        <button type="button" title="Run" aria-label="Run task in active terminal" disabled={busy} onClick={() => void handleRun()}>
          <Play size={12} />
        </button>
        <button type="button" title="Verify" disabled={busy || !task.verifyCommand} onClick={() => void handleVerify()}>
          {task.runStatus === 'passed' ? <CheckCircle2 size={12} /> : <ShieldCheck size={12} />}
        </button>
        <button type="button" title="Edit" onClick={onEdit}>
          <FilePenLine size={12} />
        </button>
        <button type="button" title="Delete" onClick={() => void deleteTask(task.workspaceId, task.id)}>
          <Trash2 size={12} />
        </button>
      </footer>
    </article>
  )
}
