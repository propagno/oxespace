// Frozen acceptance test for 1.5.0 A13, A14 and A15 on screen (DESIGN U4.1 and U4.2, OXE program, phase F4, tasks FE-P2 and
// FE-P3). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md.
// Contract (BACKEND #704 @ 1788c2da):
// - window.oxe.thread.places(threadId) → { places: [{ id, kind: 'root'|'worktree'|'checkout'|'outside', path, base, current,
//   writes, files, drift }], capped }; drift = { from: { branch, commit }, to: { branch, commit }, seenAt, by: [{ kind: 'pane',
//   id, title }], certain: false, dirty, detached }.
// - thread.placeDiff(threadId, placeId) → { place, groups: { task: GitDiff, branchSwitch?: GitDiff } } for a git place, or
//   { place, groups: { written: [{ path, kind, additions?, deletions? }] } } for an outside one.
// - thread.placeDriftAnswer(threadId, placeId, 'switched-back'|'followed'|'dismissed').
// The tab is PlacesChanges({ threadId }) in src/components/Threads/PlacesChanges.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const at = (hour: number, minute: number): number => { const date = new Date(); date.setHours(hour, minute, 0, 0); return date.getTime() }
const file = (path: string, additions = 3, deletions = 1) => ({ path, additions, deletions, hunks: [{ header: '@@ -1,3 +1,5 @@', oldStart: 1, oldLines: 3, newStart: 1, newLines: 5, lines: ['+a', '+b', ' c'] }], mtime: 1 })
const diff = (files: unknown[]) => ({ files, base: '9bb5339', includeUncommitted: true, compiledAt: 1 })
const place = (id: string, kind: string, path: string, extra: Row = {}): Row => ({
  id, kind, path, base: kind === 'outside' ? null : { commit: '9bb5339abc', branch: 'agent-fix', turnId: 'turn-1' },
  current: kind === 'outside' ? null : { branch: 'agent-fix', commit: 'def456' }, writes: 1, files: [], drift: null, ...extra
})
const drift = (o: Row = {}): Row => ({ from: { branch: 'agent-fix', commit: '9bb5339' }, to: { branch: 'main', commit: 'aaa111' }, seenAt: at(14, 31), by: [{ kind: 'pane', id: 'p-9', title: 'zsh · repo' }], certain: false, dirty: false, detached: false, ...o })

