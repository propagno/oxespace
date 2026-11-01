/**
 * B7.4 · What a change to a gated policy file does, and the request that asks the person about it (DESIGN #359, #361).
 * Loaded only when a file differs from its accepted version (accepted-config.ts), never on the hot path.
 *
 * Narrowing is decided syntactically, never over wildcards (that would be a language-inclusion problem):
 * - `policy.json`, per layer, rule order kept: the change applies at once only when the new list is the old one with
 *   deny rules inserted and/or allow rules deleted. Under last-match-wins each such step can only turn a resource's last
 *   match into a deny or leave it as it was, so nothing denied becomes allowed. Everything else asks: removing or editing
 *   a deny, adding an allow, reordering, `absent` (unless only allows go) and `invalid`.
 * - A mixed policy change (stricter and wider lines) that splits exactly (rules only added or removed, none moved or
 *   edited) applies exactly accepted + its inserted denies − its deleted allows, the pure narrowing, and asks about the
 *   rest against that. One that does not split applies nothing early.
 * - `oxe.yaml`: a change where every group moves down (to `off`, or `always` → `on-demand`) applies; any move up asks,
 *   and then the lowered groups wait with it.
 * - First sight of a project file (no accepted version, nothing inherited from its primary checkout), against the app's
 *   defaults: oxe.yaml always applies (on demand groups can already be turned on by the agent), and a policy applies when
 *   its allows are only for things allowed by default. An allow that can match `env:` (a secret reaching agents) or
 *   `net:` asks. The user and managed layers come after the project's, so an allow there can lift the project's deny:
 *   for them only the strict rule applies.
 */
import { execFile } from 'node:child_process'
import { relative } from 'node:path'
import { promisify } from 'node:util'
import { evaluatePolicy, type PolicyRule } from '../../../../shared/policy'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { APPROVAL_AGENT_TEXT_MAX, type ApprovalRisk } from '../../../../shared/types/approvals'
import { CONFIGURABLE_MCP_TOOL_GROUPS } from '../../../../shared/types/mcp-tools'
import type { ApprovalDraft } from '../approvals/approval-center'
import { DENY } from '../approvals/drafts'
import { APP_REQUESTER } from '../approvals/requester'
import type { AnyProjection, ChangeContext, ChangeVerdict, ModesValue, PolicyProjection, PolicyValue, Subject } from './accepted-config'
import { defaultModes, fileLabel, projectionHash } from './accepted-config'
import { MAX_POLICY_BYTES, parsePolicyProjection } from './projections'
import { parseModesProjection } from './tool-config'

/** Diff lines listed as notes (DESIGN: at most 8, wider first); the rest is counted in `note.policy.more`. */
export const MAX_NOTE_LINES = 8
const RANK = { off: 0, 'on-demand': 1, always: 2 } as const
/** Groups that reach data or secrets: turning one always on is critical (DESIGN #359 §3.1). */
const CRITICAL_GROUPS: readonly string[] = ['data']

export const ruleKey = (rule: PolicyRule): string => `${rule.effect}\0${rule.action}\0${rule.resource.toLowerCase()}`
const rulesOf = (projection: AnyProjection): PolicyRule[] => projection.state === 'value' && 'rules' in projection.value ? (projection.value as PolicyValue).rules : []

type Op = { op: 'keep' | 'add' | 'remove'; rule: PolicyRule }

/** The rule lists aligned by a longest common subsequence, in file order. */
export function alignRules(old: readonly PolicyRule[], next: readonly PolicyRule[]): Op[] {
  const a = old.map(ruleKey)
  const b = next.map(ruleKey)
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ op: 'keep', rule: next[j] }); i++; j++ }
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) ops.push({ op: 'remove', rule: old[i++] })
    else ops.push({ op: 'add', rule: next[j++] })
  }
  return ops
}

