import type { DragEvent, ReactElement } from 'react'
import type { Task, TaskColumn } from '../../../shared/types/task'
import { TaskCard } from './TaskCard'

interface KanbanColumnProps {
  column: TaskColumn
  label: string
  tasks: Task[]
  onEdit: (task: Task) => void
  onDropTask: (taskId: string, targetTaskId?: string, placement?: 'before' | 'after') => void
}

export function KanbanColumn({ column, label, onDropTask, onEdit, tasks }: KanbanColumnProps): ReactElement {
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/task-id')
    if (taskId) onDropTask(taskId)
  }

  return (
    <section
      className="kanban-column"
      data-testid="kanban-column"
      data-column={column}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="kanban-column-header">
        <span>{label}</span>
        <strong>{tasks.length}</strong>
      </header>
      <div className="kanban-column-body">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onEdit={() => onEdit(task)} onDropTask={onDropTask} />
        ))}
      </div>
    </section>
  )
}
