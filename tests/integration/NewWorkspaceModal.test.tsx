import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { ShellProfile } from '../../shared/types/workspace'
import { NewWorkspaceModal } from '../../src/components/Workspace/NewWorkspaceModal'

const shellProfiles: ShellProfile[] = [
  { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
  { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
]

describe('NewWorkspaceModal', () => {
  test('submits path, layout, shell and autostart', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const onPickFolder = vi.fn().mockResolvedValue('C:/projects/repo')

    render(<NewWorkspaceModal shellProfiles={shellProfiles} onCreate={onCreate} onPickFolder={onPickFolder} onClose={onClose} />)

    await user.click(screen.getByLabelText('Browse folder'))
    await user.click(screen.getByTestId('layout-16'))
    await user.selectOptions(screen.getByLabelText('Shell'), 'builtin-copilot')
    await user.click(screen.getByTestId('btn-create-workspace'))

    expect(onPickFolder).toHaveBeenCalled()
    expect(onCreate).toHaveBeenCalledWith({
      rootPath: 'C:/projects/repo',
      layoutPreset: 16,
      defaultShellProfileId: 'builtin-copilot',
      themeId: 'midnight',
      uiDensity: 'compact',
      autoStart: true
    })
    expect(onClose).toHaveBeenCalled()
  })
})