/** A removed rule next to an added one with the same effect and action: an edited rule, which cannot be proven stricter. */
function edits(ops: Op[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let index = 0; index + 1 < ops.length; index++) {
    const [first, second] = [ops[index], ops[index + 1]]
    if (first.op !== 'keep' && second.op !== 'keep' && first.op !== second.op && first.rule.action === second.rule.action && first.rule.effect === second.rule.effect) {
      pairs.push(first.op === 'remove' ? [index, index + 1] : [index + 1, index])
      index++
    }
  }
  return pairs
}

/**
 * Whether `next` is `old` with deny rules inserted and/or allow rules deleted, in order: a common subsequence that keeps
 * every old deny and every new allow. Exact (dynamic programming over both lists, at most 500 × 500), never greedy.
 */
export function onlyNarrows(old: readonly PolicyRule[], next: readonly PolicyRule[]): boolean {
  const a = old.map(ruleKey)
  const b = next.map(ruleKey)
  const width = b.length + 1
  // can[i][j]: old[i..] becomes next[j..] by those steps alone.
  const can = new Uint8Array((a.length + 1) * width)
  can[a.length * width + b.length] = 1
  for (let i = a.length; i >= 0; i--) {
    for (let j = b.length; j >= 0; j--) {
      if (i === a.length && j === b.length) continue
      const keep = i < a.length && j < b.length && a[i] === b[j] && can[(i + 1) * width + j + 1] === 1
      const dropAllow = i < a.length && old[i].effect === 'allow' && can[(i + 1) * width + j] === 1
      const addDeny = j < b.length && next[j].effect === 'deny' && can[i * width + j + 1] === 1
      can[i * width + j] = keep || dropAllow || addDeny ? 1 : 0
    }
  }
  return can[0] === 1
}

/** Whether a resource pattern can match something under `prefix` (`env:`, `net:`): `*` matches anything. */
export function canMatchPrefix(pattern: string, prefix: string): boolean {
  const lower = pattern.toLowerCase()
  const star = lower.indexOf('*')
  if (star < 0) return lower.startsWith(prefix)
  const literal = lower.slice(0, star)
  return literal.startsWith(prefix) || prefix.startsWith(literal)
}

/** An allow that cannot go beyond the app's defaults when nothing earlier denies: no secret (`env:`), no network (`net:`). */
export function allowWithinDefaults(rule: PolicyRule): boolean {
  if (rule.effect !== 'allow' || rule.action !== 'integration.use') return true
  return !canMatchPrefix(rule.resource, 'env:') && !canMatchPrefix(rule.resource, 'net:')
}

/**
 * The pure narrowing inside a mixed policy change: accepted + inserted denies − deleted allows, with the keys of what it
 * puts in force. Null when the change does not split exactly (a rule moved or edited, or the file is not valid).
 */
export function narrowingPart(base: AnyProjection, next: AnyProjection): { projection: PolicyProjection; applied: string[] } | null {
  if (next.state === 'invalid') return null
  const ops = alignRules(rulesOf(base), rulesOf(next))
  const added = new Set(ops.filter(op => op.op === 'add').map(op => ruleKey(op.rule)))
  if (edits(ops).length || ops.some(op => op.op === 'remove' && added.has(ruleKey(op.rule)))) return null
  const rules: PolicyRule[] = []
  const applied: string[] = []
  for (const { op, rule } of ops) {
    if (op === 'keep') rules.push(rule)
    else if (op === 'add' && rule.effect === 'deny') { rules.push(rule); applied.push(ruleKey(rule)) }
    else if (op === 'remove' && rule.effect === 'allow') applied.push(ruleKey(rule))
    else if (op === 'remove') rules.push(rule)
  }
  const organization = (next.state === 'value' ? (next.value as PolicyValue).organization : undefined) ?? (base.state === 'value' ? (base.value as PolicyValue).organization : undefined)
  return { projection: { state: 'value', value: { rules, ...(organization ? { organization } : {}) } }, applied }
}

