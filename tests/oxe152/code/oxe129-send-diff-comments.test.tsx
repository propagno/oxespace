// Frozen acceptance test for 1.5.2 OxeCode F4 (OXE program oxespace-152-code, phase F4, task T19, Jira OXE-129).
// Written by the planner; the executor must not edit it. It renders the real ChangesPanel (inside the real
// WorkspaceReviewPanel for the OxeCode path) over the real preload (tests/acceptance/f4/crf4-8-preload.ts, read only),
// and the real line comments of the Monaco diff (attachLineComments) over a small fake editor.
// Contract (BRD-03 / OXE-63 for the control: src/ui Button, variant primary, size sm or md = 24 or 28 px, 12 or 13 px
// type, both themes and both densities, the same tokens as every primary Button):
// - CA-1: with N >= 1 pending line comments in the workspace, the Changes panel shows the primary Button
//   "Enviar N comentários ao agente" (en: "Send N comments to the agent"); N counts the pending comments of this
//   workspace only (a comment already sent is not pending). With N = 0 the button is not there. It is the src/ui
//   Button (data-ui="button", data-variant="primary"), not a raw <button>.
// - CA-2 (guard, holds today): Ctrl+Enter in the comment box saves the comment and sends nothing.
// - CA-3 (OxeCode): the send pastes formatDiffComments(<the pending comments>) into the workspace's agent terminal as
//   one bracketed paste, with no Enter (shared/types/diff-comments.ts, src/lib/sendToAgent.ts). F4 covers OxeCode's
//   ChangesPanel only (coordination 14/11); the conversation side is OXE-150 (1.5.3).
// - CA-4 (guard, holds today): for 3 comments in 2 files the text carries, for each, the file, the side (old/new), the
//   line number and the line's content.
// - CA-5: a send that worked marks each sent comment `sentAt` (ms) in src/store/diff-comments.store.ts, keeps it (it is
//   not cleared), and takes it out of the count; a send that failed leaves every comment pending, and the panel says so
//   in a role="status" notice whose text comes from both catalogs (en and pt-BR, never a raw key) and which carries the
//   action "Tentar de novo" (en: "Try again", a src/ui Button): pressing it sends the pending comments again
//   (coordination 14/11).
// - CA-6: `sentAt` is persisted with the comments (the store's persist key, oxe-diff-comments-v1), so it survives a
//   restart. In the diff, a sent comment's card says "Enviado" (en: "Sent") with the time (HH:MM), and it stays while its
//   line still reads as it did when the comment was made (lineContent); once that line changes it is no longer shown.
//   A pending comment is shown as today, changed line or not.
// - CA-7 (perf budget) is the CI perf-gate and the bundle report, not this file.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { useDiffCommentsStore } from '../../../src/store/diff-comments.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { formatDiffComments, type DiffComment } from '../../../shared/types/diff-comments'
import { attachLineComments } from '../../../src/components/Changes/diffLineComments'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

const NOW = Date.UTC(2026, 10, 14, 15, 30)
const comment = (id: string, over: Partial<DiffComment> & { sentAt?: number }): DiffComment => ({
  id, workspaceId: 'ws-1', filePath: 'src/a.ts', side: 'new', lineNo: 1, lineContent: 'const a = 1', body: `note ${id}`, createdAt: NOW, ...over
}) as DiffComment
const PENDING = [
  comment('c1', { filePath: 'src/a.ts', side: 'new', lineNo: 3, lineContent: 'const a = 1', body: 'rename this' }),
  comment('c2', { filePath: 'src/a.ts', side: 'old', lineNo: 9, lineContent: 'return x', body: 'why removed?' }),
  comment('c3', { filePath: 'src/b.ts', side: 'new', lineNo: 4, lineContent: 'export const b = 2', body: 'add a test' })
]
const SENT = comment('c0', { lineNo: 1, body: 'already sent', sentAt: NOW - 60_000 } as Partial<DiffComment>)
const OTHER = comment('x1', { workspaceId: 'ws-2', body: 'other workspace' })

