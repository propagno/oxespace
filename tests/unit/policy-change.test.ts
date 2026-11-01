// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { PolicyRule } from '../../shared/policy'
import { APPROVAL_AGENT_TEXT_MAX, APPROVAL_KINDS_REMOTE_FORBIDDEN, APPROVAL_TIMEOUT_MS, remoteMayAnswer } from '../../shared/types/approvals'
import { REMOTE_FORBIDDEN } from '../../shared/remote/protocol'
import { allowWithinDefaults, canMatchPrefix, changeRisk, classify, narrowingPart, noteLines, onlyNarrows, requestDraft, ruleKey, ruleParam } from '../../electron/main/services/policy/policy-change'
import { canonicalJson, defaultModes, projectionHash, type AnyProjection, type ModesValue, type Subject } from '../../electron/main/services/policy/accepted-config'
import { approvalTimeoutMs, APPROVAL_TIMEOUT_FLOOR_MS } from '../../electron/main/services/approvals/timeout'
import { ApprovalCenter, APPROVAL_REISSUE_HOLD_MS } from '../../electron/main/services/approvals/approval-center'
import { managedIsProtected } from '../../electron/main/services/policy/accepted-config'
import { readShown, safeName, SHOWN_READ_MAX } from '../../electron/main/services/policy/policy-change'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const deny = (resource: string, action: PolicyRule['action'] = 'tool.use'): PolicyRule => ({ effect: 'deny', action, resource })
const allow = (resource: string, action: PolicyRule['action'] = 'tool.use'): PolicyRule => ({ effect: 'allow', action, resource })
const rules = (...list: PolicyRule[]): AnyProjection => ({ state: 'value', value: { rules: list } })
const modes = (set: Partial<Record<keyof ModesValue, 'off' | 'on-demand' | 'always'>>): AnyProjection => {
  const value = defaultModes()
  for (const [group, mode] of Object.entries(set)) value[group as keyof ModesValue] = { mode: mode!, source: 'project' }
  return { state: 'value', value }
}
const project = { file: 'policy' as const, layer: 'project' as const }
const user = { file: 'policy' as const, layer: 'user' as const }
const yaml = { file: 'oxe.yaml' as const, layer: 'project' as const }
const codes = (lines: Array<{ message: { code: string } }>) => lines.map(line => line.message.code)

