import { useState, type DragEvent, type ReactElement } from 'react'
import {
  CheckCircle2,
  FilePenLine,
  GripVertical,
  Lock,
  Play,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { Task } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'
import { useTerminalStore } from '../../store/terminal.store'

interface TaskCardProps {
  task: Task
  onEdit: () => void
  onDropTask?: (taskId: string, targetTaskId: string, placement: 'before' | 'after') => void
}

const STATUS_LABEL: Record<Task['runStatus'], string> = {
  idle: 'Idle',
  running: 'Running',
  verifying: 'Verifying',
  passed: 'Passed',
  failed: 'Failed'
}

export function TaskCard({ onDropTask, onEdit, task }: TaskCardProps): ReactElement {
  const deleteTask = useTasksStore((state) => state.deleteTask)
  const runTask = useTasksStore((state) => state.runTask)
  const verifyTask = useTasksStore((state) => state.verifyTask)
  const verifyOutput = useTasksStore((state) => state.verifyOutputByTask[task.id] ?? '')
  const allTasks = useTasksStore((state) => state.tasksByWorkspace[task.workspaceId] ?? [])
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showOutput, setShowOutput] = useState(false)

  const blockingDeps = (task.dependsOn ?? [])
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((dep): dep is Task => dep !== undefined && dep.runStatus !== 'passed')
  const isBlocked = blockingDeps.length > 0

  const handleDragStart = (event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.setData('text/task-id', task.id)
    event.dataTransfer.effectAllowed = 'move'
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
      // Store surfaces operational errors on the pane banner (single source of truth).
      await runTask({ taskId: task.id, paneId: activePaneId ?? undefined })
    } catch {
      // Pane-level store error is already set by runTask.
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    setShowOutput(true)
    try {
      await verifyTask({ taskId: task.id })
    } catch (err) {
      // Verify failures stay on the card so output + message stay together.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={`task-card${isBlocked ? ' blocked' : ''}${busy ? ' busy' : ''}`}
      draggable
      onDragOver={(event) => event.preventDefault()}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      data-testid="task-card"
    >
      <div className="task-card-topline">
        <span className="task-card-grip" aria-hidden="true" title="Drag to reorder">
          <GripVertical size={12} />
        </span>
        <span
          className={`task-status-dot status-${task.runStatus}`}
          aria-label={task.runStatus}
          title={STATUS_LABEL[task.runStatus]}
        />
        <strong className="task-card-title" title={task.title}>{task.title}</strong>
        {isBlocked ? (
          <span
            className="task-card-blocked"
            title={`Blocked by: ${blockingDeps.map((d) => d.title).join(', ')}`}
            aria-label="Blocked by dependencies"
          >
            <Lock size={10} aria-hidden="true" />
            {blockingDeps.length}
          </span>
        ) : null}
      </div>

      <div className="task-card-meta">
        <span className={`task-status-pill status-${task.runStatus}`}>
          {STATUS_LABEL[task.runStatus]}
        </span>
        {(task.dependsOn?.length ?? 0) > 0 ? (
          <span className="task-card-meta-chip">{task.dependsOn!.length} dep{(task.dependsOn!.length === 1) ? '' : 's'}</span>
        ) : null}
        {task.verifyCommand ? (
          <span className="task-card-meta-chip" title={task.verifyCommand}>verify</span>
        ) : null}
      </div>

      {task.description ? (
        <p className="task-card-desc">{task.description}</p>
      ) : null}

      {verifyOutput && showOutput ? (
        <pre className="task-output">{verifyOutput.slice(-400)}</pre>
      ) : null}

      {verifyOutput && !showOutput ? (
        <button type="button" className="task-card-output-toggle" onClick={() => setShowOutput(true)}>
          Show last output
        </button>
      ) : null}

      {error ? <div className="task-card-error" role="alert">{error}</div> : null}

      <footer className="task-card-actions">
        <button
          type="button"
          title={activePaneId ? 'Run in active terminal' : 'Run in the first available terminal'}
          aria-label="Run"
          disabled={busy || isBlocked}
          onClick={() => void handleRun()}
        >
          <Play size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Verify"
          aria-label="Verify"
          disabled={busy || !task.verifyCommand}
          onClick={() => void handleVerify()}
        >
          {task.runStatus === 'passed' ? (
            <CheckCircle2 size={12} aria-hidden="true" />
          ) : (
            <ShieldCheck size={12} aria-hidden="true" />
          )}
        </button>
        <button type="button" title="Edit" aria-label="Edit" onClick={onEdit}>
          <FilePenLine size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          className="task-card-action-danger"
          onClick={() => void deleteTask(task.workspaceId, task.id)}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </footer>
    </article>
  )
}
