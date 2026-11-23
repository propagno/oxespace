import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { formatDiffComments } from '../../../shared/types/diff-comments'
import type { GitDiffLine } from '../../../shared/types/git'
import { useDiffCommentsStore } from '../../../src/store/diff-comments.store'
import { PlacesChanges, threadCommentScope } from '../../../src/components/Threads/PlacesChanges'

type PlaceChangedListener = (event: { threadId: string }) => void

const PLACE = {
  id: 'pl-tree',
  kind: 'worktree',
  path: '/repo-trees/oxe-150',
  base: { commit: '9bb5339abc', branch: 'feat/oxe-150', turnId: 'turn-1' },
  current: { branch: 'feat/oxe-150', commit: 'def456' },
  writes: 1,
  files: [],
  drift: null
}

function makeDiff(lines: GitDiffLine[]) {
  return {
    place: PLACE,
    groups: {
      task: {
        files: [
          {
            path: 'src/app.ts',
            additions: lines.filter((line) => line.type === 'added').length,
            deletions: lines.filter((line) => line.type === 'removed').length,
            mtime: 1,
            hunks: [
              {
                header: '@@ -1,2 +1,2 @@',
                lines
              }
            ]
          }
        ],
        base: '9bb5339',
        includeUncommitted: true,
        compiledAt: 1
      }
    }
  }
}

function mockPlacesBridge(initialLines: GitDiffLine[]) {
  let currentLines = initialLines
  const listeners: PlaceChangedListener[] = []
  const thread = {
    places: vi.fn(async () => ({ places: [PLACE], capped: false })),
    placeDiff: vi.fn(async () => makeDiff(currentLines)),
    onPlacesChanged: vi.fn((listener: PlaceChangedListener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    })
  }
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      thread
    }
  })
  return {
    thread,
    updateLines(next: GitDiffLine[]) {
      currentLines = next
      for (const listener of listeners) listener({ threadId: 'thread-1' })
    }
  }
}

const INITIAL_LINES: GitDiffLine[] = [
  { type: 'removed', content: 'const oldVal = 0', oldLineNo: 1, newLineNo: null },
  { type: 'added', content: 'const nextVal = 1', oldLineNo: null, newLineNo: 1 },
  { type: 'added', content: 'export const ready = true', oldLineNo: null, newLineNo: 2 }
]

async function addLineComment(lineNo: number, side: 'old' | 'new', body: string, viaCtrlEnter = false): Promise<void> {
  const buttons = screen.getAllByTestId('places-line-comment-btn')
  const target = buttons.find((el) => el.getAttribute('data-line-no') === String(lineNo) && el.getAttribute('data-side') === side)
  if (!target) throw new Error(`Comment trigger not found for ${side}:${lineNo}`)
  fireEvent.click(target)
  const composer = screen.getByTestId('places-line-composer')
  const textbox = within(composer).getByRole('textbox')
  fireEvent.change(textbox, { target: { value: body } })
  if (viaCtrlEnter) {
    fireEvent.keyDown(textbox, { key: 'Enter', ctrlKey: true })
  } else {
    const saveButton = within(composer).getAllByRole('button').find((el) => el.getAttribute('data-variant') === 'primary')
    if (!saveButton) throw new Error('Primary save button not found in line composer')
    fireEvent.click(saveButton)
  }
}

beforeEach(async () => {
  await changeLanguage('pt-BR')
  localStorage.clear()
  useDiffCommentsStore.setState({ comments: [] })
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
})