describe('narrowing is syntactic (B7.4, ARCHITECT change 4)', () => {
  const A = deny('mcp__a')
  const B = allow('mcp__b')
  const C = deny('mcp__c')

  it('applies inserting denies and deleting allows, in order', () => {
    expect(onlyNarrows([A, B], [A, C, B])).toBe(true)
    expect(onlyNarrows([A, B], [A])).toBe(true)
    expect(onlyNarrows([B], [C])).toBe(true) // allow → deny: delete an allow, insert a deny
    expect(onlyNarrows([], [C, deny('*')])).toBe(true)
    expect(onlyNarrows([A, B], [C, A, deny('x')])).toBe(true)
    expect(onlyNarrows([B, A], [A])).toBe(true)
    expect(onlyNarrows([A, B, A], [A, C, A])).toBe(true)
  })

  it('asks for removing or editing a deny, adding an allow, reordering, deny → allow', () => {
    expect(onlyNarrows([A, B], [B])).toBe(false) // a deny removed (even one that shadowed an allow)
    expect(onlyNarrows([A], [deny('mcp__a__x')])).toBe(false) // a deny's pattern narrowed: remove + insert
    expect(onlyNarrows([A], [A, B])).toBe(false)
    expect(onlyNarrows([A, B], [B, A])).toBe(false)
    expect(onlyNarrows([A], [allow('mcp__a')])).toBe(false)
  })

  it('compares resources without case, as they match', () => {
    expect(onlyNarrows([deny('MCP__A')], [deny('mcp__a')])).toBe(true)
    expect(projectionHash('policy', rules(deny('MCP__A')))).toBe(projectionHash('policy', rules(deny('mcp__a'))))
  })

  it('ignores organization and formatting; arrays keep their order', () => {
    expect(projectionHash('policy', { state: 'value', value: { rules: [A], organization: 'Acme' } })).toBe(projectionHash('policy', rules(A)))
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}')
    expect(projectionHash('policy', rules(A, C))).not.toBe(projectionHash('policy', rules(C, A)))
  })

  it('classifies absent and invalid as changes, and a deleted file only applies when it held no deny', () => {
    expect(classify(project, rules(A), { state: 'absent' }, false).applies).toBe(false)
    expect(classify(project, rules(B), { state: 'absent' }, false).applies).toBe(true)
    expect(classify(project, rules(B), { state: 'invalid' }, false)).toMatchObject({ applies: false })
    expect(projectionHash('policy', { state: 'invalid', problem: 'x' })).toBe(projectionHash('policy', { state: 'invalid' }))
    // Too large is its own projection (HML L): a Deny of a broken file does not hide a too large one.
    expect(projectionHash('policy', { state: 'invalid', tooLarge: true })).not.toBe(projectionHash('policy', { state: 'invalid' }))
  })

  it('oxe.yaml: moving down applies, any move up asks; the list and map forms are one projection', () => {
    expect(classify(yaml, modes({ data: 'always' }), modes({ data: 'on-demand' }), false).applies).toBe(true)
    expect(classify(yaml, modes({ data: 'on-demand' }), modes({ data: 'off' }), false).applies).toBe(true)
    expect(classify(yaml, modes({ data: 'off' }), modes({ data: 'on-demand' }), false).applies).toBe(false)
    expect(classify(yaml, modes({}), modes({ docs: 'always' }), false).applies).toBe(false)
    expect(classify(yaml, modes({ data: 'off' }), { state: 'invalid' }, false).applies).toBe(false)
    const listForm = modes({ data: 'always' })
    const mapForm: AnyProjection = { state: 'value', value: { ...defaultModes(), data: { mode: 'always', source: 'project' } } }
    expect(projectionHash('oxe.yaml', listForm)).toBe(projectionHash('oxe.yaml', mapForm))
    // Named on demand is the same power as not named.
    expect(projectionHash('oxe.yaml', modes({ data: 'on-demand' }))).toBe(projectionHash('oxe.yaml', modes({})))
  })
})

describe('first sight against the defaults (ARCHITECT change 5)', () => {
  it('a project policy with denies, or allows only for things allowed by default, applies', () => {
    expect(classify(project, { state: 'absent' }, rules(deny('*')), true).applies).toBe(true)
    expect(classify(project, { state: 'absent' }, rules(deny('mcp__x'), allow('mcp__x'), allow('claude', 'provider.use'), allow('mcp:github', 'integration.use')), true).applies).toBe(true)
  })

  it('an allow that can reach env: or net: asks, as does any allow in the user layer', () => {
    for (const resource of ['env:GITHUB_TOKEN', 'env:*', '*', 'e*', 'net:example.com', 'n*']) {
      expect(classify(project, { state: 'absent' }, rules(allow(resource, 'integration.use')), true).applies, resource).toBe(false)
    }
    expect(classify(user, { state: 'absent' }, rules(allow('mcp__x')), true).applies).toBe(false)
    expect(canMatchPrefix('mcp:*', 'env:')).toBe(false)
    expect(allowWithinDefaults(allow('db:*', 'integration.use'))).toBe(true)
  })

  it('a first oxe.yaml always applies', () => {
    expect(classify(yaml, modes({}), modes({ data: 'always', app: 'always' }), true).applies).toBe(true)
  })
})

