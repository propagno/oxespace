import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Task } from '../../shared/types/task'
import { TasksPane } from '../../src/components/Tasks/TasksPane'
import { useTasksStore } from '../../src/store/tasks.store'

describe('TasksPane', () => {
  beforeEach(() => {
    window.oxe = createOxeApiMock()
    useTasksStore.setState({
      tasksByWorkspace: {},
      executionsByTask: {},
      verifyOutputByTask: {},
      loading: false,
      error: null
    })
  })

  test('renders empty state after loading tasks', async () => {
    render(<TasksPane workspaceId="workspace-1" />)

    expect(await screen.findByText('No issues yet')).toBeInTheDocument()
    expect(screen.getByText('Create first issue')).toBeInTheDocument()
  })

  test('shows an alert when running without an active terminal', async () => {
    window.oxe.tasks.list = vi.fn().mockResolvedValue([createTask()])
    window.oxe.tasks.run = vi.fn().mockRejectedValue(new Error('Nenhum terminal ativo'))

    render(<TasksPane workspaceId="workspace-1" />)
    await screen.findByText('Card')
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(window.oxe.tasks.run).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum terminal ativo')
  })
})

function createTask(): Task {
  return {
    id: 'task-1',
    workspaceId: 'workspace-1',
    title: 'Card',
    description: '',
    context: '',
    acceptanceCriteria: '',
    verifyCommand: 'echo ok',
    allowedFiles: [],
    column: 'ready',
    runStatus: 'idle',
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    dependsOn: []
  }
}

function createOxeApiMock(): typeof window.oxe {
  return {
    app: { version: '0.1.0' },
    workspace: {
      list: vi.fn(),
      create: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn(),
      closePane: vi.fn(),
      splitPane: vi.fn(),
      pickFolder: vi.fn(),
      shellProfiles: vi.fn()
    },
    terminal: {
      start: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn())
    },
    agent: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      discover: vi.fn(),
      getReadiness: vi.fn()
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      reorder: vi.fn(),
      run: vi.fn(),
      verify: vi.fn(),
      executions: vi.fn().mockResolvedValue([]),
      onVerifyOutput: vi.fn(() => vi.fn())
    }
  } as unknown as typeof window.oxe
}
