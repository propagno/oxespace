// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-333, HML P0 on 07d8df07c). Written by the planner; the executor
// must not edit it. The bug: a question (request.kind 'question') shows Deny/Approve in the approvals queue and Approve
// sends { decision: 'accept' } instead of answers; in the needs-you queue a question offers "See impact".
// Contract:
// - thread catalogs (en, pt-BR) gain f7.queue.answerInConversation: en "Answer in the conversation",
//   pt-BR "Responder na conversa".
// - src/components/Approvals/ApprovalQueue.tsx: for a selected item whose request.kind is 'question' the decision footer
//   shows no request.deny / request.approve / hold button and never calls onRespond; it shows one button named
//   f7.queue.answerInConversation that calls onOpenTask(item) (the conversation, where the question card is answered).
// - src/components/Navigation/NeedsYouQueue.tsx: a question row offers f7.queue.answerInConversation (not See impact);
//   it closes the popover (onClose(false)) and takes the window to the conversation with window CustomEvent
//   'oxe:open-thread' { threadId: row.id } (OXE-332's event), without opening the impact dialog.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentRow } from '../../../shared/types/agents'
import { ApprovalQueue } from '../../../src/components/Approvals/ApprovalQueue'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { NeedsYouQueue } from '../../../src/components/Navigation/NeedsYouQueue'
import { changeLanguage } from '../../../src/i18n'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const catalogs: Record<string, unknown> = {}
function cat(key: string, lang: 'en' | 'pt-BR' = 'en'): string {
  catalogs[lang] ??= JSON.parse(readFileSync(join(process.cwd(), `shared/locales/${lang}/thread.json`), 'utf8'))
  let node: unknown = catalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} thread catalog has no key ${key}`)
  return node
}

const question = () => ({
  id: 'q1', nativeId: 'n1', nativeMethod: 'item/tool/requestUserInput', kind: 'question' as const, title: 'Which branch?', generation: 1, createdAt: 1,
  state: 'pending' as const, questions: [{ id: 'branch', question: 'Which branch should I use?', options: [{ label: 'main' }, { label: 'dev' }] }]
})

const questionRow = (): AgentRow => ({
  kind: 'thread', id: 'thread-1', state: 'needs-you', provider: 'claude', mode: 'thread', title: 'Auth', workspaceId: 'ws-1',
  since: 1, seenAt: null, session: null, worktree: null, cost: null,
  requests: [{ requestId: 'q1', kind: 'question', title: { code: 'agents.request.question', params: {} }, risk: null, reversible: null, answerable: true, since: 1 }]
}) as unknown as AgentRow

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
  act(() => { useOpenRequest.getState().close() })
  vi.restoreAllMocks()
})

describe('OXE-333 · A question is answered, never approved', () => {
  test('the catalogs name the way to answer in both languages', () => {
    expect(cat('f7.queue.answerInConversation')).toBe('Answer in the conversation')
    expect(cat('f7.queue.answerInConversation', 'pt-BR')).toBe('Responder na conversa')
  })

  test('in the approvals queue a question has no Deny or Approve and opens its conversation', async () => {
    const onRespond = vi.fn(async () => undefined)
    const onOpenTask = vi.fn()
    const item = { request: question() as never, agent: 'Claude', conversation: 'Auth', threadId: 'thread-1' }
    render(<ApprovalQueue items={[item]} decided={[]} onRespond={onRespond} onOpenTask={onOpenTask} initialSelectedId="q1" />)
    expect(screen.queryByRole('button', { name: new RegExp(`^${cat('request.deny')}`) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`^${cat('request.approve')}`) })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: cat('f7.queue.answerInConversation') }))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-1' }))
    expect(onRespond).not.toHaveBeenCalled()
  })

  test('in the needs-you queue a question offers Answer in the conversation, not See impact', async () => {
    useWorkspaceStore.setState({ workspaces: [] } as never)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond: vi.fn() } } })
    const onClose = vi.fn()
    const anchor = createRef<HTMLElement>()
    const opened: string[] = []
    const listen = (event: Event): void => { opened.push((event as CustomEvent<{ threadId: string }>).detail.threadId) }
    window.addEventListener('oxe:open-thread', listen)
    try {
      render(<><span ref={anchor as never} /><NeedsYouQueue agents={[questionRow()]} anchor={anchor} onClose={onClose} /></>)
      expect(screen.queryByRole('button', { name: cat('f7.card.seeImpact') })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: cat('f7.queue.answerInConversation') }))
      expect(opened).toEqual(['thread-1'])
      expect(onClose).toHaveBeenCalledWith(false)
      expect(useOpenRequest.getState().requestId).toBeNull()
    } finally { window.removeEventListener('oxe:open-thread', listen) }
  })
})
