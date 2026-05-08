import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { TaskModal } from '../../src/components/Tasks/TaskModal'

describe('TaskModal', () => {
  beforeEach(() => {
    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {} as typeof window.oxe.terminal,
      agent: {} as typeof window.oxe.agent,
      tasks: {
        list: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        run: vi.fn(),
        verify: vi.fn(),
        executions: vi.fn().mockResolvedValue([]),
        onVerifyOutput: vi.fn(() => vi.fn())
      }
    }
  })

  test('requires title and saves allowed files as lines', async () => {
    const user = userEvent.setup()
    render(<TaskModal workspaceId="workspace-1" task={null} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(screen.getByLabelText('Title'), 'Task')
    await user.type(screen.getByLabelText('Allowed files'), 'src/a.ts{enter}src/b.ts')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(window.oxe.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Task',
      allowedFiles: ['src/a.ts', 'src/b.ts']
    }))
  })
})
