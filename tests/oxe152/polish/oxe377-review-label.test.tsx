import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentRow } from '../../../shared/types/agents'
import type { ThreadPendingRequestSummary, ThreadRequest } from '../../../shared/types/thread'
import { ApprovalToast } from '../../../src/components/Approvals/ApprovalToast'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { NeedsYouQueue } from '../../../src/components/Navigation/NeedsYouQueue'
import { ThreadRequestCard } from '../../../src/components/Threads/ThreadRequestCard'
import { ThreadRowAttention } from '../../../src/components/Threads/ThreadRowAttention'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

const IRREVERSIBLE_IMPACT = {
  why: 'Publishes the package.',
  where: 'shop',
  affects: { count: 1, unit: 'resources' as const },
  reversible: false,
  risk: 'critical' as const,
  kind: 'push' as const,
  text: 'npm publish',
  lang: 'shell' as const
}

const approvalRequest = (): ThreadRequest => ({
  id: 'req-1',
  nativeId: 'n-1',
  nativeMethod: 'can_use_tool:Bash',
  kind: 'approval',
  title: 'Run npm publish',
  toolName: 'Bash',
  command: 'npm publish',
  generation: 1,
  createdAt: 1,
  state: 'pending',
  availableDecisions: ['accept', 'decline'],
  impact: IRREVERSIBLE_IMPACT
}) as unknown as ThreadRequest

const queueRow = (kind: 'approval' | 'question', risk: 'low' | 'critical' | null, reversible: boolean | null, requestId = 'req-1'): AgentRow => ({
  kind: 'thread',
  id: 'thread-1',
  state: 'needs-you',
  provider: 'claude',
  mode: 'thread',
  title: 'Release',
  workspaceId: 'ws-1',
  since: 1,
  seenAt: null,
  session: null,
  worktree: null,
  cost: null,
  requests: [{
    requestId,
    kind,
    title: { code: `agents.request.${kind}`, params: {} },
    risk,
    reversible,
    answerable: true,
    since: 1,
    ...(kind === 'approval' ? { command: { text: 'npm publish', untrusted: true } } : {})
  }]
}) as unknown as AgentRow

afterEach(async () => {
  cleanup()
  act(() => { useOpenRequest.getState().close() })
  await changeLanguage('en')
  vi.restoreAllMocks()
})

describe('OXE-377 · Clarify See impact action in NeedsYouQueue and approval surfaces', () => {
  test.each([
    ['en', 'See impact', 'Review impact to approve or deny', 'Review impact to approve or deny'],
    ['pt-BR', 'Ver impacto', 'Revisar impacto para aprovar ou negar', 'Revise o impacto para aprovar ou negar']
  ] as const)('(%s) NeedsYouQueue shows the review-to-approve hint and tooltip alongside See impact', async (locale, buttonName, tooltip, subLabel) => {
    await changeLanguage(locale)
    useWorkspaceStore.setState({ workspaces: [] } as never)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond: vi.fn() } } })
    const anchor = createRef<HTMLElement>()
    const onClose = vi.fn()

    render(<><span ref={anchor as never} /><NeedsYouQueue agents={[queueRow('approval', 'critical', false)]} anchor={anchor} onClose={onClose} /></>)

    const hint = document.querySelector<HTMLElement>('[data-ui="needs-you-review-hint"]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent?.trim()).toBe(subLabel)

    const button = screen.getByRole('button', { name: buttonName })
    expect(button).toHaveAttribute('title', tooltip)

    await userEvent.click(button)
    expect(useOpenRequest.getState().requestId).toBe('req-1')
    expect(onClose).toHaveBeenCalledWith(false)
  })

  test('NeedsYouQueue does not show the review hint on low-risk decidable approvals or questions', () => {
    useWorkspaceStore.setState({ workspaces: [] } as never)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond: vi.fn() } } })
    const anchor = createRef<HTMLElement>()

    render(<><span ref={anchor as never} /><NeedsYouQueue agents={[queueRow('approval', 'low', true, 'req-low'), queueRow('question', null, null, 'req-q')]} anchor={anchor} onClose={vi.fn()} /></>)

    expect(document.querySelector('[data-ui="needs-you-review-hint"]')).toBeNull()
  })

  test.each(['en', 'pt-BR'] as const)('(%s) ApprovalToast, ThreadRequestCard, and ThreadRowAttention expose the clarifying tooltip on See impact', async locale => {
    await changeLanguage(locale)
    const seeImpactLabel = tt('f7.card.seeImpact')
    const seeImpactHint = tt('f7.card.seeImpactHint')

    render(
      <ApprovalToast
        request={approvalRequest()}
        agent="Claude"
        onRespond={vi.fn(async () => undefined)}
        onSeeImpact={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: seeImpactLabel })).toHaveAttribute('title', seeImpactHint)
    cleanup()

    render(
      <ThreadRequestCard
        request={approvalRequest()}
        agent="Claude"
        disabled={false}
        onRespond={vi.fn(async () => undefined)}
        conversationId="thread-1"
      />
    )
    expect(screen.getByRole('button', { name: seeImpactLabel })).toHaveAttribute('title', seeImpactHint)
    cleanup()

    const criticalSummary: ThreadPendingRequestSummary = {
      threadId: 'thread-1',
      requestId: 'req-1',
      generation: 1,
      kind: 'approval',
      title: 'Run npm publish',
      command: 'npm publish',
      policy: { decision: 'ask', level: 'red', risk: 'high', reasons: ['destructive'], guarded: false },
      impact: IRREVERSIBLE_IMPACT
    } as unknown as ThreadPendingRequestSummary
    render(<ThreadRowAttention request={criticalSummary} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: seeImpactLabel })).toHaveAttribute('title', seeImpactHint)
    cleanup()

    const questionSummary: ThreadPendingRequestSummary = {
      threadId: 'thread-1',
      requestId: 'q-1',
      generation: 1,
      kind: 'question',
      title: 'Which branch?'
    } as unknown as ThreadPendingRequestSummary
    render(<ThreadRowAttention request={questionSummary} onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: tt('request.answer') })).not.toHaveAttribute('title')
  })
})
