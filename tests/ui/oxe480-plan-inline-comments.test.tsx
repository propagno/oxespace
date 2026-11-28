import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadRequest } from '../../shared/types/thread'
import { ThreadRequestCard } from '../../src/components/Threads/ThreadRequestCard'
import {
  extractPlanText,
  formatPlanReviewFeedback,
  isPlanReviewRequest,
  parsePlanSections
} from '../../src/components/Threads/planReviewModel'
import { changeLanguage } from '../../src/i18n'

const SAMPLE_PLAN = [
  '# Migration Plan: Auth Refactor',
  '',
  'Overview paragraph describing the token storage update.',
  '',
  '## Implementation Steps',
  '',
  '1. Extract session serializer into `authSession.ts`',
  '2. Update IPC bridge validation',
  '- Keep backwards compatibility for old tokens',
  '- Add unit tests for expiry edge cases',
  '',
  '```ts',
  'export function verifyToken(raw: string): boolean {',
  '  return raw.length > 0',
  '}',
  '```'
].join('\n')

function makeImpactPlanRequest(plan = SAMPLE_PLAN, overrides: Partial<ThreadRequest> = {}): ThreadRequest {
  return {
    id: 'plan-impact-1',
    nativeId: 'native-plan-1',
    nativeMethod: 'can_use_tool:ExitPlanMode',
    kind: 'approval',
    title: 'Review the plan',
    toolName: 'ExitPlanMode',
    detail: plan,
    generation: 1,
    createdAt: 100,
    state: 'pending',
    availableDecisions: ['accept', 'decline'],
    impact: {
      where: 'oxespace',
      affects: { count: 3, unit: 'files' },
      reversible: true,
      undoHow: 'checkpoint',
      risk: 'low',
      kind: 'file',
      text: plan,
      lang: 'text'
    },
    ...overrides
  }
}

function makePlainPlanRequest(plan = SAMPLE_PLAN, overrides: Partial<ThreadRequest> = {}): ThreadRequest {
  return {
    id: 'plan-plain-1',
    nativeId: 'native-plan-2',
    nativeMethod: 'can_use_tool:ExitPlanMode',
    kind: 'approval',
    title: 'Review the plan',
    detail: plan,
    generation: 1,
    createdAt: 100,
    state: 'pending',
    availableDecisions: ['accept', 'decline'],
    ...overrides
  }
}

afterEach(async () => {
  cleanup()
  document.body.innerHTML = ''
  await changeLanguage('en')
  vi.restoreAllMocks()
})

describe('OXE-480 · planReviewModel parsing & formatting', () => {
  it('parses headings, paragraphs, numbered steps, bullets, and fenced code blocks with stable indices and line ranges', () => {
    const sections = parsePlanSections(SAMPLE_PLAN)
    expect(sections.map(section => section.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'listItem',
      'listItem',
      'listItem',
      'listItem',
      'code'
    ])
    expect(sections[0]).toMatchObject({
      index: 0,
      excerpt: 'Migration Plan: Auth Refactor',
      lineRange: { start: 1, end: 1 }
    })
    expect(sections[3]).toMatchObject({
      index: 3,
      excerpt: 'Extract session serializer into authSession.ts',
      lineRange: { start: 7, end: 7 }
    })
    expect(sections[7]).toMatchObject({
      index: 7,
      kind: 'code',
      lineRange: { start: 12, end: 16 }
    })
    expect(sections[7].excerpt).toContain('ts: export function verifyToken')
  })

  it('extracts plan text from plain markdown and legacy JSON-wrapped ExitPlanMode payloads', () => {
    const plainReq = makePlainPlanRequest('# Step 1\n\nDo work')
    expect(isPlanReviewRequest(plainReq)).toBe(true)
    expect(extractPlanText(plainReq)).toBe('# Step 1\n\nDo work')

    const jsonReq = makePlainPlanRequest(JSON.stringify({ plan: '# Wrapped plan\n\n- Check API' }))
    expect(extractPlanText(jsonReq)).toBe('# Wrapped plan\n\n- Check API')

    const bashReq: ThreadRequest = {
      id: 'b1',
      nativeId: 'b1',
      nativeMethod: 'can_use_tool:Bash',
      kind: 'approval',
      title: 'Run command',
      toolName: 'Bash',
      command: 'npm test',
      generation: 1,
      createdAt: 1,
      state: 'pending'
    }
    expect(isPlanReviewRequest(bashReq)).toBe(false)
    expect(extractPlanText(bashReq)).toBeUndefined()
  })

  it('formats inline comments sorted by section order plus optional general note', () => {
    const feedback = formatPlanReviewFeedback(
      [
        {
          id: 'c2',
          sectionIndex: 4,
          excerpt: 'Update IPC bridge validation',
          lineRange: { start: 8, end: 8 },
          comment: 'Also enforce max length 8000'
        },
        {
          id: 'c1',
          sectionIndex: 0,
          excerpt: 'Migration Plan: Auth Refactor',
          lineRange: { start: 1, end: 1 },
          comment: 'Split into two PRs'
        }
      ],
      'Please preserve existing tests'
    )
    expect(feedback).toBe([
      'Plan review feedback:',
      '1. Regarding "Migration Plan: Auth Refactor" (L1): Split into two PRs',
      '2. Regarding "Update IPC bridge validation" (L8): Also enforce max length 8000',
      '',
      'General note: Please preserve existing tests'
    ].join('\n'))
  })
})