/**
 * A rule in the app's words for a note parameter: its kind and pattern (`tool mcp__oxespace__oxespace_db_*`). The
 * pattern comes from the file, so only a plain identifier alphabet is kept (others become `?`) and it is cut at 120
 * characters: the app's own text never carries the file's spacing, quotes, controls or prose.
 */
export function ruleParam(rule: PolicyRule): string {
  const kind = rule.action === 'tool.use' ? 'tool' : rule.action === 'provider.use' ? 'provider' : rule.action === 'integration.use' ? 'integration' : 'db.write'
  const pattern = rule.resource.replace(/[^A-Za-z0-9_.:*/@-]/g, '?')
  return `${kind} ${pattern.length > 120 ? `${pattern.slice(0, 119)}…` : pattern}`
}

export interface NoteLine { widens: boolean; message: MainMessage }

/** The diff as C3 notes, from the version shown as accepted to the new one; `.applied` only on what really is in force. */
export function noteLines(subject: Pick<Subject, 'file'>, shownBase: AnyProjection, next: AnyProjection, applied: readonly string[] = []): NoteLine[] {
  const lines: NoteLine[] = []
  if (subject.file === 'oxe.yaml') {
    const before = shownBase.state === 'value' ? shownBase.value as ModesValue : defaultModes()
    const after = next.state === 'value' ? next.value as ModesValue : before
    for (const group of CONFIGURABLE_MCP_TOOL_GROUPS) {
      const from = before[group]?.mode ?? 'on-demand'
      const to = after[group]?.mode ?? 'on-demand'
      if (from === to) continue
      const widens = RANK[to] > RANK[from]
      lines.push({ widens, message: mainMessage(widens ? 'approvals.note.policy.groupRaised' : 'approvals.note.policy.groupLowered', { group, from, to }) })
    }
  } else if (next.state !== 'invalid') {
    const old = rulesOf(shownBase)
    const rules = rulesOf(next)
    const sorted = (list: PolicyRule[]) => list.map(ruleKey).sort().join('\n')
    if (old.length && sorted(old) === sorted(rules) && old.map(ruleKey).join('\n') !== rules.map(ruleKey).join('\n')) {
      lines.push({ widens: true, message: mainMessage('approvals.note.policy.reordered', { count: rules.length }) })
    } else {
      const ops = alignRules(old, rules)
      const paired = new Map<number, number>()
      for (const [removed, added] of edits(ops)) { paired.set(removed, added); paired.set(added, -1) }
      const done = new Set(applied)
      ops.forEach(({ op, rule }, index) => {
        if (op === 'keep') return
        const pair = paired.get(index)
        if (pair === -1) return
        if (pair !== undefined) {
          lines.push({ widens: true, message: mainMessage('approvals.note.policy.ruleEdited', { from: ruleParam(rule), to: ruleParam(ops[pair].rule) }) })
          return
        }
        const param = { rule: ruleParam(rule) }
        const inForce = done.has(ruleKey(rule))
        if (op === 'add' && rule.effect === 'allow') lines.push({ widens: true, message: mainMessage('approvals.note.policy.allowAdded', param) })
        else if (op === 'remove' && rule.effect === 'deny') lines.push({ widens: true, message: mainMessage('approvals.note.policy.denyRemoved', param) })
        else if (op === 'add') lines.push({ widens: false, message: mainMessage(inForce ? 'approvals.note.policy.denyAdded.applied' : 'approvals.note.policy.denyAdded.waiting', param) })
        else lines.push({ widens: false, message: mainMessage(inForce ? 'approvals.note.policy.allowRemoved.applied' : 'approvals.note.policy.allowRemoved.waiting', param) })
      })
    }
  }
  return [...lines.filter(item => item.widens), ...lines.filter(item => !item.widens)]
}