describe('OXE-150 · PlacesChanges diff line comments batch send', () => {
  test('sends N pending diff line comments to the active conversation in one batch and marks each Sent until line changes across themes and densities', async () => {
    const scenarios = [
      { theme: 'light', density: 'compact', lang: 'pt-BR' as const, sendRegex: /^Enviar 2 comentários ao agente$/, sentRegex: /Enviado.*\d{1,2}:\d{2}/ },
      { theme: 'dark', density: 'comfortable', lang: 'en' as const, sendRegex: /^Send 2 comments to the agent$/i, sentRegex: /Sent.*\d{1,2}:\d{2}/ }
    ]

    for (const scenario of scenarios) {
      cleanup()
      localStorage.clear()
      useDiffCommentsStore.setState({ comments: [] })
      await changeLanguage(scenario.lang)
      document.documentElement.setAttribute('data-theme', scenario.theme)
      document.documentElement.setAttribute('data-density', scenario.density)

      // Seed an unrelated conversation in the same workspace to verify thread isolation (Risco 1).
      useDiffCommentsStore.getState().add({
        workspaceId: threadCommentScope('thread-other', 'ws-1'),
        filePath: 'src/app.ts',
        side: 'new',
        lineNo: 1,
        lineContent: 'const nextVal = 1',
        body: 'belongs to another thread'
      })

      const bridge = mockPlacesBridge(INITIAL_LINES)
      const onSend = vi.fn(async () => true)
      const { container } = render(<PlacesChanges threadId="thread-1" workspaceId="ws-1" onSend={onSend} />)
      await screen.findByText('src/app.ts')

      // RT-3: zero raw <button> elements inside PlacesChanges.
      expect(container.querySelectorAll('button:not([data-ui])')).toHaveLength(0)
      expect(screen.queryByText('belongs to another thread')).toBeNull()

      // Add 2 comments: first via Ctrl+Enter (saves without sending), second via button.
      await addLineComment(1, 'new', 'rename nextVal', true)
      await addLineComment(1, 'old', 'keep old fallback', false)
      expect(onSend).not.toHaveBeenCalled()

      // Send button uses src/ui Button primary sm with the pending count for this conversation only.
      const sendBtn = screen.getByRole('button', { name: scenario.sendRegex })
      expect(sendBtn).toHaveAttribute('data-ui', 'button')
      expect(sendBtn).toHaveAttribute('data-variant', 'primary')
      expect(sendBtn).toHaveAttribute('data-size', 'sm')
      expect(container.querySelectorAll('button:not([data-ui])')).toHaveLength(0)

      const pendingBefore = useDiffCommentsStore.getState().comments.filter(
        (item) => item.workspaceId === threadCommentScope('thread-1', 'ws-1') && item.sentAt == null
      )
      expect(pendingBefore).toHaveLength(2)

      fireEvent.click(sendBtn)

      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
      expect(onSend).toHaveBeenCalledWith(formatDiffComments(pendingBefore))

      // Pending send button disappears and both cards display the localized Sent badge with timestamp.
      await waitFor(() => expect(screen.queryByRole('button', { name: scenario.sendRegex })).toBeNull())
      const badges = await screen.findAllByTestId('places-comment-sent')
      expect(badges).toHaveLength(2)
      for (const badge of badges) {
        expect(badge.textContent).toMatch(scenario.sentRegex)
      }

      // Persisted sentAt survives in oxe-diff-comments-v1 without touching the other thread's comment.
      const persisted = JSON.parse(localStorage.getItem('oxe-diff-comments-v1') ?? '{}')?.state?.comments ?? []
      const sentPersisted = persisted.filter((item: { workspaceId: string; sentAt?: number }) =>
        item.workspaceId === threadCommentScope('thread-1', 'ws-1') && typeof item.sentAt === 'number'
      )
      expect(sentPersisted).toHaveLength(2)

      // When new:1 changes content in the diff, its sent comment disappears; unchanged old:1 stays visible.
      act(() => {
        bridge.updateLines([
          { type: 'removed', content: 'const oldVal = 0', oldLineNo: 1, newLineNo: null },
          { type: 'added', content: 'const renamedVal = 2', oldLineNo: null, newLineNo: 1 },
          { type: 'added', content: 'export const ready = true', oldLineNo: null, newLineNo: 2 }
        ])
      })

      await waitFor(() => expect(screen.queryByText('rename nextVal')).toBeNull())
      expect(screen.getByText('keep old fallback')).toBeInTheDocument()
      expect(screen.getAllByTestId('places-comment-sent')).toHaveLength(1)
    }
  })

  test('shows localized failure notice with Retry action and keeps all N comments unsent when onSend rejects', async () => {
    const scope = threadCommentScope('thread-1', 'ws-1')

    // 1) Portuguese (pt-BR) with rejected promise, then successful retry
    await changeLanguage('pt-BR')
    mockPlacesBridge(INITIAL_LINES)
    const onSendPt = vi.fn<(_text: string) => Promise<boolean>>().mockRejectedValueOnce(new Error('send failed')).mockResolvedValueOnce(true)
    render(<PlacesChanges threadId="thread-1" workspaceId="ws-1" onSend={onSendPt} />)
    await screen.findByText('src/app.ts')

    await addLineComment(1, 'new', 'ajustar nome')
    await addLineComment(2, 'new', 'cobrir com teste')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar 2 comentários ao agente' }))

    const retryPt = await screen.findByRole('button', { name: 'Tentar de novo' })
    const noticePt = retryPt.closest('[role="status"]') as HTMLElement
    expect(noticePt).not.toBeNull()
    expect(retryPt).toHaveAttribute('data-ui', 'button')
    expect(noticePt.textContent?.replace('Tentar de novo', '').trim()).not.toBe('')
    expect(noticePt.textContent).not.toMatch(/changes\.comments\./)
    const noticeTextPt = noticePt.textContent

    // 0 comments marked as sent; all 2 remain pending.
    const afterFail = useDiffCommentsStore.getState().comments.filter((item) => item.workspaceId === scope)
    expect(afterFail).toHaveLength(2)
    expect(afterFail.filter((item) => item.sentAt != null)).toHaveLength(0)
    expect(screen.queryAllByTestId('places-comment-sent')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Enviar 2 comentários ao agente' })).toBeInTheDocument()

    // Clicking Retry resends all 2 pending comments in one batch and marks them Sent.
    fireEvent.click(retryPt)
    await waitFor(() => expect(onSendPt).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByTestId('places-comment-sent')).toHaveLength(2))
    expect(useDiffCommentsStore.getState().comments.filter((item) => item.workspaceId === scope && item.sentAt != null)).toHaveLength(2)

    cleanup()
    localStorage.clear()
    useDiffCommentsStore.setState({ comments: [] })

    // 2) English (en) with false return value
    await changeLanguage('en')
    mockPlacesBridge(INITIAL_LINES)
    const onSendEn = vi.fn<(_text: string) => Promise<boolean>>().mockResolvedValueOnce(false)
    render(<PlacesChanges threadId="thread-1" workspaceId="ws-1" onSend={onSendEn} />)
    await screen.findByText('src/app.ts')

    await addLineComment(1, 'new', 'rename this')
    await addLineComment(2, 'new', 'add unit test')

    fireEvent.click(screen.getByRole('button', { name: /^Send 2 comments to the agent$/i }))

    const retryEn = await screen.findByRole('button', { name: 'Try again' })
    const noticeEn = retryEn.closest('[role="status"]') as HTMLElement
    expect(noticeEn).not.toBeNull()
    expect(retryEn).toHaveAttribute('data-ui', 'button')
    expect(noticeEn.textContent?.replace('Try again', '').trim()).not.toBe('')
    expect(noticeEn.textContent).not.toMatch(/changes\.comments\./)
    expect(noticeEn.textContent).not.toBe(noticeTextPt)
    expect(useDiffCommentsStore.getState().comments.filter((item) => item.workspaceId === scope && item.sentAt != null)).toHaveLength(0)
  })
})
