import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { Task } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'

interface TaskModalProps {
  workspaceId: string
  task: Task | null
  onClose: () => void
}

export function TaskModal({ onClose, task, workspaceId }: TaskModalProps): ReactElement {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [context, setContext] = useState(task?.context ?? '')
  const [verifyCommand, setVerifyCommand] = useState(task?.verifyCommand ?? '')
  const [allowedFiles, setAllowedFiles] = useState(task?.allowedFiles.join('\n') ?? '')
  const createTask = useTasksStore((state) => state.createTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const loadExecutions = useTasksStore((state) => state.loadExecutions)
  const executions = useTasksStore((state) => task ? state.executionsByTask[task.id] ?? [] : [])

  useEffect(() => {
    if (task) void loadExecutions(task.id)
  }, [loadExecutions, task])

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const input = {
      title: title.trim(),
      description,
      context,
      verifyCommand,
      allowedFiles: allowedFiles.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    }
    if (!input.title) return
    if (task) await updateTask(task.id, input)
    else await createTask({ workspaceId, ...input })
    onClose()
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal-box task-modal" onSubmit={(event) => { void handleSubmit(event) }}>
        <h2 className="modal-title">{task ? 'Edit task' : 'Create task'}</h2>
        <label>
          Title
          <input className="modal-input" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Description
          <textarea className="modal-input" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Context
          <textarea className="modal-input" value={context} onChange={(event) => setContext(event.target.value)} />
        </label>
        <label>
          Verify command
          <input className="modal-input" value={verifyCommand} onChange={(event) => setVerifyCommand(event.target.value)} />
        </label>
        <label>
          Allowed files
          <textarea className="modal-input" value={allowedFiles} onChange={(event) => setAllowedFiles(event.target.value)} />
        </label>
        {task ? (
          <section className="task-history">
            <strong>History</strong>
            {executions.length === 0 ? <span>No executions yet</span> : executions.map((execution) => (
              <pre key={execution.id}>{`${execution.type} ${execution.exitCode ?? '-'}\n${execution.output.slice(0, 500)}`}</pre>
            ))}
          </section>
        ) : null}
        <div className="modal-actions">
          <button className="modal-btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="modal-btn-primary" type="submit" disabled={!title.trim()}>Save</button>
        </div>
      </form>
    </div>
  )
}