/** Whether a change applies at once (only tightens, or changes nothing that grants), with its counts. */
export function classify(subject: Pick<Subject, 'file' | 'layer'>, base: AnyProjection, next: AnyProjection, firstSight: boolean): ChangeVerdict {
  const lines = noteLines(subject, base, next)
  const wider = lines.filter(item => item.widens).length
  // Deleting a file with denies, or breaking it, widens even when no rule line says so.
  const fileWidens = next.state === 'invalid' || (next.state === 'absent' && rulesOf(base).some(rule => rule.effect === 'deny'))
  const widen = wider + (fileWidens ? 1 : 0)
  const tighten = lines.length - wider
  if (subject.file === 'oxe.yaml') {
    // First sight: nothing oxe.yaml sets goes past the defaults, where every group is on demand and the agent can turn it on.
    return { applies: firstSight || widen === 0, widen, tighten }
  }
  if (next.state === 'invalid') return { applies: false, widen, tighten }
  const old = rulesOf(base)
  const rules = rulesOf(next)
  if (onlyNarrows(old, rules)) return { applies: true, widen: 0, tighten }
  if (firstSight && subject.layer === 'project' && old.length === 0 && rules.every(allowWithinDefaults)) return { applies: true, widen, tighten }
  return { applies: false, widen: Math.max(widen, 1), tighten }
}

/**
 * High; critical when the change leaves the layer with no deny rule at all (deleted, emptied, or `allow *`) or turns a
 * group that reaches data or secrets always on. Computed by main, never taken from the file.
 */
export function changeRisk(subject: Pick<Subject, 'file'>, next: AnyProjection): ApprovalRisk {
  if (subject.file === 'oxe.yaml') {
    const modes = next.state === 'value' ? next.value as ModesValue : null
    return modes && CRITICAL_GROUPS.some(group => modes[group as keyof ModesValue]?.mode === 'always') ? 'critical' : 'high'
  }
  if (next.state === 'invalid') return 'high'
  const rules = rulesOf(next)
  return !rules.some(rule => rule.effect === 'deny') || rules.some(rule => rule.effect === 'allow' && rule.resource.trim() === '*') ? 'critical' : 'high'
}

/** OXESpace tools a policy layer denied before and does not deny after (names from the app's registry). */
async function usableTools(base: AnyProjection, next: AnyProjection): Promise<string[]> {
  const { TOOL_REGISTRY } = await import('../../mcp-internal/tool-registry')
  const layer = (projection: AnyProjection) => ({ sources: [{ layer: 'project' as const, path: '', rules: rulesOf(projection) }], problems: [] })
  const before = layer(base)
  const after = layer(next)
  const names: string[] = []
  for (const { descriptor } of TOOL_REGISTRY) {
    const resources = [`mcp__oxespace-delegation__${descriptor.name}`, `mcp__oxespace__${descriptor.name}`]
    const denied = (loaded: typeof before) => resources.some(resource => !evaluatePolicy(loaded, 'tool.use', resource).allowed)
    if (denied(before) && !denied(after)) names.push(descriptor.name)
  }
  return names
}

