// Frozen acceptance test for 1.5.0 A63 on screen (DESIGN U4.7, OXE program, phase F4, task FE-P11). Written by the planner;
// the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md (U4.7 and its 08/11 update).
// Contract (BACKEND #704 §A63): window.oxe.worktreesPanel.list({ rootPath }) → rows { path, branch, conversation | null,
// merged: { by: 'provider'|'git', value }, prNumber, changed, diskBytes, lastActivity, branchChanged }, sorted by main;
// remove({ rootPath, path, deleteBranch, confirmUnmerged? }) → { ok: true, branchDeleted } or a C3 refusal
// (worktree.remove.dirty { count }, worktree.remove.unmergedBranch { branch }). The panel is WorktreesPanel({ rootPath })
// in src/components/Worktree/WorktreesPanel.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MAIN_MESSAGE_ERROR_TAG } from '../../../shared/messages'

type Panel = { WorktreesPanel: (props: { rootPath: string }) => JSX.Element }
const DAY = 86_400_000
const ROWS = [
  { path: '/repo-merged', branch: 'agent-old', conversation: { id: 't-1', title: 'Fix the checkout', gone: false }, merged: { by: 'provider', value: true }, prNumber: 300, changed: 0, diskBytes: 120_000_000, lastActivity: Date.now() - 9 * DAY, branchChanged: false },
  { path: '/repo-open', branch: 'agent-pr', conversation: { id: 't-2', title: 'Add exports', gone: true }, merged: { by: 'provider', value: false }, prNumber: 321, changed: 0, diskBytes: 80_000_000, lastActivity: Date.now() - 2 * DAY, branchChanged: false },
  { path: '/repo-dirty', branch: 'agent-wip', conversation: null, merged: { by: 'provider', value: false }, prNumber: null, changed: 3, diskBytes: 40_000_000, lastActivity: Date.now() - DAY, branchChanged: true }
]

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
function mockMain(rows: Array<Record<string, unknown>> = ROWS) {
  const api = { list: vi.fn(async () => rows), remove: vi.fn(async () => ({ ok: true, branchDeleted: false })) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, worktreesPanel: api } })
  return api
}
async function renderPanel() {
  const { WorktreesPanel } = await load<Panel>('src/components/Worktree/WorktreesPanel')
  const { Toaster } = await import('../../../src/ui/Toast')
  render(<><WorktreesPanel rootPath="/repo" /><Toaster /></>)
  await screen.findByText('agent-old')
}
const rowOf = (branch: string): HTMLElement => screen.getByText(branch).closest('tr') as HTMLElement

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.7 · worktree cleanup', () => {
  test("rows keep main's order and read their state: Merged, Open PR #N, N changed, Branch changed since", async () => {
    mockMain()
    await renderPanel()
    expect(screen.getAllByRole('row').filter(row => row.closest('tbody')).map(row => row.textContent)).toEqual([
      expect.stringContaining('agent-old'), expect.stringContaining('agent-pr'), expect.stringContaining('agent-wip')
    ])
    expect(within(rowOf('agent-old')).getByText('Merged')).toBeInTheDocument()
    expect(within(rowOf('agent-pr')).getByText('Open PR #321')).toBeInTheDocument()
    expect(within(rowOf('agent-wip')).getByText('3 changed')).toBeInTheDocument()
    expect(within(rowOf('agent-wip')).getByText('Branch changed since')).toBeInTheDocument()
    expect(within(rowOf('agent-pr')).getByText(/Add exports.*\(removed\)/)).toBeInTheDocument()
    expect(within(rowOf('agent-wip')).getByText('—')).toBeInTheDocument()
  })

  test('with only git, merged says it may miss squash merges', async () => {
    mockMain([{ ...ROWS[0], merged: { by: 'git', value: true } }])
    await renderPanel()
    expect(within(rowOf('agent-old')).getByText('Merged (from git; may miss squash merges)')).toBeInTheDocument()
  })

  test('Remove is disabled on a worktree with uncommitted changes, with the reason', async () => {
    mockMain()
    await renderPanel()
    const remove = within(rowOf('agent-wip')).getByRole('button', { name: /^Remove/ })
    expect(remove).toBeDisabled()
    expect(within(rowOf('agent-wip')).getByText('Commit or discard its changes first.')).toBeInTheDocument()
  })

  test('the dialog has Cancel focused, deletes a merged branch by default, and removes', async () => {
    const api = mockMain()
    await renderPanel()
    await userEvent.click(within(rowOf('agent-old')).getByRole('button', { name: /^Remove/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove the worktree at /repo-merged?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    const box = within(dialog).getByRole('checkbox', { name: 'Also delete branch agent-old' })
    expect(box).toBeChecked()
    api.remove.mockResolvedValueOnce({ ok: true, branchDeleted: true })
    await userEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ rootPath: '/repo', path: '/repo-merged', deleteBranch: true }))
    expect(await screen.findByText(/Removed the worktree; branch deleted/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  test("an unmerged branch is kept by default, and deleting it says so and confirms the unmerged branch", async () => {
    const api = mockMain()
    await renderPanel()
    await userEvent.click(within(rowOf('agent-pr')).getByRole('button', { name: /^Remove/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove the worktree at /repo-open?' })
    const box = within(dialog).getByRole('checkbox', { name: 'Also delete branch agent-pr' })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    expect(within(dialog).getByText('Not merged: its commits stay only on this branch.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ rootPath: '/repo', path: '/repo-open', deleteBranch: true, confirmUnmerged: true }))
  })

  test('keeping the branch says the branch stays, and a dirty refusal from main shows its count', async () => {
    const api = mockMain()
    await renderPanel()
    await userEvent.click(within(rowOf('agent-pr')).getByRole('button', { name: /^Remove/ }))
    let dialog = await screen.findByRole('dialog', { name: 'Remove the worktree at /repo-open?' })
    await userEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }))
    expect(await screen.findByText(/Removed the worktree; the branch stays/)).toBeInTheDocument()
    expect(api.remove).toHaveBeenLastCalledWith({ rootPath: '/repo', path: '/repo-open', deleteBranch: false })
    // Main refuses with a C3 message (shared/messages.ts): the text, then the tag and the JSON the window words.
    api.remove.mockRejectedValueOnce(new Error(`Worktree has uncommitted changes${MAIN_MESSAGE_ERROR_TAG}${JSON.stringify({ code: 'worktree.remove.dirty', params: { count: 2 } })}`))
    await userEvent.click(within(rowOf('agent-old')).getByRole('button', { name: /^Remove/ }))
    dialog = await screen.findByRole('dialog', { name: 'Remove the worktree at /repo-merged?' })
    await userEvent.click(within(dialog).getByRole('button', { name: /^Remove/ }))
    expect(await screen.findByText('2 uncommitted changes. Commit or discard them first.')).toBeInTheDocument()
  })
})
