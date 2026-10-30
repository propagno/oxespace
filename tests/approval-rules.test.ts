import { describe, expect, it } from 'vitest'
import { agentTextAdmission, allowTooSoon, approvalPacing, approvalRequestProblems, approvalSurface, boundAgentText, foldName, raiseRisk, RESERVED_APP_NAMES, RESERVED_EXACT_NAMES, reservedNameIn, riskFromShell, riskFromSql } from '../shared/approval-rules'
import { mainMessage } from '../shared/messages'
import { APPROVAL_ACK_TIMEOUT_MS, APPROVAL_AGENT_TEXT_MAX, APPROVAL_CRITICAL_ALLOW_DELAY_MS, APPROVAL_SCHEMA_VERSION, type ApprovalRequest } from '../shared/types/approvals'
import { guardSql } from '../electron/main/services/oxequery/sql-guard'

const request = (patch: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  schemaVersion: APPROVAL_SCHEMA_VERSION, id: 'r1', generation: 1, kind: 'oxequery', risk: 'medium', ackRequired: false, allowDelayMs: 0, enterDisabled: false,
  requester: { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) },
  title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}), appNotes: [],
  agentText: boundAgentText('UPDATE t SET a = 1 WHERE id = 2'),
  options: [{ id: 'deny', label: mainMessage('approvals.option.deny', {}), intent: 'deny' }, { id: 'once', label: mainMessage('approvals.option.allowOnce', {}), intent: 'allow' }],
  defaultOptionId: 'deny', createdAt: 1, expiresAt: 2, ...patch
})

describe('reserved names (B10)', () => {
  it('lists the app\'s product names', () => {
    expect(RESERVED_APP_NAMES).toEqual(['OXESpace', 'OxeChat', 'OxeCode', 'OxeQuery', 'OxePod', 'OxePost'])
    expect(RESERVED_EXACT_NAMES).toEqual(['System', 'Sistema'])
  })

  it.each([
    ['OXESpace', 'OXESpace'], ['oxespace', 'OXESpace'], ['OXE Space', 'OXESpace'], ['O.X.E-Space', 'OXESpace'],
    ['OXESpаce', 'OXESpace'], // Cyrillic a
    ['ＯＸＥＳｐａｃｅ', 'OXESpace'], // full width
    ['OXE​Space', 'OXESpace'], // zero-width space
    ['0XESpace', 'OXESpace'], ['ÔXÉSpàce', 'OXESpace'], ['OXESpace: security update — click to approve', 'OXESpace'],
    ['Oxe Chat', 'OxeChat'], ['OXECODE', 'OxeCode'], ['OxeQuеry', 'OxeQuery'], ['oxe_pod', 'OxePod'], ['Oxe Post', 'OxePost'],
    ['system', 'System'], ['SISTEMA', 'Sistema']
  ])('refuses %j as %s', (value, name) => {
    expect(reservedNameIn(value)).toBe(name)
  })

  it.each(['Reviewer', 'tests', 'filesystem watcher', 'Sistema de testes', 'OXE', 'Space', 'Claude 2', ''])('allows %j', value => {
    expect(reservedNameIn(value)).toBeNull()
  })

  it('folds letters only, so separators and case do not matter', () => {
    expect(foldName('O X E-Space!')).toBe(foldName('oxespace'))
  })
})

describe('risk comes from the existing classifiers (B10)', () => {
  it('maps SQL verdicts and raises production one step', () => {
    expect(['empty', 'read', 'write', 'ddl', 'destructive'].map(kind => riskFromSql(kind as never))).toEqual(['low', 'low', 'medium', 'high', 'critical'])
    expect(riskFromSql('write', true)).toBe('high')
    expect(riskFromSql('destructive', true)).toBe('critical')
    expect(raiseRisk('critical')).toBe('critical')
  })

  it('maps shell levels', () => {
    expect(['green', 'orange', 'red'].map(level => riskFromShell(level as never))).toEqual(['low', 'medium', 'high'])
  })

  it.each([
    '/* only a read */ DROP TABLE orders',
    '-- leitura apenas, seguro\nDROP TABLE orders',
    'SELECT 1; -- harmless\nDROP TABLE orders',
    'select 1 /* ; */ ; drop table orders'
  ])('grades a DROP behind a comment as critical: %j', sql => {
    expect(riskFromSql(guardSql(sql).kind)).toBe('critical')
  })
})