describe('mixed changes (DESIGN #361)', () => {
  const D1 = deny('mcp__oxespace__oxespace_db_execute')
  const A1 = allow('mcp__x')

  it('splits exactly: accepted + inserted denies − deleted allows, and marks only those as applied', () => {
    const base = rules(D1, A1)
    const next = rules(deny('mcp__new'), allow('mcp__wide'))
    const split = narrowingPart(base, next)
    expect(split?.projection).toEqual(rules(D1, deny('mcp__new')))
    expect(split?.applied.sort()).toEqual([ruleKey(deny('mcp__new')), ruleKey(A1)].sort())
    expect(onlyNarrows((base as { value: { rules: PolicyRule[] } }).value.rules, (split!.projection as { value: { rules: PolicyRule[] } }).value.rules)).toBe(true)
    const lines = codes(noteLines(project, base, next, split!.applied))
    expect(lines).toEqual(['approvals.note.policy.denyRemoved', 'approvals.note.policy.allowAdded', 'approvals.note.policy.allowRemoved.applied', 'approvals.note.policy.denyAdded.applied'])
  })

  it('does not split a moved or edited rule', () => {
    expect(narrowingPart(rules(D1, A1), rules(A1, D1, deny('z')))).toBeNull()
    expect(narrowingPart(rules(D1), rules(deny('mcp__oxespace__oxespace_db_*'), allow('*')))).toBeNull()
    expect(narrowingPart(rules(D1), { state: 'invalid' })).toBeNull()
  })

  it('marks .applied only on what is in force; everything else waits', () => {
    const lines = noteLines(project, rules(A1), rules(deny('a'), allow('b')))
    expect(codes(lines)).toEqual(['approvals.note.policy.allowAdded', 'approvals.note.policy.allowRemoved.waiting', 'approvals.note.policy.denyAdded.waiting'])
    expect(codes(noteLines(project, rules(D1), rules(deny('other'))))).toEqual(['approvals.note.policy.ruleEdited'])
    expect(codes(noteLines(project, rules(D1, A1), rules(A1, D1)))).toEqual(['approvals.note.policy.reordered'])
  })

  it('oxe.yaml: lowered groups wait with a raised one, with no suffix', () => {
    const lines = noteLines(yaml, modes({ data: 'always' }), modes({ data: 'off', docs: 'always' }))
    expect(codes(lines)).toEqual(['approvals.note.policy.groupRaised', 'approvals.note.policy.groupLowered'])
    expect(classify(yaml, modes({ data: 'always' }), modes({ data: 'off', docs: 'always' }), false).applies).toBe(false)
  })
})

