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
  const addDependency = useTasksStore((state) => state.addDependency)
  const removeDependency = useTasksStore((state) => state.removeDependency)
  const executions = useTasksStore((state) => task ? state.executionsByTask[task.id] ?? [] : [])
  const allTasks = useTasksStore((state) => state.tasksByWorkspace[workspaceId] ?? [])
  const [depError, setDepError] = useState<string | null>(null)

  // Filter candidates: same workspace, not self, not already a dep
  const candidates = allTasks.filter((t) => t.id !== task?.id && !(task?.dependsOn ?? []).includes(t.id))
  const dependsOn = task?.dependsOn ?? []

  useEffect(() => {
    if (task) void loadExecutions(task.id)
  }, [loadExecutions, task])

  const handleAddDep = async (depId: string): Promise<void> => {
    if (!task || !depId) return
    setDepError(null)
    try { await addDependency(task.id, depId) } catch (err) { setDepError(err instanceof Error ? err.message : String(err)) }
  }

  const handleRemoveDep = async (depId: string): Promise<void> => {
    if (!task) return
    setDepError(null)
    try { await removeDependency(task.id, depId) } catch (err) { setDepError(err instanceof Error ? err.message : String(err)) }
  }

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
          <section className="task-deps">
            <strong>Dependências</strong>
            <span className="task-deps-hint">Tarefas que precisam estar <code>passed</code> antes desta rodar.</span>
            {depError ? <div className="task-deps-error">{depError}</div> : null}
            {dependsOn.length === 0 ? (
              <span className="task-deps-empty">Nenhuma dependência</span>
            ) : (
              <ul className="task-deps-list">
                {dependsOn.map((depId) => {
                  const dep = allTasks.find((t) => t.id === depId)
                  return (
                    <li key={depId} className={`task-dep-row status-${dep?.runStatus ?? 'idle'}`}>
                      <span className={`task-status-dot status-${dep?.runStatus ?? 'idle'}`} aria-hidden="true" />
                      <span className="task-dep-title">{dep?.title ?? `(removed: ${depId.slice(0, 8)})`}</span>
                      <button type="button" className="task-dep-remove" onClick={() => void handleRemoveDep(depId)}>×</button>
                    </li>
                  )
                })}
              </ul>
            )}
            {candidates.length > 0 ? (
              <select
                className="modal-input task-deps-add"
                value=""
                onChange={(event) => { void handleAddDep(event.target.value); event.currentTarget.value = '' }}
              >
                <option value="">+ Adicionar dependência…</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            ) : null}
          </section>
        ) : null}

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
