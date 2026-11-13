// 1.5.1 emergency fixes from the user's report of 13/11: finished background shells no longer cover the conversation,
// the conversation's Terminal tab opens a pane in OxeCode, and the 1.5 notice keeps its actions before Dismiss.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadBackgroundShells } from '../src/components/Threads/ThreadBackgroundShells'
import { ThreadTerminalTab } from '../src/components/Threads/ThreadTerminalTab'

const shell = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, command: `cmd ${id}`, startedBy: 'agent', state: 'stopped', exitCode: 0, since: Date.now(), tail: [`out ${id}`], canStop: false, ...o
})

function mockThread(api: Record<string, unknown>): void {
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread: api } })
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('background shells in the composer dock', () => {
  it('shows a running shell in full and only the latest two finished ones, the rest behind Show earlier', async () => {
    mockThread({
      background: vi.fn(async () => [shell('a'), shell('b'), shell('c'), shell('d'), shell('live', { state: 'running', tail: ['tick'] })]),
      onBackgroundChanged: vi.fn(() => () => undefined)
    })
    render(<ThreadBackgroundShells threadId="t-1" />)
    expect(await screen.findByText('cmd live')).toBeTruthy()
    expect(screen.getByText('tick')).toBeTruthy()
    expect(screen.queryByText('cmd a')).toBeNull()
    expect(screen.queryByText('cmd b')).toBeNull()
    expect(screen.getByText('cmd c')).toBeTruthy()
    expect(screen.getByText('cmd d')).toBeTruthy()
    // A finished shell's output stays folded until asked for.
    expect(screen.queryByText('out d')).toBeNull()
    const row = screen.getByText('cmd d').closest('article') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Show output' }))
    expect(within(row).getByText('out d')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Hide output' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 earlier' }))
    expect(screen.getByText('cmd a')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('cmd a')).toBeNull()
  })
})

describe("the conversation's Terminal tab", () => {
  it('opens a pane in OxeCode with its workspace', async () => {
    mockThread({
      panes: vi.fn(async () => [{ paneId: 'p-1', title: 'Claude', workspaceId: 'ws-1', placeId: 'pl', via: 'agent-location', group: 'agent' }]),
      onPlacesChanged: vi.fn(() => () => undefined)
    })
    const opened = vi.fn()
    const listener = (event: Event): void => opened((event as CustomEvent).detail)
    window.addEventListener('oxe:open-pane', listener)
    render(<ThreadTerminalTab threadId="t-1" />)
    await userEvent.click((await screen.findByText('Claude')).closest('button') as HTMLElement)
    window.removeEventListener('oxe:open-pane', listener)
    expect(opened).toHaveBeenCalledWith({ paneId: 'p-1', workspaceId: 'ws-1' })
  })
})

describe('the 1.5 removal notice', () => {
  it('floats as a card and puts See what changed before Dismiss in the tab order', async () => {
    Object.assign(window, { oxe: { dataExport: {
      state: vi.fn(async () => ({ upgrade: true, file: null, exportedAt: null, shownNotice: false, error: null, removed: [] })),
      markNoticeShown: vi.fn(async () => undefined)
    } } })
    const { RemovedFeaturesBand } = await import('../src/components/Updates/RemovedFeaturesBand')
    render(<RemovedFeaturesBand />)
    const status = await waitFor(() => screen.getByRole('status'))
    const buttons = within(status).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons).toEqual(['See what changed', 'Dismiss'])
    expect(status.style.background).toBe('')
  })
})