/** Whether the file's projection is the one committed at HEAD, from git (no shell), or nothing when git cannot tell. */
async function committed(subject: Subject, next: AnyProjection): Promise<boolean | null> {
  if (subject.layer !== 'project' || !subject.root) return null
  const path = relative(subject.root, subject.path).replace(/\\/g, '/')
  const parse = (text: string) => subject.file === 'policy' ? parsePolicyProjection(text, 'project', subject.path).projection : parseModesProjection(text)
  const run = promisify(execFile)
  try {
    const { stdout } = await run('git', ['-C', subject.root, 'show', `HEAD:${path}`], { timeout: 3_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    return projectionHash(subject.file, parse(stdout)) === projectionHash(subject.file, next)
  } catch {
    // Not committed (or no HEAD): when git runs here at all, the file is not the committed version.
    try { await run('git', ['-C', subject.root, 'rev-parse', '--git-dir'], { timeout: 3_000, windowsHide: true }); return next.state === 'absent' ? null : false } catch { return null }
  }
}

/** The request's text: the file as it is now (untrusted), bounded under APPROVAL_AGENT_TEXT_MAX; empty when deleted. */
export function requestText(subject: Pick<Subject, 'path'>, next: AnyProjection, read?: (path: string, max: number) => string | null): string {
  if (next.state === 'absent' || !read) return ''
  return read(subject.path, APPROVAL_AGENT_TEXT_MAX - 1) ?? ''
}

const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

/** The `policyChange` request (DESIGN #359 §3): app-computed title, summary, risk and notes; the file's own text in `agentText`. */
export async function requestDraft(subject: Subject, base: AnyProjection, next: AnyProjection, text: string, context: ChangeContext): Promise<ApprovalDraft> {
  const file = fileLabel(subject)
  const primary = subject.root ? context.inheritedFrom : null
  const target = primary ? relative(primary, subject.path).replace(/\\/g, '/') : subject.layer === 'project' ? file : subject.path
  const summary = next.state === 'absent' ? mainMessage('approvals.summary.policyChange.deleted', { file })
    : next.state === 'invalid' && next.tooLarge ? mainMessage('approvals.summary.policyChange.tooLarge', { file, max: sizeLabel(MAX_POLICY_BYTES) })
      : next.state === 'invalid' ? mainMessage('approvals.summary.policyChange.invalid', { file })
        : primary && subject.root ? mainMessage('approvals.summary.policyChange.worktree', { worktree: folderName(subject.root), file })
          : context.applied.length ? mainMessage('approvals.summary.policyChange.partial', { file })
            : mainMessage('approvals.summary.policyChange.widened', { file })
  const lines = noteLines(subject, context.shownBase, next, context.applied)
  const notes: MainMessage[] = lines.slice(0, MAX_NOTE_LINES).map(item => item.message)
  if (lines.length > MAX_NOTE_LINES) notes.push(mainMessage('approvals.note.policy.more', { count: lines.length - MAX_NOTE_LINES }))
  if (context.notSplit) notes.push(mainMessage('approvals.note.policy.notSplit', {}))
  if (next.state === 'invalid' && next.problem) notes.push(mainMessage('approvals.note.policy.problem', { problem: next.problem.slice(0, 200) }))
  if (next.state === 'absent') notes.push(mainMessage('approvals.note.policy.noText', {}))
  if (subject.file === 'policy') {
    const tools = await usableTools(base, next).catch(() => [])
    if (tools.length) notes.push(mainMessage('approvals.note.policy.usable', { tools: tools.slice(0, 10) }))
  }
  const atHead = await committed(subject, next).catch(() => null)
  if (atHead !== null) notes.push(mainMessage(atHead ? 'approvals.note.policy.committed' : 'approvals.note.policy.uncommitted', {}))
  if (context.liveSessions > 0) notes.push(mainMessage('approvals.note.policy.liveSessions', { count: context.liveSessions }))
  if (subject.layer === 'managed') notes.push(mainMessage('approvals.note.policy.managedNotProtected', {}))
  // An invalid or too large file cannot be applied: Deny only (DESIGN #359).
  const allow = next.state !== 'invalid'
  if (allow) notes.push(mainMessage('approvals.note.policy.allowEffect', {}))
  notes.push(mainMessage('approvals.note.policy.stillAccepted', {}))
  const title = subject.layer === 'user' ? 'approvals.title.policyChangeUser' : subject.layer === 'managed' ? 'approvals.title.policyChangeManaged' : 'approvals.title.policyChange'
  return {
    kind: 'policyChange',
    // Who wrote the file cannot be known, so no agent is named: the request is the app's.
    requester: APP_REQUESTER,
    risk: changeRisk(subject, next),
    title: mainMessage(title, {}),
    summary,
    target,
    appNotes: notes,
    text,
    // The text is the file's, written by someone else: the window must show it, or it goes native.
    ackRequired: true,
    options: allow ? [DENY, { id: 'allowPolicy', label: mainMessage('approvals.option.allowPolicy', {}), intent: 'allow' }] : [DENY],
    defaultOptionId: DENY.id
  }
}
