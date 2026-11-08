// Frozen acceptance test for 1.5.0 A18 and A54 on screen (DESIGN U4.4 and U4.5, OXE program, phase F4, tasks FE-P6 and
// FE-P8). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md.
// Contract (BACKEND #704 §A18, §A54):
// - window.oxe.terminal.branch(paneId) → { branch, startedOn, switched }, and terminal.onBranchChanged(listener) pushes it.
//   PaneBranchBadge({ paneId }) in src/components/Panes/PaneBranchBadge.tsx.
// - window.oxe.thread.panes(threadId) → [{ paneId, title, workspaceId, placeId, via, group: 'agent' | 'yours' }], read again on
//   thread.onPlacesChanged. ThreadTerminalTab({ threadId }) in src/components/Threads/ThreadTerminalTab.tsx.
// - window.oxe.thread.collisions(threadId) → [{ file, checkoutId, others: [{ conversationId, title }] }], read again on
//   thread.onPlacesChanged. CollisionChips({ threadId }) in src/components/Threads/CollisionChips.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Listener = (event: unknown) => void
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
function mockMain(o: { branch?: unknown[]; panes?: unknown[][]; collisions?: unknown[][] }) {
  const listeners: { branch: Listener[]; places: Listener[] } = { branch: [], places: [] }
  let panesCall = 0, collisionsCall = 0
  const branchValues = o.branch ?? []
  const terminal = {
    branch: vi.fn(async () => branchValues[0]),
    onBranchChanged: vi.fn((listener: Listener) => { listeners.branch.push(listener); return () => undefined })
  }
  const thread = {
    panes: vi.fn(async () => (o.panes ?? [[]])[Math.min(panesCall++, (o.panes ?? [[]]).length - 1)]),
    collisions: vi.fn(async () => (o.collisions ?? [[]])[Math.min(collisionsCall++, (o.collisions ?? [[]]).length - 1)]),
    onPlacesChanged: vi.fn((listener: Listener) => { listeners.places.push(listener); return () => undefined })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, terminal, thread } })
  return { terminal, thread, emitBranch: (value: unknown) => act(() => { for (const listener of listeners.branch) listener(value) }), emitPlaces: () => act(() => { for (const listener of listeners.places) listener({ threadId: 't-1' }) }) }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.4 · the pane branch and terminals in the task', () => {
  test('a pane that switched branch shows the warning badge, saying "switched from" in its name and tooltip', async () => {
    const main = mockMain({ branch: [{ branch: 'agent-fix', startedOn: 'agent-fix', switched: false }] })
    const { PaneBranchBadge } = await load<{ PaneBranchBadge: (props: { paneId: string }) => JSX.Element }>('src/components/Panes/PaneBranchBadge')
    render(<PaneBranchBadge paneId="p-1" />)
    const badge = await screen.findByText('agent-fix')
    expect(main.terminal.branch).toHaveBeenCalledWith('p-1')
    expect(badge.closest('[data-tone]')?.getAttribute('data-tone')).not.toBe('warning')
    main.emitBranch({ paneId: 'p-1', branch: 'main', startedOn: 'agent-fix', switched: true })
    const moved = await screen.findByText('main')
    const holder = moved.closest('[data-tone]') as HTMLElement
    expect(holder.getAttribute('data-tone')).toBe('warning')
    expect(holder.getAttribute('aria-label') ?? '').toMatch(/switched from agent-fix/)
    expect(holder.getAttribute('title') ?? '').toMatch(/switched from agent-fix/)
  })

  test("a pane whose cwd enters a place joins the Terminal tab under Yours, and leaves it when the cwd leaves, with no toast", async () => {
    const yours = { paneId: 'p-9', title: 'zsh · repo', workspaceId: 'ws-1', placeId: 'pl-1', via: 'shell-osc', group: 'yours' }
    const agent = { paneId: 'p-1', title: 'Claude', workspaceId: 'ws-1', placeId: 'pl-1', via: 'agent-location', group: 'agent' }
    const main = mockMain({ panes: [[agent], [agent, yours], [agent]] })
    const { ThreadTerminalTab } = await load<{ ThreadTerminalTab: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/ThreadTerminalTab')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><ThreadTerminalTab threadId="t-1" /><Toaster /></>)
    expect(await screen.findByRole('heading', { name: "Agent's" })).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    main.emitPlaces()
    expect(await screen.findByRole('heading', { name: 'Yours' })).toBeInTheDocument()
    expect(screen.getByText('zsh · repo')).toBeInTheDocument()
    main.emitPlaces()
    await waitFor(() => expect(screen.queryByText('zsh · repo')).toBeNull())
    expect(main.thread.panes).toHaveBeenCalledWith('t-1')
    expect(document.querySelectorAll('[role="status"], [role="alert"]').length).toBe(0)
  })
})

describe('U4.5 · the collision warning', () => {
  const LONG = 'Refactor the payment retry logic so it survives restarts and timeouts'
  test('a file another conversation also edits shows the chip, truncated title, and opens that conversation', async () => {
    mockMain({ collisions: [[{ file: 'src/x.ts', checkoutId: 'c-1', others: [{ conversationId: 't-2', title: LONG }] }]] })
    const { useThreadStore } = await import('../../../src/store/thread.store')
    const select = vi.fn(async () => undefined)
    useThreadStore.setState({ select } as never)
    const { CollisionChips } = await load<{ CollisionChips: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/CollisionChips')
    render(<CollisionChips threadId="t-1" />)
    const chip = await screen.findByRole('button', { name: /^Also edited by/ })
    expect(chip.textContent).toContain(`Also edited by ${LONG.slice(0, 40)}`)
    expect(chip.textContent).not.toContain(LONG)
    expect(chip.textContent).toContain('src/x.ts')
    expect(chip.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
    await userEvent.click(chip)
    expect(select).toHaveBeenCalledWith('t-2')
  })

  test('several files read "and N more", and more than two conversations show two chips and "+N"', async () => {
    mockMain({ collisions: [[
      { file: 'src/x.ts', checkoutId: 'c-1', others: [{ conversationId: 't-2', title: 'Fix A' }, { conversationId: 't-3', title: 'Fix B' }, { conversationId: 't-4', title: 'Fix C' }] },
      { file: 'src/y.ts', checkoutId: 'c-1', others: [{ conversationId: 't-2', title: 'Fix A' }] },
      { file: 'src/z.ts', checkoutId: 'c-1', others: [{ conversationId: 't-2', title: 'Fix A' }] }
    ]] })
    const { CollisionChips } = await load<{ CollisionChips: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/CollisionChips')
    render(<CollisionChips threadId="t-1" />)
    const chips = await screen.findAllByRole('button', { name: /^Also edited by/ })
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toMatch(/Also edited by Fix A: src\/x\.ts and 2 more/)
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  test('the chips clear when main no longer reports the collision', async () => {
    const main = mockMain({ collisions: [[{ file: 'src/x.ts', checkoutId: 'c-1', others: [{ conversationId: 't-2', title: 'Fix A' }] }], []] })
    const { CollisionChips } = await load<{ CollisionChips: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/CollisionChips')
    render(<CollisionChips threadId="t-1" />)
    await screen.findByRole('button', { name: /^Also edited by/ })
    main.emitPlaces()
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Also edited by/ })).toBeNull())
    expect(main.thread.collisions).toHaveBeenCalledWith('t-1')
  })
})