describe('the request (DESIGN #359)', () => {
  const subject: Subject = { id: 'project:/r\0policy', key: 'project:/r', file: 'policy', layer: 'project', root: null, path: '/r/.oxespace/policy.json' }
  const context = { shownBase: rules(deny('mcp__a')), applied: [], notSplit: false, inheritedFrom: null, liveSessions: 2 }

  it('is the app\'s, high or critical, deny by default, the diff as notes and the file\'s text as agentText', async () => {
    const draft = await requestDraft(subject, rules(deny('mcp__a')), rules(allow('*')), '{ "rules": [] }', context)
    expect(draft).toMatchObject({ kind: 'policyChange', requester: { kind: 'app', id: 'oxespace' }, risk: 'critical', defaultOptionId: 'deny', ackRequired: true, target: '.oxespace/policy.json', text: '{ "rules": [] }' })
    expect(draft.title.code).toBe('approvals.title.policyChange')
    expect(draft.summary).toEqual({ code: 'approvals.summary.policyChange.widened', params: { file: '.oxespace/policy.json' } })
    expect(draft.options.map(option => option.id)).toEqual(['deny', 'allowPolicy'])
    expect(draft.appNotes.map(note => note.code)).toEqual(expect.arrayContaining(['approvals.note.policy.allowAdded', 'approvals.note.policy.denyRemoved', 'approvals.note.policy.liveSessions', 'approvals.note.policy.stillAccepted']))
    expect(draft.appNotes.slice(-2).map(note => note.code)).toEqual(['approvals.note.policy.stillAccepted', 'approvals.note.policy.allowEffect'])
  })

  it('is Deny only for an invalid or too large file, and names the variant', async () => {
    const invalid = await requestDraft(subject, rules(deny('a')), { state: 'invalid', problem: 'not valid JSON' }, '{', context)
    expect(invalid.options.map(option => option.id)).toEqual(['deny'])
    expect(invalid.summary.code).toBe('approvals.summary.policyChange.invalid')
    expect(invalid.appNotes).toContainEqual({ code: 'approvals.note.policy.problem', params: { problem: 'not valid JSON' } })
    const large = await requestDraft(subject, rules(deny('a')), { state: 'invalid', tooLarge: true }, 'x', context)
    expect(large.summary).toEqual({ code: 'approvals.summary.policyChange.tooLarge', params: { file: '.oxespace/policy.json', max: '256 KB' } })
    const deleted = await requestDraft(subject, rules(deny('a')), { state: 'absent' }, '', context)
    expect(deleted.summary.code).toBe('approvals.summary.policyChange.deleted')
    expect(deleted.risk).toBe('critical')
    const worktree = await requestDraft({ ...subject, root: '/p/wt' }, rules(deny('a')), rules(allow('b')), '', { ...context, inheritedFrom: '/p/main' })
    expect(worktree.summary).toEqual({ code: 'approvals.summary.policyChange.worktree', params: { worktree: 'wt', file: '.oxespace/policy.json' } })
  })

  it('lists at most 8 lines, wider first, then a count', async () => {
    const many = rules(...Array.from({ length: 12 }, (_, index) => allow(`mcp__t${index}`)))
    const draft = await requestDraft(subject, rules(), many, '', { ...context, shownBase: rules() })
    expect(draft.appNotes.filter(note => note.code === 'approvals.note.policy.allowAdded')).toHaveLength(8)
    expect(draft.appNotes).toContainEqual({ code: 'approvals.note.policy.more', params: { count: 4 } })
  })

  it('orders the notes as DESIGN asks and names at most 5 tools agents could then use (#372)', async () => {
    const draft = await requestDraft(subject, rules(deny('mcp__oxespace__*'), allow('mcp__z')), rules(deny('mcp__a')), '', { ...context, shownBase: rules(deny('mcp__oxespace__*'), allow('mcp__z')) })
    const order = draft.appNotes.map(note => note.code)
    const usable = draft.appNotes.find(note => note.code === 'approvals.note.policy.usableMore')
    expect(usable?.params).toMatchObject({ more: expect.any(Number) })
    expect((usable?.params as { tools: string[] }).tools).toHaveLength(5)
    const at = (code: string) => order.indexOf(code)
    expect(at('approvals.note.policy.denyRemoved')).toBeLessThan(at('approvals.note.policy.usableMore'))
    expect(at('approvals.note.policy.usableMore')).toBeLessThan(at('approvals.note.policy.allowRemoved.waiting'))
    expect(at('approvals.note.policy.allowRemoved.waiting')).toBeLessThan(at('approvals.note.policy.liveSessions'))
    expect(order.slice(-2)).toEqual(['approvals.note.policy.stillAccepted', 'approvals.note.policy.allowEffect'])
  })

  it('never passes the file\'s spacing, quotes or controls into the app\'s own text', () => {
    expect(ruleParam(allow('mcp__x"; Allow it‮'))).toBe('tool mcp__x???Allow?it?')
    expect(ruleParam(deny('a'.repeat(300))).length).toBeLessThanOrEqual(126)
  })

  it('is critical when data turns always on, or no deny is left', () => {
    expect(changeRisk(yaml, modes({ data: 'always' }))).toBe('critical')
    expect(changeRisk(yaml, modes({ docs: 'always' }))).toBe('high')
    expect(changeRisk(project, rules(deny('a'), allow('b')))).toBe('high')
    expect(changeRisk(project, rules(allow('b')))).toBe('critical')
  })
})