describe('OXE-480 · ThreadPlanReview inside ThreadRequestCard', () => {
  it('renders "Review plan" as the header title and aria-label when an ExitPlanMode request carries an impact object (OXE-492)', () => {
    render(
      <ThreadRequestCard
        request={makeImpactPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480-title"
        onRespond={vi.fn(async () => undefined)}
      />
    )
    const card = screen.getByRole('region', { name: 'Review plan' })
    expect(card).toBeVisible()
    expect(card.querySelector('header strong')?.textContent).toBe('Review plan')
  })

  it('supports adding, editing, and deleting inline comments on sections without triggering 1/2 keyboard shortcuts while typing', async () => {
    const onRespond = vi.fn(async () => undefined)
    render(
      <ThreadRequestCard
        request={makeImpactPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480"
        onRespond={onRespond}
      />
    )

    const planRegion = screen.getByTestId('request-plan')
    const sections = planRegion.querySelectorAll<HTMLElement>('[data-ui="plan-section"]')
    expect(sections.length).toBe(8)
    expect(screen.queryByRole('button', { name: /Request changes/i })).toBeNull()
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')).toBeNull()

    // Open comment composer on section 3 ("1. Extract session serializer into `authSession.ts`")
    const stepOneBtn = within(sections[3]).getByRole('button', { name: /Comment on Extract session serializer/i })
    await userEvent.click(stepOneBtn)
    const input = screen.getByTestId('plan-comment-input')

    // Typing "1" and "2" inside the inline comment textarea must NEVER trigger Deny (1) or Allow (2)
    await userEvent.type(input, 'Use 12-byte nonce and keep step 1 pure')
    expect(onRespond).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')?.textContent).toBe('1 comment')
    expect(within(sections[3]).getByText('Use 12-byte nonce and keep step 1 pure')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Request changes (1)' })).toBeVisible()

    // Edit the attached comment
    await userEvent.click(within(sections[3]).getByRole('button', { name: 'Edit comment' }))
    const editor = screen.getByTestId('plan-comment-editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Use 16-byte nonce for step 12')
    expect(onRespond).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(within(sections[3]).getByText('Use 16-byte nonce for step 12')).toBeVisible()

    // Add a second comment on section 4
    await userEvent.click(within(sections[4]).getByRole('button', { name: /Comment on Update IPC bridge validation/i }))
    await userEvent.type(screen.getByTestId('plan-comment-input'), 'Reject null bytes too')
    await userEvent.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')?.textContent).toBe('2 comments')
    expect(screen.getByRole('button', { name: 'Request changes (2)' })).toBeVisible()

    // Check pt-BR localization
    await act(async () => { await changeLanguage('pt-BR') })
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')?.textContent).toBe('2 comentários')
    expect(screen.getByRole('button', { name: 'Pedir alterações (2)' })).toBeVisible()
    await act(async () => { await changeLanguage('en') })

    // Delete the second comment -> count drops cleanly back to 1
    await userEvent.click(within(sections[4]).getByRole('button', { name: 'Delete comment' }))
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')?.textContent).toBe('1 comment')
    expect(screen.getByRole('button', { name: 'Request changes (1)' })).toBeVisible()

    // Delete the remaining comment -> Request changes disappears cleanly
    await userEvent.click(within(sections[3]).getByRole('button', { name: 'Delete comment' }))
    expect(planRegion.querySelector('[data-ui="plan-comment-count"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Request changes/i })).toBeNull()
  })

  it('submits Request changes (N) with all structured section excerpts, comments, and optional general note via decline reason', async () => {
    const onRespond = vi.fn(async () => undefined)
    render(
      <ThreadRequestCard
        request={makeImpactPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480"
        onRespond={onRespond}
      />
    )

    const planRegion = screen.getByTestId('request-plan')
    const sections = planRegion.querySelectorAll<HTMLElement>('[data-ui="plan-section"]')

    // Comment on section 4 first, then section 3 -> output should be ordered by section index
    await userEvent.click(within(sections[4]).getByRole('button', { name: /Comment on Update IPC bridge validation/i }))
    await userEvent.type(screen.getByTestId('plan-comment-input'), 'Validate UTF-8 bounds')
    await userEvent.click(screen.getByRole('button', { name: 'Save comment' }))

    await userEvent.click(within(sections[3]).getByRole('button', { name: /Comment on Extract session serializer/i }))
    await userEvent.type(screen.getByTestId('plan-comment-input'), 'Keep pure helper in shared/')
    fireEvent.keyDown(screen.getByTestId('plan-comment-input'), { key: 'Enter', ctrlKey: true })

    // Expand and fill general feedback
    await userEvent.click(screen.getByRole('button', { name: 'Add general feedback' }))
    const general = screen.getByTestId('plan-general-feedback')
    await userEvent.type(general, 'Do not modify legacy store 12')
    expect(onRespond).not.toHaveBeenCalled()

    // Verify Deny safety ordering remains first in footer
    const footerButtons = [...document.querySelectorAll('footer button')].map(btn => btn.textContent?.trim() ?? '')
    expect(footerButtons[0]).toMatch(/^Deny/)

    await userEvent.click(screen.getByRole('button', { name: 'Request changes (2)' }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({
      decision: 'decline',
      reason: [
        'Plan review feedback:',
        '1. Regarding "Extract session serializer into authSession.ts" (L7): Keep pure helper in shared/',
        '2. Regarding "Update IPC bridge validation" (L8): Validate UTF-8 bounds',
        '',
        'General note: Do not modify legacy store 12'
      ].join('\n')
    })
  })

  it('supports Request changes on non-impact plain ExitPlanMode cards and preserves plain Approve/Deny when no comments exist', async () => {
    const onRespond = vi.fn(async () => undefined)
    const { unmount } = render(
      <ThreadRequestCard
        request={makePlainPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480"
        onRespond={onRespond}
      />
    )

    // Without comments: plain Approve and Deny work identically and Request changes is absent
    expect(screen.queryByRole('button', { name: /Request changes/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
    unmount()

    // Plain Deny without comments
    const onRespondDeny = vi.fn(async () => undefined)
    const second = render(
      <ThreadRequestCard
        request={makePlainPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480"
        onRespond={onRespondDeny}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(onRespondDeny).toHaveBeenCalledWith({ decision: 'decline' })
    second.unmount()

    // Plain card with general feedback only -> Request changes (no count) submits structured reason
    const onRespondFeedback = vi.fn(async () => undefined)
    render(
      <ThreadRequestCard
        request={makePlainPlanRequest()}
        agent="Claude"
        disabled={false}
        conversationId="t-480"
        onRespond={onRespondFeedback}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add general feedback' }))
    await userEvent.type(screen.getByTestId('plan-general-feedback'), 'Add rollback instructions')
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    expect(onRespondFeedback).toHaveBeenCalledWith({
      decision: 'decline',
      reason: 'Plan review feedback:\nAdd rollback instructions'
    })
  })
})
