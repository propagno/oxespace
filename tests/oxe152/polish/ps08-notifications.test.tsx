// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-236, PS-08·8, CA-1 & CA-2).
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { useSettingsStore } from '../../../src/store/settings.store'

const PROPS = {
  agentProfiles: [],
  agentReadiness: [],
  isDiscoveringAgents: false,
  onClose: vi.fn(),
  onDiscoverAgents: vi.fn(),
  onConfigureAgent: vi.fn(),
  onNewCustomAgent: vi.fn()
}

afterEach(() => {
  cleanup()
  delete (window as { oxe?: unknown }).oxe
})

describe('OXE-236 (PS-08·8): Notifications in one mould and Send test notification in its SettingRow', () => {
  it('Notifications is one mould: SettingsSection cards and SettingRow, no settings-toggle-row', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = {
      agentHooks: {
        status: vi.fn(async () => [
          { agent: 'claude-code', state: 'installed', missing: [] },
          { agent: 'codex', state: 'not_installed', missing: [] }
        ])
      }
    }
    const { container } = render(<SettingsContent section="notifications" {...PROPS} />)
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeInTheDocument())

    const body = container.querySelector('.settings-content-body')
    expect(body).not.toBeNull()
    expect(body!.querySelectorAll('.settings-toggle-row')).toHaveLength(0)

    const sections = body!.querySelectorAll('[data-ui="settings-section"]')
    expect(sections.length).toBeGreaterThanOrEqual(3)
    for (const section of sections) {
      expect(section.getAttribute('data-variant')).toBeNull()
    }
    // Every direct child of the body is a SettingsSection card (one mould).
    for (const child of Array.from(body!.children)) {
      expect(child.getAttribute('data-ui')).toBe('settings-section')
    }
    expect(body!.querySelectorAll('[data-ui="setting-row"]').length).toBeGreaterThanOrEqual(4)
  })

  it('Send test notification is a secondary sm Button on the right of its SettingRow and calls sendTest once', async () => {
    const user = userEvent.setup()
    const notify = vi.fn(async () => true)
    ;(window as unknown as { oxe: unknown }).oxe = {
      notifications: { notify }
    }
    useSettingsStore.setState({ notificationsEnabled: true })

    render(<SettingsContent section="notifications" {...PROPS} />)
    const button = screen.getByTestId('btn-test-notification')
    expect(button.getAttribute('data-ui')).toBe('button')
    expect(button.getAttribute('data-variant')).toBe('secondary')
    expect(button.getAttribute('data-size')).toBe('sm')

    const row = button.closest('[data-ui="setting-row"]')
    expect(row, 'button sits inside a SettingRow').not.toBeNull()
    expect(row!.closest('[data-ui="settings-section"]'), 'SettingRow sits inside a SettingsSection').not.toBeNull()
    // The button is inside the right-hand control slot of the SettingRow (not the first/text column).
    expect(button.parentElement).not.toBe(row!.firstElementChild)

    await user.click(button)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'OXESpace',
      paneId: 'test',
      workspaceId: 'test'
    }))
  })
})