const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: null, rootPath: null, createdAt: null } as unknown as WorkspacePane
const workspace = (panes: WorkspacePane[]): Workspace => ({ id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes } as unknown as Workspace)
const SCOPE = { rootPath: '/repo', isWorktree: false, folderName: 'repo', paneId: null }

function main() {
  return preloadOxe({
    'git.getBranch': () => ({ branch: 'main', shortSha: null }),
    'git.getDiffSummary': () => ({ files: [], additions: 0, deletions: 0, compiledAt: NOW }),
    'github.listBranches': () => [],
    'github.listWorktrees': () => [],
    'github.resolveWorktreeBase': () => ({ baseRef: 'main' }),
    'terminal.write': () => undefined,
    'terminal.start': () => undefined
  })
}

async function renderCode(panes: WorkspacePane[] = [pane]) {
  const ipc = main()
  useWorkspaceStore.setState({ workspaces: [workspace(panes)], activeWorkspaceId: 'ws-1', shellProfiles: [] })
  const { WorkspaceReviewPanel } = await import('../../../src/components/Workspace/WorkspaceReviewPanel')
  render(<WorkspaceReviewPanel workspace={workspace(panes)} scope={SCOPE as never} isExpanded={false} onCollapse={() => undefined} onToggleExpanded={() => undefined} />)
  await screen.findByTestId('changes-panel', undefined, { timeout: 10_000 })
  return ipc
}

const sendButton = (name: RegExp | string) => screen.findByRole('button', { name }, { timeout: 10_000 })

/** A fake Monaco diff: enough of the editor API for attachLineComments, with its overlay widgets in the document. */
function fakeDiff(lines: Record<'old' | 'new', string[]>) {
  const handlers: Record<string, Array<(event: unknown) => void>> = {}
  const editor = (side: 'old' | 'new') => ({
    side,
    changeViewZones: (callback: (accessor: { addZone(zone: unknown): string; removeZone(id: string): void }) => void) => callback({ addZone: () => `${side}-${Math.random()}`, removeZone: () => undefined }),
    addOverlayWidget: (widget: { getDomNode(): HTMLElement }) => { widget.getDomNode().dataset.side = side; document.body.append(widget.getDomNode()) },
    removeOverlayWidget: (widget: { getDomNode(): HTMLElement }) => widget.getDomNode().remove(),
    getLayoutInfo: () => ({ contentWidth: 800, contentLeft: 40 }),
    getModel: () => ({ getLineContent: (line: number) => lines[side][line - 1] ?? '' }),
    updateOptions: () => undefined,
    createDecorationsCollection: () => ({ set: () => undefined, clear: () => undefined }),
    onMouseMove: () => ({ dispose: () => undefined }),
    onMouseLeave: () => ({ dispose: () => undefined }),
    onMouseDown: (handler: (event: unknown) => void) => { (handlers[side] ??= []).push(handler); return { dispose: () => undefined } }
  })
  const original = editor('old')
  const modified = editor('new')
  const monaco = { Range: class { constructor(...args: number[]) { Object.assign(this, { args }) } }, editor: { MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 } } }
  const clickGlyph = (side: 'old' | 'new', lineNumber: number) => { for (const handler of handlers[side] ?? []) handler({ target: { type: 2, position: { lineNumber } } }) }
  return { diff: { getOriginalEditor: () => original, getModifiedEditor: () => modified } as never, monaco: monaco as never, clickGlyph }
}

