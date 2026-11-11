// Frozen acceptance test for CR-F4-D1 to CR-F4-D8 (OXE program, phase F4): DESIGN's async pass on #749 @ 84440c3c
// (1.5.0-design-signoff.md, accepted by the TECH LEAD 09/11), against 1.5.0-f4-design.md U4.1, U4.2, U4.5, U4.6, U4.7.
// Written by the planner; the executor must not edit it. It renders the real ThreadChangesPanel, CollisionChips,
// PullRequestTab and WorktreesPanel over the real preload (crf4-8-preload.ts), and reads what a person sees.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { ThreadChangesPanel } from '../../../src/components/Threads/ThreadChangesPanel'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { GitDiff } from '../../../shared/types/git'
import type { ThreadPlace, ThreadPlaceDiff } from '../../../shared/types/thread-places'
import type { Workspace } from '../../../shared/types/workspace'
import { preloadOxe, type FakeMain } from './crf4-8-preload'

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const LONG = '/repo-trees/conversations-with-a-very-long-folder-name-that-cannot-fit-in-the-place-header/agent-fix'
const TREE: ThreadPlace = {
  id: 'pl-tree', kind: 'worktree', path: LONG, firstSeenAt: 1,
  base: { commit: '9bb5339aa1', branch: 'agent/fix-login', capturedAt: 1, turnId: 't1' }, current: { branch: 'agent/fix-login', commit: '9bb5339aa1' },
  drift: null, writes: 2, files: ['src/x.ts', 'src/y.ts']
}
const OTHER: ThreadPlace = {
  id: 'pl-co', kind: 'checkout', path: '/other-repo', firstSeenAt: 2,
  base: { commit: 'abc1234ff', branch: 'main', capturedAt: 2, turnId: 't1' }, current: { branch: 'main', commit: 'abc1234ff' },
  drift: null, writes: 1, files: ['README.md']
}
const DRIFT = { from: { branch: 'agent/fix-login', commit: '9bb5339' }, to: { branch: 'main', commit: 'abc1234' }, seenAt: Date.UTC(2026, 10, 9, 14, 31), by: [], certain: false, dirty: true }

function diff(files: GitDiff['files']): GitDiff { return { files, base: 'b', includeUncommitted: true, compiledAt: 1 } }
const X = { path: 'src/x.ts', additions: 12, deletions: 4, mtime: 5, hunks: [{ header: '@@ -10,4 +10,6 @@', lines: [
  { type: 'removed' as const, oldLineNo: 11, newLineNo: null, content: 'const x = 1' }, { type: 'added' as const, oldLineNo: null, newLineNo: 11, content: 'const x = 2' }] }] }
const Y = { path: 'src/y.ts', additions: 3, deletions: 0, mtime: 6, hunks: [{ header: '@@ -0,0 +1,3 @@', lines: [{ type: 'added' as const, oldLineNo: null, newLineNo: 1, content: 'export {}' }] }] }
const README = { path: 'README.md', additions: 1, deletions: 0, mtime: 7, hunks: [{ header: '@@ -1,1 +1,2 @@', lines: [{ type: 'added' as const, oldLineNo: null, newLineNo: 2, content: 'More.' }] }] }
const DIFFS: Record<string, ThreadPlaceDiff> = {
  'pl-tree': { place: TREE, groups: { task: diff([X, Y]) } },
  'pl-co': { place: OTHER, groups: { task: diff([README]) } }
}

function changes(main: FakeMain = {}, places: ThreadPlace[] = [TREE, OTHER], capped = false) {
  const onSend = vi.fn()
  const bridge = preloadOxe({
    'thread.places': () => ({ places, capped, refused: 0 }),
    'thread.placeDiff': (_thread: unknown, placeId: unknown) => DIFFS[placeId as string] ?? { place: places.find(place => place.id === placeId), groups: { task: diff([]) } },
    'thread.collisions': () => [],
    ...main
  })
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  render(<ThreadChangesPanel snapshot={snapshot} workspace={workspace} panel="changes" onClose={() => undefined} onSendToConversation={onSend} />)
  return { bridge, onSend }
}
const section = async (name: string): Promise<HTMLElement> => (await screen.findByRole('heading', { level: 3, name })).closest('section') as HTMLElement
/** A button, radio or tab a person can press, by its visible text or accessible label. */
const control = (name: string): HTMLElement => ([...document.querySelectorAll<HTMLElement>('button, [role="radio"], [role="tab"]')]
  .find(el => el.textContent?.trim() === name || el.getAttribute('aria-label') === name)) ?? (() => { throw new Error(`no control named ${name}`) })()
