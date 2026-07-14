import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { LayoutList, Plus } from 'lucide-react'
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

  const openCreate = (): void => {
    setEditingTask(null)
    setModalOpen(true)
  }

  const openEdit = (task: Task): void => {
    setEditingTask(task)
    setModalOpen(true)
  }

  return (
    <div className="tasks-pane" data-testid="tasks-pane">
      {error ? (
        <div className="tasks-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { clearError(); void loadTasks(workspaceId) }}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="tasks-skeleton" role="status">
          <span className="tasks-skeleton-pulse" aria-hidden="true" />
          Loading issues…
        </div>
      ) : null}

      {empty ? (
        <div className="tasks-empty">
          <div className="tasks-empty-icon" aria-hidden="true">
            <LayoutList size={22} />
          </div>
          <strong>No issues yet</strong>
          <p>Track work as cards — run, verify, and move them across the board.</p>
          <button type="button" className="tasks-empty-cta" onClick={openCreate}>
            <Plus size={14} aria-hidden="true" />
            Create first issue
          </button>
        </div>
      ) : (
        <KanbanBoard
          workspaceId={workspaceId}
          tasks={tasks}
          onEdit={openEdit}
          onCreate={openCreate}
        />
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