beforeEach(async () => {
  await changeLanguage('pt-BR')
  localStorage.clear()
  useDiffCommentsStore.setState({ comments: [SENT, ...PENDING, OTHER] })
  useTerminalStore.setState({ panes: { p1: { ...useTerminalStore.getState().getStatus('p1'), status: 'running' } }, activePaneId: 'p1' })
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('OXE-129 · send the diff line comments to the agent', () => {
  test('CA-1 · botão com a contagem: the primary Button says "Enviar N comentários ao agente", N the pending comments; none pending, no button', async () => {
    await renderCode()
    const button = await sendButton('Enviar 3 comentários ao agente')
    expect(button).toHaveAttribute('data-ui', 'button')
    expect(button).toHaveAttribute('data-variant', 'primary')
    expect(['sm', 'md']).toContain(button.getAttribute('data-size'))
    cleanup()
    await changeLanguage('en')
    await renderCode()
    expect(await sendButton(/^Send 3 comments to the agent$/i)).toHaveAttribute('data-variant', 'primary')
    cleanup()
    useDiffCommentsStore.setState({ comments: [SENT, OTHER] })
    await renderCode()
    await waitFor(() => expect(screen.getByTestId('changes-panel')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /comments? to the agent/i })).toBeNull()
  }, 40_000)

  test('CA-2 · Ctrl+Enter só salva: Ctrl+Enter in the comment box saves it and sends nothing (guard, holds today)', async () => {
    const add = vi.fn()
    const { diff, monaco, clickGlyph } = fakeDiff({ old: ['a'], new: ['const a = 1', 'const b = 2'] })
    attachLineComments(diff, monaco, { comments: () => [], add, remove: () => undefined })
    act(() => clickGlyph('new', 2))
    const box = screen.getByRole('textbox', { name: 'Comentário da linha 2' })
    fireEvent.change(box, { target: { value: 'tighten this' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('new', 2, 'const b = 2', 'tighten this')
  })

  test('CA-3 · destino por superfície: in OxeCode the comments are pasted into the agent terminal as one bracketed paste, with no Enter', async () => {
    const ipc = await renderCode()
    fireEvent.click(await sendButton('Enviar 3 comentários ao agente'))
    await waitFor(() => expect(ipc.invoked.some(([key]) => key === 'terminal.write')).toBe(true))
    const writes = ipc.invoked.filter(([key]) => key === 'terminal.write').map(([, args]) => args[0] as { paneId: string; data: string })
    expect(writes).toEqual([{ paneId: 'p1', data: `\u001b[200~${formatDiffComments(PENDING)}\u001b[201~` }])
    expect(writes.some(write => /[\r\n]$/.test(write.data))).toBe(false)
  }, 20_000)

  test('CA-4 · texto de 3 comentários em 2 arquivos: each carries the file, the side, the line number and the line (guard, holds today)', () => {
    const text = formatDiffComments(PENDING)
    expect(text).toContain('(3)')
    expect(text).toContain('File: src/a.ts\nLine: 3 (new side)\nCode: const a = 1\nUser comment: rename this')
    expect(text).toContain('File: src/a.ts\nLine: 9 (old side)\nCode: return x\nUser comment: why removed?')
    expect(text).toContain('File: src/b.ts\nLine: 4 (new side)\nCode: export const b = 2\nUser comment: add a test')
  })

  test('CA-5 · enviado e erro: a send that worked marks the comments sent and takes them out of the count; one that failed keeps them all pending and offers Tentar de novo', async () => {
    const before = Date.now()
    await renderCode()
    fireEvent.click(await sendButton('Enviar 3 comentários ao agente'))
    await waitFor(() => expect(useDiffCommentsStore.getState().comments.filter(item => ((item as { sentAt?: number }).sentAt ?? 0) >= before).map(item => item.id).sort()).toEqual(['c1', 'c2', 'c3']))
    expect(useDiffCommentsStore.getState().comments.map(item => item.id).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'x1'])
    await waitFor(() => expect(screen.queryByRole('button', { name: /Enviar \d+ comentários? ao agente/ })).toBeNull())
    cleanup()

    useDiffCommentsStore.setState({ comments: [SENT, ...PENDING, OTHER] })
    await renderCode([])
    fireEvent.click(await sendButton('Enviar 3 comentários ao agente'))
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' }, { timeout: 10_000 })
    const notice = retry.closest('[role="status"]') as HTMLElement
    expect(notice, 'the "Tentar de novo" action sits in the role="status" failure notice').not.toBeNull()
    expect(retry).toHaveAttribute('data-ui', 'button')
    expect(notice.textContent?.replace('Tentar de novo', '').trim()).not.toBe('')
    expect(notice.textContent).not.toMatch(/changes\.comments\.|agentPaste\./)
    const textPt = notice.textContent
    expect(useDiffCommentsStore.getState().comments.filter(item => (item as { sentAt?: number }).sentAt !== undefined).map(item => item.id)).toEqual(['c0'])
    expect(await sendButton('Enviar 3 comentários ao agente')).toBeInTheDocument()
    // The agent's terminal is back: "Tentar de novo" sends the pending comments again.
    useWorkspaceStore.setState({ workspaces: [workspace([pane])] })
    fireEvent.click(retry)
    await waitFor(() => expect(useDiffCommentsStore.getState().comments.filter(item => (item as { sentAt?: number }).sentAt !== undefined).map(item => item.id).sort()).toEqual(['c0', 'c1', 'c2', 'c3']))
    cleanup()

    await changeLanguage('en')
    useDiffCommentsStore.setState({ comments: [SENT, ...PENDING, OTHER] })
    await renderCode([])
    fireEvent.click(await sendButton(/^Send 3 comments to the agent$/i))
    const retryEn = await screen.findByRole('button', { name: 'Try again' }, { timeout: 10_000 })
    const noticeEn = retryEn.closest('[role="status"]') as HTMLElement
    expect(noticeEn).not.toBeNull()
    expect(noticeEn.textContent?.replace('Try again', '').trim()).not.toBe('')
    expect(noticeEn.textContent).not.toMatch(/changes\.comments\.|agentPaste\./)
    expect(noticeEn.textContent).not.toBe(textPt)
  }, 40_000)

  test('CA-6 · Enviado persiste até a linha mudar: sentAt survives a restart, and the sent card shows "Enviado" and the time until its line changes', async () => {
    await renderCode()
    fireEvent.click(await sendButton('Enviar 3 comentários ao agente'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('oxe-diff-comments-v1') ?? '{}')?.state?.comments?.filter((item: { sentAt?: number }) => typeof item.sentAt === 'number').length).toBe(4))
    cleanup()

    const lines = { old: ['x'], new: ['const a = 1', 'still here', 'const a = 1'] }
    const { diff, monaco } = fakeDiff(lines)
    const sent = { ...comment('s1', { lineNo: 1, lineContent: 'const a = 1', body: 'sent note' }), sentAt: NOW } as DiffComment
    const pending = comment('s2', { lineNo: 3, lineContent: 'const a = 1', body: 'pending note' })
    let comments: DiffComment[] = [sent, pending]
    const view = attachLineComments(diff, monaco, { comments: () => comments, add: () => undefined, remove: () => undefined })
    const card = (body: string) => [...document.querySelectorAll<HTMLElement>('[data-side]')].find(node => node.textContent?.includes(body)) ?? null
    expect(card('sent note')?.textContent).toMatch(/Enviado.*\d{1,2}:\d{2}/)
    expect(card('pending note')?.textContent).not.toMatch(/Enviado/)
    await changeLanguage('en')
    act(() => view.sync())
    expect(card('sent note')?.textContent).toMatch(/Sent.*\d{1,2}:\d{2}/)

    lines.new[0] = 'const a = 2'
    lines.new[2] = 'const a = 3'
    comments = [...comments]
    act(() => view.sync())
    expect(card('sent note'), 'a sent comment whose line changed is no longer shown').toBeNull()
    expect(within(card('pending note')!).getByText('pending note')).toBeInTheDocument()
    view.dispose()
  }, 40_000)
})
