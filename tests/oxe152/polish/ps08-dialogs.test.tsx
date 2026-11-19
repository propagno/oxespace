import { useState, type ReactElement } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AgentActivityDetail } from '../../../src/components/Settings/AgentActivityDetail'
import { HostsProxySettings } from '../../../src/components/Settings/HostsProxySettings'
import { UsageSettings } from '../../../src/components/Settings/UsageSettings'

afterEach(() => {
  cleanup()
})

function ActivityDetailHarness(): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open detail</button>
      <button type="button">Outside target</button>
      {open ? (
        <AgentActivityDetail
          row={{ id: 'row-1', source: 'http', summary: 'GET https://api.example.com', target: 'api.example.com', status: 200 }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

describe('OXE-235 · PS-08·4 Settings dialogs use src/ui Dialog and ConfirmDialog', () => {
  test('AgentActivityDetail traps Tab inside and closes with an IconButton', async () => {
    const user = userEvent.setup()
    render(<ActivityDetailHarness />)

    const trigger = screen.getByRole('button', { name: 'Open detail' })
    const outside = screen.getByRole('button', { name: 'Outside target' })

    await user.click(trigger)
    const dialog = await screen.findByRole('dialog')

    const closeBtn = within(dialog).getByRole('button', { name: 'Close' })
    expect(closeBtn).toHaveAttribute('data-ui', 'icon-button')
    expect(closeBtn.textContent?.trim()).toBe('')

    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).not.toBe(outside)
    }

    await user.click(closeBtn)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  test('ClearHostsDialog and PromptDialog are the src/ui ConfirmDialog: Escape closes and focus returns to the trigger', async () => {
    const user = userEvent.setup()
    const now = Date.now()

    const hostsProxy = {
      state: vi.fn(async () => ({
        enabled: true,
        state: 'running',
        hosts: [{ host: 'api.example.com', port: 443, count: 2, lastSeen: now, firstSeen: now }]
      })),
      setEnabled: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      onChanged: vi.fn(() => () => undefined)
    }

    const featureUsage = {
      state: vi.fn(async () => ({
        enabled: true,
        since: now - 10_000,
        rows: [{ feature: 'commandBar', uses: 4, lastUsed: now }]
      })),
      setEnabled: vi.fn(async () => undefined),
      export: vi.fn(async () => null),
      clear: vi.fn(async () => undefined),
      record: vi.fn(),
      onChanged: vi.fn(() => () => undefined)
    }

    Object.assign(window, {
      oxe: { ...(window as unknown as { oxe?: object }).oxe, hostsProxy, featureUsage }
    })

    const { unmount } = render(<HostsProxySettings />)
    const clearHostsTrigger = await screen.findByRole('button', { name: 'Clear the list…' })
    await user.click(clearHostsTrigger)

    const hostsDialog = await screen.findByRole('dialog')
    expect(hostsDialog.querySelector('[data-dialog-footer]')).not.toBeNull()
    expect(hostsDialog.querySelector('[data-dialog-cancel]')).not.toBeNull()
    expect(hostsDialog.querySelector('[data-dialog-primary]')).not.toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(clearHostsTrigger).toHaveFocus())
    expect(hostsProxy.clear).not.toHaveBeenCalled()

    unmount()

    render(<UsageSettings />)
    const clearUsageTrigger = await screen.findByRole('button', { name: 'Clear the count…' })
    await user.click(clearUsageTrigger)

    const usageDialog = await screen.findByRole('dialog')
    expect(usageDialog.querySelector('[data-dialog-footer]')).not.toBeNull()
    expect(usageDialog.querySelector('[data-dialog-cancel]')).not.toBeNull()
    expect(usageDialog.querySelector('[data-dialog-primary]')).not.toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(clearUsageTrigger).toHaveFocus())
    expect(featureUsage.clear).not.toHaveBeenCalled()
  })
})
