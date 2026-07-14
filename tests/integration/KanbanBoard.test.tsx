import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Task } from '../../shared/types/task'
import { buildOrderedTaskIds, KanbanBoard } from '../../src/components/Tasks/KanbanBoard'

describe('KanbanBoard', () => {
  test('renders five columns and task status', () => {
    render(
      <KanbanBoard
        workspaceId="workspace-1"
        tasks={[createTask()]}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
      />
    )

    expect(screen.getAllByTestId('kanban-column')).toHaveLength(5)
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('Card')).toBeInTheDocument()
    expect(screen.getByLabelText('idle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create issue/i })).toBeInTheDocument()
  })

  test('builds positional order when dropping before a target card', () => {
    const tasks = [
      createTask('task-1', 'First', 0),
      createTask('task-2', 'Second', 1),
      createTask('task-3', 'Third', 2)
    ]

    expect(buildOrderedTaskIds(tasks, 'task-3', 'task-1', 'before')).toEqual(['task-3', 'task-1', 'task-2'])
    expect(buildOrderedTaskIds(tasks, 'task-1', 'task-3', 'after')).toEqual(['task-2', 'task-3', 'task-1'])
  })
})

function createTask(id = 'task-1', title = 'Card', position = 0): Task {
  return {
    id,
    workspaceId: 'workspace-1',
    title,
    description: 'Description',
    context: '',
    acceptanceCriteria: '',
    verifyCommand: 'echo ok',
    allowedFiles: [],
    column: 'backlog',
    runStatus: 'idle',
    position,
    createdAt: 1,
    updatedAt: 1,
    dependsOn: []
  }
}