const never = () => new Promise(() => undefined)

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('CR-F4-D1 to D8 · DESIGN\'s pass on the F4 place UI, the Pull request tab and the Worktrees panel', () => {
  test('CR-F4-D1 · Changes by place keeps All changes · By turn, the +/− count, Ask for a review, Finish the worktree… and per hunk Comment and Open in editor', async () => {
    changes()
    const tree = await section('Task worktree')
    expect(await within(tree).findByText('const x = 2')).toBeInTheDocument()
    for (const name of ['All changes', 'By turn', 'Ask for a review', 'Finish the worktree…']) expect(control(name)).toBeInTheDocument()
    await waitFor(() => expect(document.body.textContent).toMatch(/3 files[\s\S]*\+16[\s\S]*[−-]4/))
    expect(screen.getAllByRole('button', { name: 'Comment' })).toHaveLength(3)
    for (const line of [10, 1]) expect(within(tree).getByRole('button', { name: `Open in editor at line ${line}` })).toBeInTheDocument()
    expect(within(await section('Another checkout')).getByRole('button', { name: 'Open in editor at line 1' })).toBeInTheDocument()
  }, 30_000)

  test('CR-F4-D2 · a place header shows the branch in mono and the path in mono, cut in the middle with the full path as its tooltip; files are mono; Discard… and Remove… end with an ellipsis', async () => {
    changes()
    const tree = await section('Task worktree')
    expect(within(tree).getByText('agent/fix-login', { selector: 'code' })).toBeInTheDocument()
    const path = [...tree.querySelectorAll('[title]')].find(el => el.getAttribute('title') === LONG) as HTMLElement
    expect(path).toBeTruthy()
    expect(path.tagName).toBe('CODE')
    const shown = path.textContent ?? ''
    expect(shown).toContain('…')
    expect(shown.length).toBeLessThan(LONG.length)
    expect(shown.startsWith('/repo-trees')).toBe(true)
    expect(shown.endsWith('/agent-fix')).toBe(true)
    expect(await within(tree).findByText('src/x.ts', { selector: 'code' })).toBeInTheDocument()
    const discard = within(tree).getByRole('button', { name: 'Discard…' })
    await userEvent.click(discard)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())

    cleanup()
    preloadOxe({ 'worktreesPanel.list': () => [{ path: '/repo-trees/a', branch: 'feat/a', conversation: null, merged: { by: 'provider', value: true }, prNumber: null, changed: 0, diskBytes: 1_000_000, lastActivity: null, branchChanged: false }] })
    const { WorktreesPanel } = await load<{ WorktreesPanel: (props: { rootPath: string }) => JSX.Element }>('src/components/Worktree/WorktreesPanel')
    render(<WorktreesPanel rootPath="/repo" />)
    expect(await screen.findByText('Remove…')).toBeInTheDocument()
  }, 30_000)

  test('CR-F4-D3 · loading shows skeleton rows under the real place headers, and a skeleton in the Pull request tab, not a line of text', async () => {
    changes({ 'thread.placeDiff': never })
    const tree = await section('Task worktree')
    expect(tree.querySelector('[data-skeleton]')).not.toBeNull()
    expect(screen.queryByText(/Reading changes/)).toBeNull()

    cleanup()
    changes({ 'thread.places': never })
    await waitFor(() => expect(document.querySelector('[data-skeleton]')).not.toBeNull())
    expect(screen.queryByText(/Reading changes/)).toBeNull()

    cleanup()
    preloadOxe({ 'pullRequest.state': never, 'thread.agentSummary': never })
    const { PullRequestTab } = await load<{ PullRequestTab: (props: { threadId: string; rootPath: string; branch: string }) => JSX.Element }>('src/components/Threads/PullRequestTab')
    render(<PullRequestTab threadId="thread" rootPath="/repo" branch="feat/thread" />)
    await waitFor(() => expect(document.querySelector('[data-skeleton]')).not.toBeNull())
    expect(screen.queryByText('Loading…')).toBeNull()
  }, 30_000)

  test('CR-F4-D4 · the summary says "in N places" only with more than one, and the capped line comes after the last place', async () => {
    changes({}, [TREE])
    await section('Task worktree')
    await waitFor(() => expect(document.body.textContent).toMatch(/2 files/))
    expect(document.body.textContent).not.toMatch(/in 1 place/i)

    cleanup()
    changes({}, [TREE, OTHER], true)
    const last = await section('Another checkout')
    await waitFor(() => expect(document.body.textContent).toMatch(/in 2 places/))
    const cap = screen.getByText('Tracking the first 32 places of this conversation.')
    expect(last.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(last.contains(cap)).toBe(false)
  }, 30_000)

  test('CR-F4-D5 · the branch drift card is in warning tone', async () => {
    changes({}, [{ ...TREE, drift: DRIFT }])
    const title = await screen.findByText('This worktree is on another branch now.')
    expect(title.closest('[data-intent="warning"], [data-tone="warning"]')).not.toBeNull()
  }, 30_000)

  test("CR-F4-D6 · the collision chip shows the file in mono with its path as the tooltip, in warning tone, and the file's row in Changes carries the mark", async () => {
    const collisions = () => [{ file: 'src/x.ts', checkoutId: 'co-1', others: [{ conversationId: 'other', title: 'Login refactor' }] }]
    preloadOxe({ 'thread.collisions': collisions })
    const { CollisionChips } = await load<{ CollisionChips: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/CollisionChips')
    render(<CollisionChips threadId="thread" />)
    const chip = await screen.findByRole('button', { name: /Also edited by Login refactor/ })
    expect(chip).toHaveAttribute('title', 'src/x.ts')
    expect(within(chip).getByText('src/x.ts', { selector: 'code' })).toBeInTheDocument()
    expect(chip.closest('[data-intent="warning"], [data-tone="warning"]')).not.toBeNull()

    cleanup()
    changes({ 'thread.collisions': collisions })
    const tree = await section('Task worktree')
    const row = (await within(tree).findByText('src/x.ts', { selector: 'code' })).closest('li') as HTMLElement
    await waitFor(() => expect(row.textContent).toMatch(/Also edited by Login refactor/))
    const other = within(tree).getByText('src/y.ts', { selector: 'code' }).closest('li') as HTMLElement
    expect(other.textContent).not.toMatch(/Also edited by/)
  }, 30_000)

  test('CR-F4-D7 · the Pull request tab opens one from a form, offers Address review comments, keeps Merge as the disabled primary with its tooltip, and names the provider in a chip', async () => {
    const { PullRequestTab } = await load<{ PullRequestTab: (props: { threadId: string; rootPath: string; branch: string }) => JSX.Element }>('src/components/Threads/PullRequestTab')
    const tab = () => render(<PullRequestTab threadId="thread" rootPath="/repo" branch="feat/thread" />)
    preloadOxe({ 'pullRequest.state': () => ({ provider: 'github', cli: 'ok', pr: null }) })
    tab()
    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument()
    const from = screen.getByRole('textbox', { name: 'From' })
    expect(from).toHaveValue('feat/thread')
    expect(from).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Into' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Open as a draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push and open pull request' })).toBeInTheDocument()

    const pr = { number: 321, title: 'Fix the login', state: 'open', draft: false, head: 'feat/thread', base: 'main', url: 'https://example.test/pr/321', workItems: [], checks: [], reviewers: [] }
    for (const [provider, merge, tooltip] of [['github', 'Merge', 'Merging happens on GitHub after review'], ['azure', 'Complete', 'Complete happens in Azure DevOps once the policies pass']] as const) {
      cleanup()
      preloadOxe({ 'pullRequest.state': () => ({ provider, cli: 'ok', pr }) })
      tab()
      const button = await screen.findByRole('button', { name: merge })
      expect(button).toBeDisabled()
      expect(button.className).toMatch(/primary/)
      expect(button.closest('[title]')).toHaveAttribute('title', tooltip)
      expect(screen.getByRole('button', { name: 'Address review comments' })).toBeInTheDocument()
      expect(screen.getByText(provider === 'github' ? 'GitHub' : 'Azure DevOps').className).toMatch(/badge/i)
    }

    cleanup()
    preloadOxe({ 'pullRequest.state': () => ({ provider: 'github', cli: 'signed-out', pr: null }) })
    tab()
    expect(await screen.findByText('gh auth login', { selector: 'code' })).toBeInTheDocument()
  }, 30_000)

  test('CR-F4-D8 · pt-BR says "a worktree", Mergeada and alterações (never mudanças), and en words a single uncommitted change in the singular', async () => {
    const row = (over: Record<string, unknown>) => ({ path: '/repo-trees/a', branch: 'feat/a', conversation: null, merged: { by: 'provider', value: false }, prNumber: null, changed: 0, diskBytes: 1_000_000, lastActivity: null, branchChanged: false, ...over })
    const rows = [
      row({ path: '/repo-trees/a', branch: 'feat/a', merged: { by: 'provider', value: true } }),
      row({ path: '/repo-trees/b', branch: 'feat/b', merged: { by: 'git', value: true } }),
      row({ path: '/repo-trees/c', branch: 'feat/c', prNumber: 12, branchChanged: true }),
      row({ path: '/repo-trees/d', branch: 'feat/d', changed: 3 })
    ]
    const remove = vi.fn(async () => ({ ok: false, refusal: { code: 'worktree.remove.dirty', params: { count: 1 } } }))
    const { WorktreesPanel } = await load<{ WorktreesPanel: (props: { rootPath: string }) => JSX.Element }>('src/components/Worktree/WorktreesPanel')

    await changeLanguage('pt-BR')
    preloadOxe({ 'worktreesPanel.list': () => rows, 'worktreesPanel.remove': remove })
    render(<WorktreesPanel rootPath="/repo" />)
    expect(await screen.findByText('Mergeada')).toBeInTheDocument()
    for (const text of ['Mergeada (pelo git; pode não ver squash)', 'PR #12 aberto', '3 alteradas', 'Branch mudou desde então', 'Faça commit ou descarte as alterações primeiro.']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    const unmerged = screen.getByText('feat/c').closest('tr') as HTMLElement
    await userEvent.click(within(unmerged).getByRole('button', { name: /feat\/c/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remover a worktree em /repo-trees/c?')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Apagar também a branch feat/c' }))
    expect(within(dialog).getByText('Não mergeada: os commits ficam só nesta branch.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bo worktree\b|\bos worktrees\b|\bdo worktree\b|\bum worktree\b|worktree removido|mesclad/i)

    cleanup()
    changes({}, [])
    expect(await screen.findByText('Nenhuma alteração. Arquivos que o agente escreve aparecem aqui, pelo lugar onde escreveu.')).toBeInTheDocument()
    cleanup()
    changes({}, [{ ...TREE, drift: DRIFT }])
    expect(await screen.findByText('Faça commit ou mova as alterações primeiro.')).toBeInTheDocument()
    await userEvent.click(within(await section('Worktree da tarefa')).getByRole('button', { name: 'Descartar…' }))
    await screen.findByRole('dialog')
    expect(document.body.textContent).not.toMatch(/mudanç|mudad[oa] pela/i)

    cleanup()
    await changeLanguage('en')
    preloadOxe({ 'worktreesPanel.list': () => [row({ path: '/repo-trees/e', branch: 'feat/e' })], 'worktreesPanel.remove': remove })
    render(<WorktreesPanel rootPath="/repo" />)
    await userEvent.click(await screen.findByRole('button', { name: /feat\/e/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Remove(?!…)/ }))
    expect(await screen.findByText(/\b1 uncommitted change\b(?!s)/)).toBeInTheDocument()
  }, 30_000)
})
