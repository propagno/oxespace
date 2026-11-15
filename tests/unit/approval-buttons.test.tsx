// OXE-109 (brand review of #823): the Browser's inline approval draws the approvals center's buttons. Deny first
// (secondary), the other ways to allow quiet (ghost), one main action last (allow once, primary); at critical and
// irreversible the center's rule: danger behind hold-to-confirm, no shortcut.
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mainMessage } from '../../shared/messages'
import type { ApprovalOption } from '../../shared/types/approvals'
import { approvalButtons, mainAllowStyle, requestWeight } from '../../src/components/Approvals/approvalsRules'
import { useApprovalsStore } from '../../src/components/Approvals/approvals.store'
import { installApprovalsMock } from '../../src/components/Approvals/approvalsMock'
import { resetApprovalsApi } from '../../src/components/Approvals/approvalsApi'
import { PreviewApprovalInline } from '../../src/components/WebPreview/PreviewApprovalInline'
import { changeLanguage } from '../../src/i18n'

const DENY: ApprovalOption = { id: 'deny', intent: 'deny', label: mainMessage('approvals.option.deny', {}) }
const ONCE: ApprovalOption = { id: 'allow-once', intent: 'allow', label: mainMessage('approvals.option.allowOnce', {}) }
const ALWAYS: ApprovalOption = { id: 'allow-always', intent: 'allow', label: mainMessage('approvals.option.allowPolicy', {}) }
const SESSION: ApprovalOption = { id: 'allow-session', intent: 'allow-session', label: mainMessage('approvals.option.allowSessionReads', {}) }
const PAGE = 'https://example.com/docs'

const plan = (buttons: ReturnType<typeof approvalButtons>): string[] => buttons.map(button => `${button.option.id}:${button.variant}${button.hold ? ':hold' : ''}`)

describe('approvalButtons · the center\'s map for a record\'s own options', () => {
  it('Deny first as secondary, the other allows ghost, allow once last and the only primary', () => {
    expect(plan(approvalButtons([ONCE, ALWAYS, DENY]))).toEqual(['deny:secondary', 'allow-always:ghost', 'allow-once:primary'])
    expect(plan(approvalButtons([DENY, SESSION, ONCE]))).toEqual(['deny:secondary', 'allow-session:ghost', 'allow-once:primary'])
    expect(approvalButtons([DENY, ONCE, ALWAYS, SESSION]).filter(button => button.variant === 'primary')).toHaveLength(1)
  })

  it('with no "allow" option the first other allow is the main action; deny alone is only Deny', () => {
    expect(plan(approvalButtons([DENY, SESSION]))).toEqual(['deny:secondary', 'allow-session:primary'])
    expect(plan(approvalButtons([DENY]))).toEqual(['deny:secondary'])
  })

  it('weighs the main action as the center does: irreversible is danger, critical and irreversible holds', () => {
    expect(mainAllowStyle(undefined)).toBe('primary')
    expect(mainAllowStyle({ risk: 'critical', reversible: true })).toBe('primary')
    expect(mainAllowStyle({ risk: 'high', reversible: false })).toBe('danger')
    expect(mainAllowStyle({ risk: 'critical', reversible: false })).toBe('hold')
    expect(plan(approvalButtons([DENY, ONCE, ALWAYS], { risk: 'high', reversible: false }))).toEqual(['deny:secondary', 'allow-always:ghost', 'allow-once:danger'])
    expect(plan(approvalButtons([DENY, ONCE, ALWAYS], { risk: 'critical', reversible: false }))).toEqual(['deny:secondary', 'allow-always:ghost', 'allow-once:danger:hold'])
  })

  it('a center record is held only at critical (its own risk, or raised by hidden characters)', () => {
    const text = (value: string) => ({ text: value, untrusted: true as const, length: value.length, truncated: false })
    expect(requestWeight({ risk: 'medium', agentText: text('ok') })).toEqual({ risk: 'medium', reversible: true })
    expect(requestWeight({ risk: 'medium', agentText: text('ok​') })).toEqual({ risk: 'high', reversible: true })
    expect(mainAllowStyle(requestWeight({ risk: 'critical', agentText: text('ok') }))).toBe('hold')
  })
})

describe('PreviewApprovalInline · the inline record follows the brand', () => {
  beforeEach(async () => { useApprovalsStore.getState().reset(); resetApprovalsApi(); await changeLanguage('en') })
  afterEach(() => { cleanup(); useApprovalsStore.getState().reset(); resetApprovalsApi() })

  async function show(partial: Parameters<ReturnType<typeof installApprovalsMock>['hook']['request']>[0]) {
    const api = installApprovalsMock()
    const id = api.hook.request({
      kind: 'mcp-confirm', target: PAGE, agentText: `Open in the Web Preview:\n${PAGE}`,
      summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_open_web_preview', action: 'call', target: PAGE }),
      ...partial
    })
    await act(async () => { await useApprovalsStore.getState().sync(api) })
    render(<PreviewApprovalInline owner={{ paneIds: ['p1'] }} />)
    return { api, id, card: within(screen.getByTestId('preview-approval-inline')) }
  }

  it('is an attention status named by the request, with Deny first and Allow once the one primary, last', async () => {
    const { card } = await show({ risk: 'low', options: [DENY, ONCE, ALWAYS, SESSION] })
    const status = card.getByRole('status', { name: `An agent asks to open ${PAGE} in the Browser` })
    expect(status).toHaveAttribute('data-intent', 'attention')
    expect(screen.queryByRole('alert')).toBeNull()
    const buttons = card.getAllByRole('button')
    expect(buttons.map(button => `${button.getAttribute('data-intent')}:${button.getAttribute('data-variant')}`))
      .toEqual(['deny:secondary', 'allow:ghost', 'allow-session:ghost', 'allow:primary'])
    expect(buttons.at(-1)).toHaveAccessibleName(/allow once/i)
    expect(buttons.filter(button => button.getAttribute('data-variant') === 'primary')).toHaveLength(1)
  })

  it('offers what the center offers: "for this run" only at low risk', async () => {
    const { card } = await show({ risk: 'medium', options: [DENY, ONCE, SESSION] })
    expect(card.getAllByRole('button').map(button => button.getAttribute('data-intent'))).toEqual(['deny', 'allow'])
  })

  it('at critical, Allow once is held to confirm in danger, shows no shortcut, and waits for main\'s pacing', async () => {
    const { card } = await show({ risk: 'critical', allowDelayMs: 2_000, enterDisabled: true, options: [DENY, ONCE] })
    const hold = card.getByRole('button', { name: 'Hold to approve' })
    expect(hold).toHaveAttribute('data-variant', 'danger')
    expect(hold.querySelector('kbd')).toBeNull()
    expect(hold).toBeDisabled()
    expect(card.getByRole('button', { name: /^deny$/i })).toBeEnabled()
    expect(card.queryByRole('button', { name: /allow once/i })).toBeNull()
  })
})
