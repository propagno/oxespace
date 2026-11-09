// Frozen acceptance test for 1.5.0 A16 and A17 on screen (DESIGN U4.3, OXE program, phase F4, tasks FE-P4 and FE-P5).
// Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md (U4.3).
// Contract (BACKEND #704 @ 1788c2da, a16):
// - window.oxe.thread.resolvePath(threadId, raw, { turnId? }) → { kind: 'found', path, placeId, via, line? } |
//   { kind: 'ambiguous', candidates: [{ path, placeId, via }] } | { kind: 'missing', looked: [{ step, path }] }.
// - thread.placeRead(threadId, placeId, relativePath) → fs:read-file's shape plus readOnly: true.
// PathLink({ threadId, raw, turnId? }) in src/components/Threads/PathLink.tsx resolves on activation and opens through
// openPlaceFile({ threadId, path, placeId, line }) (src/components/Threads/openPlaceFile.ts, mocked here). OutsideFileTab
// ({ threadId, placeId, relativePath }) in src/components/Threads/OutsideFileTab.tsx shows an outside file read only.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

const opener = vi.hoisted(() => ({ openPlaceFile: vi.fn(async () => undefined) }))
vi.mock('../../../src/components/Threads/openPlaceFile', () => opener)

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const PLACES = { places: [
  { id: 'pl-tree', kind: 'worktree', path: '/repo-trees/agent-fix', base: null, current: null, writes: 1, files: [], drift: null },
  { id: 'pl-root', kind: 'root', path: '/repo', base: null, current: null, writes: 0, files: [], drift: null },
  { id: 'pl-out', kind: 'outside', path: '/home/me/notes', base: null, current: null, writes: 1, files: ['ROTEIRO.md'], drift: null }
], capped: false }

function mockMain(resolve: unknown, read?: () => Promise<unknown>) {
  const thread = {
    places: vi.fn(async () => PLACES),
    resolvePath: vi.fn(async () => resolve),
    placeRead: vi.fn(read ?? (async () => ({ relativePath: 'ROTEIRO.md', content: '# Roteiro', size: 9, mtimeMs: 1, readOnly: true }))),
    onPlacesChanged: vi.fn(() => () => undefined)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread, clipboard: { writeText: vi.fn(async () => undefined) } } })
  return thread
}
async function renderLink(raw: string) {
  const { PathLink } = await load<{ PathLink: (props: { threadId: string; raw: string; turnId?: string }) => JSX.Element }>('src/components/Threads/PathLink')
  render(<p>See <PathLink threadId="t-1" raw={raw} turnId="turn-1" /> for the fix.</p>)
  return screen.getByRole('link', { name: new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('U4.3 · path links and outside files', () => {
  test('a found path opens the file at its line, asked of main with the turn', async () => {
    const thread = mockMain({ kind: 'found', path: '/repo-trees/agent-fix/src/x.ts', placeId: 'pl-tree', via: 'task-worktree', line: 12 })
    const link = await renderLink('src/x.ts:12')
    await userEvent.click(link)
    await waitFor(() => expect(opener.openPlaceFile).toHaveBeenCalledWith(expect.objectContaining({ threadId: 't-1', path: '/repo-trees/agent-fix/src/x.ts', placeId: 'pl-tree', line: 12 })))
    expect(thread.resolvePath).toHaveBeenCalledWith('t-1', 'src/x.ts:12', { turnId: 'turn-1' })
  })

  test('an ambiguous path opens nothing until one candidate, named by its place, is chosen', async () => {
    mockMain({ kind: 'ambiguous', candidates: [
      { path: '/repo-trees/agent-fix/src/x.ts', placeId: 'pl-tree', via: 'task-place' },
      { path: '/repo/src/x.ts', placeId: 'pl-root', via: 'task-place' }
    ] })
    const link = await renderLink('src/x.ts')
    await userEvent.click(link)
    const menu = await screen.findByRole('menu', { name: 'Which one?' })
    expect(opener.openPlaceFile).not.toHaveBeenCalled()
    const items = within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim())
    expect(items).toEqual(['Task worktree · src/x.ts', 'Main checkout · src/x.ts'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Main checkout · src/x.ts' }))
    await waitFor(() => expect(opener.openPlaceFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo/src/x.ts', placeId: 'pl-root' })))
    expect(opener.openPlaceFile).toHaveBeenCalledTimes(1)
  })

  test('a missing path says where it looked, in order, folded after three, with Find file and Ask the agent', async () => {
    mockMain({ kind: 'missing', looked: [
      { step: 'turn-cwd', path: '/repo-trees/agent-fix/lib/y.ts' }, { step: 'checkout-root', path: '/repo-trees/agent-fix/lib/y.ts' },
      { step: 'task-worktree', path: '/repo-trees/agent-fix/lib/y.ts' }, { step: 'project-root', path: '/repo/lib/y.ts' }, { step: 'task-place', path: '/home/me/notes/lib/y.ts' }
    ] })
    const link = await renderLink('lib/y.ts')
    await userEvent.click(link)
    expect(await screen.findByText(/lib\/y\.ts.*wasn't found\. Looked in, in order:/)).toBeInTheDocument()
    expect(screen.getByText('/repo-trees/agent-fix/lib/y.ts', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/and 2 more/)).toBeInTheDocument()
    expect(screen.queryByText('/home/me/notes/lib/y.ts')).toBeNull()
    expect(screen.getByRole('button', { name: 'Find file…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask the agent' })).toBeInTheDocument()
    expect(opener.openPlaceFile).not.toHaveBeenCalled()
  })

  test('Enter on a link opens it, and the menu is reachable by keyboard', async () => {
    mockMain({ kind: 'ambiguous', candidates: [{ path: '/repo-trees/agent-fix/src/x.ts', placeId: 'pl-tree', via: 'task-place' }, { path: '/repo/src/x.ts', placeId: 'pl-root', via: 'task-place' }] })
    const link = await renderLink('src/x.ts')
    link.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Which one?' })
    await userEvent.keyboard('{ArrowDown}')
    expect(menu.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(opener.openPlaceFile).toHaveBeenCalledTimes(1))
  })

  test('an outside file opens read only with its band and Copy path, and no Save, Rename or Open in editor', async () => {
    const thread = mockMain({ kind: 'found', path: '/home/me/notes/ROTEIRO.md', placeId: 'pl-out', via: 'task-place' })
    const { OutsideFileTab } = await load<{ OutsideFileTab: (props: { threadId: string; placeId: string; relativePath: string }) => JSX.Element }>('src/components/Threads/OutsideFileTab')
    render(<OutsideFileTab threadId="t-1" placeId="pl-out" relativePath="ROTEIRO.md" />)
    expect(await screen.findByText(/Read only · outside the repository · \/home\/me\/notes\/ROTEIRO\.md/)).toBeInTheDocument()
    expect(thread.placeRead).toHaveBeenCalledWith('t-1', 'pl-out', 'ROTEIRO.md')
    expect(screen.getByText('# Roteiro', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    expect(screen.queryByRole('button', { name: /^(Save|Rename|Open in editor)/ })).toBeNull()
    expect(document.querySelector('textarea:not([readonly]), [contenteditable="true"]')).toBeNull()
  })

  test("an outside path main doesn't resolve shows as missing, not as a file", async () => {
    mockMain({ kind: 'missing', looked: [{ step: 'absolute', path: '/etc/passwd' }] })
    const link = await renderLink('/etc/passwd')
    fireEvent.click(link)
    expect(await screen.findByText(/wasn't found/)).toBeInTheDocument()
    expect(opener.openPlaceFile).not.toHaveBeenCalled()
  })
})