function mockMain(places: Row[], diffs: Record<string, unknown>, capped = false) {
  const thread = {
    places: vi.fn(async () => ({ places, capped })),
    placeDiff: vi.fn(async (_threadId: string, placeId: string) => diffs[placeId]),
    placeDriftAnswer: vi.fn(async (_threadId: string, placeId: string) => ({ ok: true, place: places.find(item => item.id === placeId) })),
    onPlacesChanged: vi.fn(() => () => undefined)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread, app: { platform: 'win32', openIn: vi.fn(async () => undefined), openInTargets: async () => ({ editors: [], preferred: 'auto' }) } } })
  return thread
}
async function renderTab() {
  const { PlacesChanges } = await load<{ PlacesChanges: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/PlacesChanges')
  render(<PlacesChanges threadId="t-1" />)
}
const section = (heading: string): HTMLElement => screen.getByRole('heading', { name: new RegExp(`^${heading}`) }).closest('section') as HTMLElement

const THREE = [place('pl-tree', 'worktree', '/repo-trees/agent-fix'), place('pl-other', 'checkout', '/work/other'), place('pl-out', 'outside', '/home/me/notes')]
const THREE_DIFFS = {
  'pl-tree': { place: THREE[0], groups: { task: diff([file('src/app.ts')]) } },
  'pl-other': { place: THREE[1], groups: { task: diff([file('src/x.ts', 1, 0)]) } },
  'pl-out': { place: THREE[2], groups: { written: [{ path: 'ROTEIRO.md', kind: 'add', additions: 12 }] } }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.1 · Changes, grouped by place', () => {
  test('a worktree, another checkout and an outside folder give three headed sections in order, each against its own base', async () => {
    mockMain(THREE, THREE_DIFFS)
    await renderTab()
    await screen.findByText('src/app.ts')
    const headings = screen.getAllByRole('heading').map(heading => heading.textContent ?? '').filter(text => /Task worktree|Main checkout|Another checkout|Outside the repository/.test(text))
    expect(headings.map(text => text.match(/Task worktree|Main checkout|Another checkout|Outside the repository/)?.[0])).toEqual(['Task worktree', 'Another checkout', 'Outside the repository'])
    expect(within(section('Task worktree')).getByText(/against 9bb5339, where the task started/)).toBeInTheDocument()
    expect(within(section('Outside the repository')).getByText('Not a git checkout: files as the agent wrote them')).toBeInTheDocument()
    expect(screen.getByText(/in 3 places/)).toBeInTheDocument()
  })

  test('outside files have no Undo and the outside folder offers Open folder; git places offer Undo file and Discard', async () => {
    mockMain(THREE, THREE_DIFFS)
    await renderTab()
    await screen.findByText('ROTEIRO.md')
    const outside = section('Outside the repository')
    expect(within(outside).queryByRole('button', { name: /Undo/ })).toBeNull()
    expect(within(outside).getByRole('button', { name: 'Open folder' })).toBeInTheDocument()
    expect(within(section('Task worktree')).getAllByRole('button', { name: /Undo file/ }).length).toBeGreaterThan(0)
    expect(within(section('Task worktree')).getByRole('button', { name: /^Discard/ })).toBeInTheDocument()
  })

  test('Discard confirms with Cancel focused, and Escape cancels', async () => {
    mockMain(THREE, THREE_DIFFS)
    await renderTab()
    await screen.findByText('src/app.ts')
    await userEvent.click(within(section('Task worktree')).getByRole('button', { name: /^Discard/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('the cap reads as one info line, and an empty conversation says where changes will show', async () => {
    mockMain(THREE, THREE_DIFFS, true)
    await renderTab()
    expect(await screen.findByText('Tracking the first 32 places of this conversation.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    mockMain([place('pl-root', 'root', '/repo', { writes: 0 })], { 'pl-root': { place: place('pl-root', 'root', '/repo'), groups: { task: diff([]) } } })
    await renderTab()
    expect(await screen.findByText('No changes. Files the agent writes show up here, by where it wrote them.')).toBeInTheDocument()
  })
})

describe('U4.2 · branch drift', () => {
  const drifted = (o: Row = {}) => [place('pl-tree', 'worktree', '/repo-trees/agent-fix', { drift: drift(o) })]
  const driftDiff = { 'pl-tree': { place: drifted()[0], groups: { task: diff([file('src/app.ts')]), branchSwitch: diff([file('README.md', 40, 2)]) } } }

  test('the card names the time, both branches and the pane, and keeps the two lists apart', async () => {
    mockMain(drifted(), driftDiff)
    await renderTab()
    expect(await screen.findByText('This worktree is on another branch now.')).toBeInTheDocument()
    expect(screen.getByText(/At 14:31 it moved from agent-fix to main, probably from your terminal "zsh · repo"\./)).toBeInTheDocument()
    const task = screen.getByRole('heading', { name: 'Changed by the task' }).closest('section') as HTMLElement
    const sw = screen.getByRole('heading', { name: 'Changed by the branch switch' }).closest('section') as HTMLElement
    expect(within(task).getByText('src/app.ts')).toBeInTheDocument()
    expect(within(task).queryByText('README.md')).toBeNull()
    expect(within(sw).getByText('README.md')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open that terminal' })).toBeInTheDocument()
  })

  test('two panes read "one of your terminals", and with no pane there is no Open that terminal', async () => {
    mockMain(drifted({ by: [{ kind: 'pane', id: 'p-1', title: 'zsh' }, { kind: 'pane', id: 'p-2', title: 'bash' }] }), driftDiff)
    await renderTab()
    expect(await screen.findByText(/probably from one of your terminals: zsh, bash/)).toBeInTheDocument()
    cleanup()
    mockMain(drifted({ by: [] }), driftDiff)
    await renderTab()
    const card = await screen.findByText(/At 14:31 it moved from agent-fix to main\./)
    expect(card.textContent).not.toMatch(/probably/)
    expect(screen.queryByRole('button', { name: 'Open that terminal' })).toBeNull()
  })

  test('Switch back is disabled with the reason on a dirty tree and on a detached HEAD', async () => {
    mockMain(drifted({ dirty: true }), driftDiff)
    await renderTab()
    expect(await screen.findByRole('button', { name: 'Switch back to agent-fix' })).toBeDisabled()
    expect(screen.getByText('Commit or move the uncommitted changes first.')).toBeInTheDocument()
    cleanup()
    mockMain(drifted({ detached: true }), driftDiff)
    await renderTab()
    expect(await screen.findByRole('button', { name: 'Switch back to agent-fix' })).toBeDisabled()
    expect(screen.getByText('HEAD is detached; check out a branch first.')).toBeInTheDocument()
  })

  test('Follow confirms with Cancel focused before main is asked; Escape cancels; Dismiss asks main at once', async () => {
    const thread = mockMain(drifted(), driftDiff)
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Follow the new branch' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Follow main? The task\'s changes are compared against main from now on.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(thread.placeDriftAnswer).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Follow the new branch' }))
    dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^Follow/ }))
    await waitFor(() => expect(thread.placeDriftAnswer).toHaveBeenCalledWith('t-1', 'pl-tree', 'followed'))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(thread.placeDriftAnswer).toHaveBeenCalledWith('t-1', 'pl-tree', 'dismissed'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('Switch back confirms with its own words and asks main to switch back', async () => {
    const thread = mockMain(drifted(), driftDiff)
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Switch back to agent-fix' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("Switch the worktree back to agent-fix? Your terminal's branch main stays as it is.")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: /^Switch back/ }))
    await waitFor(() => expect(thread.placeDriftAnswer).toHaveBeenCalledWith('t-1', 'pl-tree', 'switched-back'))
  })
})