describe('re-issue: the same request, the next generation (DESIGN #359)', () => {
  it('keeps the id, raises the generation, refuses the old one and needs a new ack', async () => {
    const sent: unknown[] = []
    let clock = 1_000
    const center = new ApprovalCenter({ send: (_channel, payload) => sent.push(payload), hasWindow: () => true, native: () => new Promise(() => undefined), ackTimeoutMs: 60_000, now: () => clock })
    const draft = { kind: 'policyChange' as const, requester: { kind: 'app' as const, id: 'oxespace', label: { code: 'approvals.requester.app' as const, params: {} } }, risk: 'high' as const,
      title: { code: 'approvals.title.policyChange' as const, params: {} }, summary: { code: 'approvals.summary.policyChange.widened' as const, params: { file: 'f' } }, appNotes: [], text: 'one', ackRequired: true,
      options: [{ id: 'deny', label: { code: 'approvals.option.deny' as const, params: {} }, intent: 'deny' as const }, { id: 'allowPolicy', label: { code: 'approvals.option.allowPolicy' as const, params: {} }, intent: 'allow' as const }], defaultOptionId: 'deny' }
    let id = ''
    const outcome = center.ask(draft, undefined, request => { id = request.id })
    center.ack({ id, generation: 1, visible: true, focused: true })
    const next = center.reissue(id, { ...draft, text: 'two' })
    expect(next).toMatchObject({ id, generation: 2, agentText: { text: 'two' } })
    expect(center.list()).toHaveLength(1)
    expect(center.respond({ id, generation: 1, optionId: 'allowPolicy' })).toMatchObject({ ok: false, refusal: 'staleGeneration' })
    expect(center.respond({ id, generation: 2, optionId: 'allowPolicy' })).toMatchObject({ ok: false, refusal: 'notShown' })
    center.ack({ id, generation: 2, visible: true, focused: true })
    // The modal updated in place: Allow waits a moment, so a click meant for the old generation cannot land (review L3).
    expect(next?.allowDelayMs).toBe(APPROVAL_REISSUE_HOLD_MS)
    expect(center.respond({ id, generation: 2, optionId: 'allowPolicy' })).toMatchObject({ ok: false, refusal: 'tooSoon' })
    clock += APPROVAL_REISSUE_HOLD_MS
    expect(center.respond({ id, generation: 2, optionId: 'allowPolicy' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', optionId: 'allowPolicy', by: 'user' })
    expect(center.reissue(id, draft)).toBeNull()
  })
})

describe('OXESPACE_E2E_APPROVALS_TIMEOUT_MS', () => {
  it('shortens the timeout in an unpackaged build, floored', () => {
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: '2000' }, false)).toBe(2000)
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: '1' }, false)).toBe(APPROVAL_TIMEOUT_FLOOR_MS)
    expect(approvalTimeoutMs({}, false)).toBe(APPROVAL_TIMEOUT_MS)
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: 'soon' }, false)).toBe(APPROVAL_TIMEOUT_MS)
  })

  it('is ignored in a packaged build and never lengthens the timeout', () => {
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: '2000' }, true)).toBe(APPROVAL_TIMEOUT_MS)
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: String(APPROVAL_TIMEOUT_MS * 10) }, false)).toBe(APPROVAL_TIMEOUT_MS)
    expect(approvalTimeoutMs({ OXESPACE_E2E_APPROVALS_TIMEOUT_MS: 'Infinity' }, false)).toBe(APPROVAL_TIMEOUT_MS)
  })
})

describe('the phone never answers a policy change', () => {
  it('maps policyChange to the forbidden policy.edit', () => {
    expect(APPROVAL_KINDS_REMOTE_FORBIDDEN.policyChange).toBe('policy.edit')
    for (const capability of Object.values(APPROVAL_KINDS_REMOTE_FORBIDDEN)) expect(REMOTE_FORBIDDEN).toContain(capability)
    expect(remoteMayAnswer('policyChange')).toBe(false)
    expect(remoteMayAnswer('action')).toBe(true)
  })
})

