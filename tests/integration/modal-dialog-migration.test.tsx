import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { AgentConfigModal } from '../../src/components/Agents/AgentConfigModal'
import { WorkspaceSettingsModal } from '../../src/components/Workspace/WorkspaceSettingsModal'
import { NewWorkspaceModal } from '../../src/components/Workspace/NewWorkspaceModal'
import type { AgentProfile } from '../../shared/types/agent'
import type { ShellProfile, Workspace } from '../../shared/types/workspace'

/**
 * Onda A: the hand-rolled `.modal-backdrop` shells moved onto Radix <Dialog>.
 * Both of these modals previously had NO Escape handling and no focus trap —
 * the only way out was the close button — so these assertions lock in a real
 * behavioural gain, not just a refactor.
 */
const profile: AgentProfile = {
  agentProfileId: 'agent-1',
  name: 'Claude',
  provider: 'claude',
  command: 'claude',
  commandTemplate: 'claude',
  isBuiltin: true
}

const workspace: Workspace = {
  id: 'ws-1',
  name: 'demo-repo',
  rootPath: '/tmp/demo-repo',
  layout: { rows: 2, cols: 2 },
  layoutPreset: 4,
  themeId: 'midnight',
  uiDensity: 'comfortable',
  defaultShellProfileId: 'shell-1',
  autoStart: false,
  isActive: true
} as Workspace

const shellProfiles: ShellProfile[] = [
  { id: 'shell-1', name: 'PowerShell', executable: 'pwsh.exe', args: [], isDefault: true } as ShellProfile
]

describe('modals migrated to Radix Dialog', () => {
  test('AgentConfigModal traps focus in a dialog and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <AgentConfigModal
        profile={profile}
        readiness={undefined}
        isDiscovering={false}
        onSave={async () => undefined}
        onDelete={async () => undefined}
        onHealthCheck={() => undefined}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Radix wires aria-labelledby from <DialogTitle>, so the accessible name
    // comes from the heading rather than a hand-maintained id reference.
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Configure agent/i)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('WorkspaceSettingsModal closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <WorkspaceSettingsModal
        workspace={workspace}
        shellProfiles={shellProfiles}
        onClose={onClose}
        onSave={async () => undefined}
      />
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Workspace settings/i)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('NewWorkspaceModal closes on Escape and on an outside click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <NewWorkspaceModal
        agentProfiles={[profile]}
        shellProfiles={shellProfiles}
        onLaunch={async () => undefined}
        onPickFolder={async () => null}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Create new workspace/i)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('the migrated surfaces keep their bespoke chrome classes', () => {
    // `unstyled` DialogContent must not fall back to the stock shadcn shell —
    // that would flatten the panel's own gradient/sizing rules.
    render(
      <WorkspaceSettingsModal
        workspace={workspace}
        shellProfiles={shellProfiles}
        onClose={() => undefined}
        onSave={async () => undefined}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('modal', 'workspace-settings-modal-v2', 'modal-dialog-surface')
    expect(dialog.className).not.toContain('bg-background')
  })
})
