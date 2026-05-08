import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import type { Task } from '../../../shared/types/task'
import { useTasksStore } from '../../store/tasks.store'
import { KanbanBoard } from './KanbanBoard'
import { TaskModal } from './TaskModal'

interface TasksPaneProps {
  workspaceId: string
}

export function TasksPane({ workspaceId }: TasksPaneProps): ReactElement {
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const tasks = useTasksStore((state) => state.tasksByWorkspace[workspaceId] ?? [])
  const loading = useTasksStore((state) => state.loading)
  const error = useTasksStore((state) => state.error)
  const loadTasks = useTasksStore((state) => state.loadTasks)
  const clearError = useTasksStore((state) => state.clearError)
  const attachVerifyOutputListener = useTasksStore((state) => state.attachVerifyOutputListener)

  useEffect(() => {
    void loadTasks(workspaceId)
  }, [loadTasks, workspaceId])

  useEffect(() => attachVerifyOutputListener(), [attachVerifyOutputListener])

  const empty = useMemo(() => !loading && tasks.length === 0, [loading, tasks.length])

  return (
    <div className="tasks-pane" data-testid="tasks-pane">
      <header className="tasks-pane-header">
        <span>Tasks</span>
        <button
          className="task-icon-btn"
          type="button"
          aria-label="Create task"
          onClick={() => {
            setEditingTask(null)
            setModalOpen(true)
          }}
        >
          <Plus size={14} />
        </button>
      </header>

      {error ? (
        <div className="tasks-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { clearError(); void loadTasks(workspaceId) }}>Retry</button>
        </div>
      ) : null}

      {loading ? <div className="tasks-skeleton">Loading tasks...</div> : null}

      {empty ? (
        <div className="tasks-empty">
          <span>Nenhuma tarefa ainda</span>
          <button type="button" onClick={() => setModalOpen(true)}>Criar primeira task</button>
        </div>
      ) : (
        <KanbanBoard workspaceId={workspaceId} tasks={tasks} onEdit={(task) => { setEditingTask(task); setModalOpen(true) }} />
      )}

      {modalOpen ? (
        <TaskModal
          workspaceId={workspaceId}
          task={editingTask}
          onClose={() => {
            setModalOpen(false)
            setEditingTask(null)
          }}
        />
      ) : null}
    </div>
  )
}
