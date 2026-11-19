// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-242, PS-08·15, CA-1 and CA-2).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceSettingsModal } from '../../../src/components/Workspace/WorkspaceSettingsModal'
import { useTerminalPrefsStore } from '../../../src/store/terminal-prefs.store'
import type { Workspace } from '../../../shared/types/workspace'

const demoWorkspace = {
  id: 'ws-ps08-15',
  name: 'Demo',
  rootPath: '/tmp/demo',
  themeId: 'default',
  uiDensity: 'default',
  layoutPreset: 4,
  defaultShellProfileId: 'builtin-pwsh',
  panes: [],
  layout: { type: 'leaf', paneId: 'p1' },
  activePaneId: 'p1'
} as unknown as Workspace

afterEach(() => {
  cleanup()
  useTerminalPrefsStore.getState().clearOverrides(demoWorkspace.id)
})

describe('OXE-242 · PS-08·15 WorkspaceSettingsModal Switch and SettingsCenter footer', () => {
  test('TerminalOverrideSection uses the src/ui Switch inside SettingRow, no raw checkbox', () => {
    const { container } = render(
      <WorkspaceSettingsModal
        embedded
        workspace={demoWorkspace}
        shellProfiles={[]}
        onClose={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />
    )

    const terminalSection = container.querySelector('section[aria-labelledby="ws-section-terminal"]')
    expect(terminalSection).not.toBeNull()
    expect(terminalSection?.querySelector('input[type="checkbox"]')).toBeNull()

    const settingRow = terminalSection?.querySelector('[data-ui="setting-row"]')
    expect(settingRow).not.toBeNull()
    const sw = settingRow?.querySelector('[role="switch"]')
    expect(sw).not.toBeNull()
    expect(sw?.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(sw!)
    expect(sw?.getAttribute('aria-checked')).toBe('true')
    expect(useTerminalPrefsStore.getState().overrides[demoWorkspace.id]).toBeDefined()
  })

  test('the WorkspaceSettingsModal footer has the SettingsCenter mould and order of actions', () => {
    const onClose = vi.fn()
    const { container } = render(
      <WorkspaceSettingsModal
        embedded
        workspace={demoWorkspace}
        shellProfiles={[]}
        onClose={onClose}
        onSave={vi.fn(async () => undefined)}
      />
    )

    const footer = container.querySelector('footer.modal-actions[data-ui="dialog-footer"]')
    expect(footer).not.toBeNull()

    const children = Array.from(footer!.children)
    expect(children[0]?.tagName).toBe('P')
    const backBtn = screen.getByRole('button', { name: /Back to work|Voltar ao trabalho/i })
    expect(footer?.contains(backBtn)).toBe(true)
    expect(backBtn.getAttribute('data-ui')).toBe('button')

    fireEvent.click(backBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
