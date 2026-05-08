import type { ReactElement } from 'react'
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

  return (
    <div className="kanban-board" data-testid="kanban-board">
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
