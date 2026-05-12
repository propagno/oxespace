import type { DragEvent, ReactElement } from 'react'
import { CheckCircle2, FilePenLine, MessageSquareText, Play, ShieldCheck, Trash2, UsersRound } from 'lucide-react'
import type { Task } from '../../../shared/types/task'
import { useAgentWorkflowStore } from '../../store/agent-workflow.store'
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
  const createTaskRun = useAgentWorkflowStore((state) => state.createTaskRun)
  const prepareStep = useAgentWorkflowStore((state) => state.prepareStep)

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

  const handleRun = (): void => {
    void runTask({ taskId: task.id }).catch(() => undefined)
  }

  const handleVerify = (): void => {
    void verifyTask({ taskId: task.id }).catch(() => undefined)
  }

  return (
    <article
      className="task-card"
      draggable
      onDragOver={(event) => event.preventDefault()}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      data-testid="task-card"
    >
      <div className="task-card-topline">
        <span className={`task-status-dot status-${task.runStatus}`} aria-label={task.runStatus} />
        <strong>{task.title}</strong>
      </div>
      {task.description ? <p>{task.description}</p> : null}
      {verifyOutput ? <pre className="task-output">{verifyOutput.slice(-500)}</pre> : null}
      <footer className="task-card-actions">
        <button type="button" title="Run" onClick={handleRun}>
          <Play size={12} />
        </button>
        <button type="button" title="Create Multi-Agent Run" onClick={() => void createTaskRun(task)}>
          <UsersRound size={12} />
        </button>
        <button type="button" title="Ask Rubber Duck" onClick={() => void createTaskRun(task).then((details) => prepareStep({ runId: details.run.id, role: 'rubber_duck' }))}>
          <MessageSquareText size={12} />
        </button>
        <button type="button" title="Plan with Agent" onClick={() => void createTaskRun(task).then((details) => prepareStep({ runId: details.run.id, role: 'planner' }))}>
          <FilePenLine size={12} />
        </button>
        <button type="button" title="Review Task" onClick={() => void createTaskRun(task).then((details) => prepareStep({ runId: details.run.id, role: 'reviewer' }))}>
          <ShieldCheck size={12} />
        </button>
        <button type="button" title="Verify" disabled={!task.verifyCommand} onClick={handleVerify}>
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
