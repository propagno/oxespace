import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { X } from 'lucide-react'
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
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task?.acceptanceCriteria ?? '')
  const [verifyCommand, setVerifyCommand] = useState(task?.verifyCommand ?? '')
  const [allowedFiles, setAllowedFiles] = useState(task?.allowedFiles.join('\n') ?? '')
  const createTask = useTasksStore((state) => state.createTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const loadExecutions = useTasksStore((state) => state.loadExecutions)
  const addDependency = useTasksStore((state) => state.addDependency)
  const removeDependency = useTasksStore((state) => state.removeDependency)
  const executions = useTasksStore((state) => (task ? state.executionsByTask[task.id] ?? [] : []))
  const allTasks = useTasksStore((state) => state.tasksByWorkspace[workspaceId] ?? [])
  const [depError, setDepError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const candidates = allTasks.filter(
    (t) => t.id !== task?.id && !(task?.dependsOn ?? []).includes(t.id)
  )
  const dependsOn = task?.dependsOn ?? []

  useEffect(() => {
    if (task) void loadExecutions(task.id)
  }, [loadExecutions, task])

  const handleAddDep = async (depId: string): Promise<void> => {
    if (!task || !depId) return
    setDepError(null)
    try {
      await addDependency(task.id, depId)
    } catch (err) {
      setDepError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRemoveDep = async (depId: string): Promise<void> => {
    if (!task) return
    setDepError(null)
    try {
      await removeDependency(task.id, depId)
    } catch (err) {
      setDepError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const input = {
      title: title.trim(),
      description,
      context,
      acceptanceCriteria,
      verifyCommand,
      allowedFiles: allowedFiles
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (!input.title) return
    setSaving(true)
    try {
      if (task) await updateTask(task.id, input)
      else await createTask({ workspaceId, ...input })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <header className="task-modal-header">
          <div>
            <h2 id="task-modal-title">{task ? 'Edit issue' : 'New issue'}</h2>
            <p className="task-modal-subtitle">
              {task
                ? 'Update details, acceptance criteria and dependencies.'
                : 'Acceptance criteria go into the agent prompt when you run the task.'}
            </p>
          </div>
          <button type="button" className="task-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="task-modal-body">
          <section className="task-modal-section">
            <h3 className="task-modal-section-title">Basics</h3>
            <label className="task-field">
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short, action-oriented title"
                required
                autoFocus
              />
            </label>
            <label className="task-field">
              <span>Description</span>
              <textarea
                className="task-field-sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What needs to happen?"
              />
            </label>
            <label className="task-field">
              <span>Context</span>
              <textarea
                className="task-field-sm"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="Extra notes for the agent (paths, constraints…)"
              />
            </label>
            <label className="task-field">
              <span>Acceptance criteria</span>
              <textarea
                className="task-field-md"
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
                placeholder="e.g. Save is enabled only after required fields are valid."
              />
              <span className="task-field-hint">Included in the prompt sent to the agent on Run.</span>
            </label>
          </section>

          <section className="task-modal-section">
            <h3 className="task-modal-section-title">Verification</h3>
            <label className="task-field">
              <span>Verify command</span>
              <input
                value={verifyCommand}
                onChange={(event) => setVerifyCommand(event.target.value)}
                placeholder="npm test -- path/to/file"
                spellCheck={false}
              />
            </label>
            <label className="task-field">
              <span>Allowed files</span>
              <textarea
                className="task-field-sm"
                value={allowedFiles}
                onChange={(event) => setAllowedFiles(event.target.value)}
                placeholder={'One path per line\nsrc/app.ts'}
                spellCheck={false}
              />
            </label>
          </section>

          {task ? (
            <section className="task-modal-section task-deps">
              <h3 className="task-modal-section-title">Dependencies</h3>
              <p className="task-deps-hint">
                Issues that must be <code>passed</code> before this one can run in the pipeline.
              </p>
              {depError ? <div className="task-deps-error">{depError}</div> : null}
              {dependsOn.length === 0 ? (
                <span className="task-deps-empty">No dependencies</span>
              ) : (
                <ul className="task-deps-list">
                  {dependsOn.map((depId) => {
                    const dep = allTasks.find((t) => t.id === depId)
                    return (
                      <li key={depId} className={`task-dep-row status-${dep?.runStatus ?? 'idle'}`}>
                        <span
                          className={`task-status-dot status-${dep?.runStatus ?? 'idle'}`}
                          aria-hidden="true"
                        />
                        <span className="task-dep-title">
                          {dep?.title ?? `(removed: ${depId.slice(0, 8)})`}
                        </span>
                        <button
                          type="button"
                          className="task-dep-remove"
                          onClick={() => void handleRemoveDep(depId)}
                          aria-label="Remove dependency"
                        >
                          ×
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {candidates.length > 0 ? (
                <select
                  className="task-deps-add"
                  value=""
                  onChange={(event) => {
                    void handleAddDep(event.target.value)
                    event.currentTarget.value = ''
                  }}
                >
                  <option value="">+ Add dependency…</option>
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </section>
          ) : null}

          {task ? (
            <section className="task-modal-section task-history">
              <h3 className="task-modal-section-title">History</h3>
              {executions.length === 0 ? (
                <span className="task-deps-empty">No executions yet</span>
              ) : (
                executions.map((execution) => (
                  <pre key={execution.id} className="task-history-item">
                    {`${execution.type} · exit ${execution.exitCode ?? '—'}\n${execution.output.slice(0, 400)}`}
                  </pre>
                ))
              )}
            </section>
          ) : null}
        </div>

        <footer className="modal-actions task-modal-footer">
          <button className="btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  )
}
