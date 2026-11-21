// Frozen acceptance test for 1.5.0 A7, behaviour (OXE phase F2). The executor must not edit it.
// Contract: docs/roadmap-1.5/ccr-a7-settings-rows.md sections 3–5. HML-A7-1: the three NEW items are checked by what a
// person sees, not by the source; HML-A7-2: a change that fails to apply says so in its row, with Try again.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyboardSettings } from '../../../src/components/Settings/KeyboardSettings'
import { AutomationsSettings } from '../../../src/components/Settings/AutomationsSettings'
import { SemanticIndexSetting } from '../../../src/components/Settings/SemanticIndexSetting'
import { useSettingsStore } from '../../../src/store/settings.store'
import { SettingRow, Toaster } from '../../../src/ui'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe; vi.restoreAllMocks() })

describe('A7 · R10 Reset all shortcuts applies at once, and Undo puts the custom chords back', () => {
  it('resets, toasts with Undo, and Undo restores what was there', async () => {
    const custom = { 'command-palette': ['Ctrl+Shift+P'] }
    act(() => { useSettingsStore.setState({ keybindingOverrides: custom } as never) })
    const user = userEvent.setup()
    render(<><KeyboardSettings /><Toaster /></>)
    await user.click(screen.getByRole('button', { name: 'Reset all shortcuts' }))
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({})
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(useSettingsStore.getState().keybindingOverrides).toEqual(custom))
  })
})

describe('A7 · I6 deleting an automation asks first', () => {
  const automation = {
    id: 'a1', name: 'Nightly deps', prompt: 'Update dependencies', rootPath: 'C:/repo', agent: 'claude', baseBranch: null,
    schedule: { kind: 'daily', time: '02:00' }, precheck: null, extraArgs: '', timeoutMinutes: 30, graceMinutes: 60,
    enabled: true, createdAt: 1, lastRunAt: null, nextRunAt: null
  }
  it('names it, focuses Cancel, and Cancel or Escape keeps it', async () => {
    const remove = vi.fn(async () => undefined)
    ;(window as unknown as { oxe: unknown }).oxe = { automations: { list: vi.fn(async () => [automation]), runs: vi.fn(async () => []), onChange: vi.fn(() => () => undefined), remove } }
    const user = userEvent.setup()
    render(<AutomationsSettings />)
    await user.click(await screen.findByRole('button', { name: 'Delete Nightly deps' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Nightly deps')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete Nightly deps' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a1'))
  })
})

describe('A7 · I7 removing the search-by-meaning model asks first', () => {
  it('says a new download is needed, focuses Cancel, and Escape keeps the model', async () => {
    const removeModel = vi.fn(async () => ({ enabled: false, installed: false, state: 'not-installed', progress: null, modelId: 'm', error: null, available: true }))
    const status = { enabled: false, installed: true, state: 'off', progress: null, modelId: 'm', error: null, available: true }
    ;(window as unknown as { oxe: unknown }).oxe = { semantic: { getVectorStatus: vi.fn(async () => status), getUsage: vi.fn(async () => null), removeModel } }
    const user = userEvent.setup()
    render(<SemanticIndexSetting />)
    await user.click(await screen.findByRole('button', { name: 'Remove downloaded model' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent ?? '').toMatch(/download/i)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(removeModel).not.toHaveBeenCalled()
  })
})

describe('A7 · a change that fails to apply says so in its row (HML-A7-2)', () => {
  it('SettingRow shows "Couldn\'t change <label>: <reason>" as an alert, with Try again', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(<SettingRow label="Font size" control={<input aria-label="Font size" defaultValue="13" />} error={{ message: 'the settings file is read-only', onRetry: retry }} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't change Font size: the settings file is read-only")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