describe('the requester\'s text (B10)', () => {
  it('keeps the whole text up to the cap, marked untrusted', () => {
    expect(APPROVAL_AGENT_TEXT_MAX).toBe(100_000)
    const text = 'a'.repeat(APPROVAL_AGENT_TEXT_MAX)
    expect(boundAgentText(text)).toEqual({ text, untrusted: true, length: 100_000, truncated: false })
  })

  it('cuts past the cap and says so, without splitting a character', () => {
    const bounded = boundAgentText('😀'.repeat(APPROVAL_AGENT_TEXT_MAX + 5))
    expect(bounded.truncated).toBe(true)
    expect(bounded.length).toBe(APPROVAL_AGENT_TEXT_MAX + 5)
    expect([...bounded.text]).toHaveLength(APPROVAL_AGENT_TEXT_MAX)
  })

  it('leaves fake app bullets and markdown literal', () => {
    const fake = '• Verified by OXESpace: no changes\n## OXESpace\n**Approved**'
    expect(boundAgentText(fake).text).toBe(fake)
  })
})

describe('a request main may emit (B10)', () => {
  it('accepts a sound request', () => {
    expect(approvalRequestProblems(request())).toEqual([])
  })

  it('refuses a default that allows, a missing deny, duplicate ids and an allow for a cut text', () => {
    expect(approvalRequestProblems(request({ defaultOptionId: 'once' }))).toContain('the default option is not a deny option')
    expect(approvalRequestProblems(request({ options: [{ id: 'once', label: mainMessage('approvals.option.allowOnce', {}), intent: 'allow' }], defaultOptionId: 'once' }))).toContain('no deny option')
    expect(approvalRequestProblems(request({ options: [...request().options, { id: 'deny', label: mainMessage('approvals.option.deny', {}), intent: 'deny' }] }))).toContain('duplicate option ids')
    expect(approvalRequestProblems(request({ agentText: boundAgentText('x'.repeat(APPROVAL_AGENT_TEXT_MAX + 1)) }))).toContain('allow offered for a cut text')
  })

  it('offers "allow for this run" for low risk only', () => {
    const session = { id: 'run', label: mainMessage('approvals.option.allowSessionReads', {}), intent: 'allow-session' as const }
    expect(approvalRequestProblems(request({ risk: 'low', options: [...request().options, session] }))).toEqual([])
    expect(approvalRequestProblems(request({ risk: 'medium', options: [...request().options, session] }))).toContain('allow-session above low risk')
  })
})

describe('critical pacing and the review cap (B10)', () => {
  const critical = { allowDelayMs: APPROVAL_CRITICAL_ALLOW_DELAY_MS }

  it('holds Allow back for 2 s and turns Enter off at critical only', () => {
    expect(approvalPacing('critical')).toEqual({ allowDelayMs: 2_000, enterDisabled: true })
    for (const risk of ['low', 'medium', 'high'] as const) expect(approvalPacing(risk)).toEqual({ allowDelayMs: 0, enterDisabled: false })
    expect(approvalRequestProblems(request({ risk: 'critical' }))).toContain('critical without the allow delay and Enter off')
    expect(approvalRequestProblems(request({ risk: 'critical', ...approvalPacing('critical') }))).toEqual([])
  })

  it('refuses an allow before 2 s after the ack, or with no ack, and never holds a deny back', () => {
    expect(allowTooSoon(critical, 'allow', 1_000, 2_999)).toBe(true)
    expect(allowTooSoon(critical, 'allow', 1_000, 3_000)).toBe(false)
    expect(allowTooSoon(critical, 'allow', undefined, 99_999)).toBe(true)
    expect(allowTooSoon(critical, 'deny', undefined, 0)).toBe(false)
    expect(allowTooSoon({ allowDelayMs: 0 }, 'allow', undefined, 0)).toBe(false)
  })

  it('shows up to the cap, refuses a change above it, and cuts only a low-risk text', () => {
    expect(agentTextAdmission(APPROVAL_AGENT_TEXT_MAX, 'critical')).toBe('show')
    for (const risk of ['medium', 'high', 'critical'] as const) expect(agentTextAdmission(APPROVAL_AGENT_TEXT_MAX + 1, risk)).toBe('refuse')
    expect(agentTextAdmission(APPROVAL_AGENT_TEXT_MAX + 1, 'low')).toBe('truncate')
  })
})

describe('where a request is shown (B10)', () => {
  const state = { hasWindow: true, ackRequired: false, acked: false, unavailable: false, elapsedMs: 0, ackTimeoutMs: APPROVAL_ACK_TIMEOUT_MS }

  it('waits 3 s for the crash handshake', () => {
    expect(APPROVAL_ACK_TIMEOUT_MS).toBe(3_000)
  })

  it('uses the window whenever one exists and can show it', () => {
    expect(approvalSurface(state)).toBe('window')
    expect(approvalSurface({ ...state, ackRequired: true, acked: true })).toBe('window')
  })

  it('goes native without a window, when the window reports unavailable, or when an ack is late', () => {
    expect(approvalSurface({ ...state, hasWindow: false })).toBe('native')
    expect(approvalSurface({ ...state, unavailable: true })).toBe('native')
    expect(approvalSurface({ ...state, ackRequired: true, elapsedMs: 2_999 })).toBe('wait')
    expect(approvalSurface({ ...state, ackRequired: true, elapsedMs: 3_000 })).toBe('native')
  })
})