describe('SECURITY review of #372', () => {
  const subject: Subject = { id: 'project:/r\0policy', key: 'project:/r', file: 'policy', layer: 'project', root: null, path: '/r/.oxespace/policy.json' }
  const context = { shownBase: rules(deny('mcp__a')), applied: [], notSplit: false, inheritedFrom: null, liveSessions: 0 }

  it('M1: lists an allow that reaches a secret first, even at position 9, and makes it critical', async () => {
    const harmless = Array.from({ length: 9 }, (_, index) => allow(`mcp__tool${index}`))
    const next = rules(deny('mcp__a'), ...harmless, allow('env:*', 'integration.use'))
    const lines = noteLines(project, rules(deny('mcp__a')), next)
    expect(lines[0].message).toEqual({ code: 'approvals.note.policy.allowAdded', params: { rule: 'integration env:*' } })
    expect(changeRisk(project, next)).toBe('critical')
    expect(changeRisk(project, rules(deny('a'), allow('net:*', 'integration.use')))).toBe('critical')
    expect(changeRisk(project, rules(deny('a'), allow('**')))).toBe('critical')
    const draft = await requestDraft(subject, rules(deny('mcp__a')), next, '', context)
    expect(draft.appNotes[0]).toEqual({ code: 'approvals.note.policy.allowAdded', params: { rule: 'integration env:*' } })
    expect(draft.risk).toBe('critical')
  })

  it('H2: a file longer than a person reviews goes whole to the center, which cuts it and offers Deny only', async () => {
    const padding = Array.from({ length: 480 }, (_, index) => allow(`mcp__padding_tool_number_${index}_${'x'.repeat(150)}`))
    const next = rules(deny('mcp__a'), ...padding, allow('env:*', 'integration.use'))
    const text = JSON.stringify((next as { value: unknown }).value, null, 2)
    expect(text.length).toBeGreaterThan(APPROVAL_AGENT_TEXT_MAX)
    expect(text.endsWith('}')).toBe(true)
    const draft = await requestDraft(subject, rules(deny('mcp__a')), next, text, context)
    expect(draft.cutLongText).toBe(true)
    expect(draft.appNotes.map(note => note.code)).toContain('approvals.note.textCut')
    const center = new ApprovalCenter({ send: () => undefined, hasWindow: () => true, native: () => new Promise(() => undefined), ackTimeoutMs: 60_000 })
    void center.ask(draft)
    const [request] = center.list()
    expect(request.agentText).toMatchObject({ truncated: true, length: text.length })
    expect(request.options.map(option => option.id)).toEqual(['deny'])
    expect(request.risk).toBe('critical')
  })

  it('M2: shows the text only when it is the version being accepted', () => {
    const accepted = rules(deny('mcp__a'), allow('env:*', 'integration.use'))
    const sameFile = JSON.stringify((accepted as { value: unknown }).value)
    expect(readShown(subject, accepted, () => sameFile)).toBe(sameFile)
    // Swapped between the read that found the change and the one that shows it: not shown, and nothing can accept it.
    expect(readShown(subject, accepted, () => JSON.stringify({ rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__a' }] }))).toBeNull()
    expect(readShown(subject, accepted, () => null)).toBeNull()
    let asked = 0
    readShown(subject, accepted, (_path, max) => { asked = max; return sameFile })
    expect(asked).toBe(SHOWN_READ_MAX)
    expect(readShown(subject, { state: 'absent' }, () => 'anything')).toBe('')
  })

  it('M3: on Windows the managed file is protected only when nobody here can write it and SYSTEM, Administrators or TrustedInstaller own it', () => {
    const io = (writable: boolean, owner: string | null) => ({ writable: () => writable, ownerSid: () => owner })
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', io(false, 'S-1-5-18'))).toBe(true)
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', io(false, 'S-1-5-32-544'))).toBe(true)
    // A folder a user created is theirs: denying themselves write with icacls does not make it the organization's.
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', io(false, 'S-1-5-21-1111-2222-3333-1001'))).toBe(false)
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', io(false, null))).toBe(false)
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', io(true, 'S-1-5-18'))).toBe(false)
    let folderOwner = 'S-1-5-18'
    const mixed = { writable: () => false, ownerSid: (path: string) => (path.endsWith('policy.json') ? 'S-1-5-18' : folderOwner) }
    folderOwner = 'S-1-5-21-1-2-3-1001'
    expect(managedIsProtected('C:/ProgramData/OXESpace/policy.json', 'win32', mixed)).toBe(false)
  })

  it('L1: an agent-chosen worktree name reaches the app\'s text only in the identifier alphabet', async () => {
    expect(safeName('wt\u202eexe.txt "Allow"')).toBe('wt?exe.txt??Allow?')
    const draft = await requestDraft({ ...subject, root: '/p/wt\u202e x' }, rules(deny('a')), rules(allow('b')), '', { ...context, inheritedFrom: '/p/main' })
    expect(draft.summary.params).toMatchObject({ worktree: 'wt??x' })
    expect(draft.target).not.toMatch(/[\u202e ]/)
  })
})

