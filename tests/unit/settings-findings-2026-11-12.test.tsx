/**
 * Three findings of the Settings round in the real app (2026-11-12): an export with nothing to write said nothing
 * (SET-1), the usage count's "Command bar" counted the palette and not the bar (SET-2), and the MCP page never said
 * where a server is added (SET-4).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '../../src/components/CommandBar/CommandBar'
import { DataSettings } from '../../src/components/Settings/DataSettings'
import { useSkillStore } from '../../src/store/skill.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { Toaster } from '../../src/ui'
import { CommandDialog, CommandInput, CommandList } from '../../src/ui/CommandPalette'

afterEach(cleanup)

// The palette's list measures itself; jsdom has neither of these.
const scope = globalThis as unknown as { ResizeObserver?: unknown }
scope.ResizeObserver ??= class { observe(): void {} unobserve(): void {} disconnect(): void {} }
Element.prototype.scrollIntoView ??= () => undefined

type Bridge = Record<string, unknown>
const bridge = (parts: Bridge): void => { Object.assign(window, { oxe: { ...(window as unknown as { oxe?: Bridge }).oxe, ...parts } }) }

describe('Data and privacy: Export… (SET-1)', () => {
  const state = { upgrade: false, file: null, exportedAt: null, shownNotice: true, error: null, removed: [] }

  it('says there is nothing to export when no file was written', async () => {
    const exportAgain = vi.fn(async () => ({ file: null }))
    bridge({ dataExport: { state: vi.fn(async () => state), exportAgain, reveal: vi.fn(async () => undefined) }, featureUsage: { state: vi.fn(async () => ({ enabled: false, since: null, rows: [] })) } })
    render(<><DataSettings /><Toaster /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Export…' }))
    await waitFor(() => expect(exportAgain).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Nothing to export: this profile has no data from the features removed in 1.5.')).toBeVisible()
  })

  it('says nothing more when a file was written: the row shows it', async () => {
    const exportAgain = vi.fn(async () => ({ file: 'C:/exports/oxespace-removed.json' }))
    bridge({ dataExport: { state: vi.fn(async () => state), exportAgain, reveal: vi.fn(async () => undefined) }, featureUsage: { state: vi.fn(async () => ({ enabled: false, since: null, rows: [] })) } })
    render(<><DataSettings /><Toaster /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Export…' }))
    await waitFor(() => expect(exportAgain).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Nothing to export/)).toBeNull()
  })
})

describe('the usage count of the command bar (SET-2)', () => {
  it('counts the bar each time it opens, and does not count the palette', async () => {
    const record = vi.fn(async () => undefined)
    bridge({ featureUsage: { record }, skill: { list: vi.fn(async () => []), invoke: vi.fn(async () => undefined) }, thread: { respond: vi.fn(async () => undefined) } })
    act(() => { useSkillStore.setState({ skills: [] as never }); useWorkspaceStore.setState({ workspaces: [] as never }) })
    const context = { workspaceId: 'A', threadId: null, pane: null, enabledSkills: [], requests: [] }
    const bar = render(<CommandBar open={false} onOpenChange={vi.fn()} context={context as never} onRun={vi.fn()} />)
    expect(record).not.toHaveBeenCalled()
    bar.rerender(<CommandBar open onOpenChange={vi.fn()} context={context as never} onRun={vi.fn()} />)
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record).toHaveBeenCalledWith('commandBar')
    bar.unmount()

    record.mockClear()
    render(<CommandDialog open onOpenChange={vi.fn()}><CommandInput placeholder="Run a command" /><CommandList>{null}</CommandList></CommandDialog>)
    await screen.findByRole('dialog')
    expect(record).not.toHaveBeenCalled()
  })
})
