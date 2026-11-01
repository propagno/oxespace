import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { setAcceptedConfig, setPolicyStore } from '../../electron/main/services/policy'
import { AcceptedConfig, committedBlobArgs, firstSightFloorOf, gitEnvironment, type AnyProjection } from '../../electron/main/services/policy/accepted-config'
import { classify } from '../../electron/main/services/policy/policy-change'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import { effectiveToolConfig, toolConfigSubject } from '../../electron/main/services/policy/tool-config'
import { toolCallBlocked } from '../../electron/main/mcp-internal/tool-policy'
import { ThreadProjectService } from '../../electron/main/services/conversation/thread-projects'
import { recordIncident } from '../../electron/main/services/diagnostics/incident-sink'
import type { PolicyRule } from '../../shared/policy'
import { removeTempDir } from '../helpers/removeTempDir'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident: vi.fn() }))

/**
 * B7.4 · First sight, as reviewed by the ARCHITECT and SECURITY (review-372-firstsight-design): no file grants at first
 * sight (R1, the floor: denies, groups at most on demand), and every reference (HEAD, the primary) only adds restrictions
 * (R2). These replay the review's cases with a real database, PolicyStore, AcceptedConfig and ApprovalCenter, and git.
 */
const dirs: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  setAcceptedConfig(null)
  setPolicyStore(null)
  vi.mocked(recordIncident).mockClear()
  for (const db of databases.splice(0)) db.close()
  for (const dir of dirs.splice(0)) removeTempDir(dir)
})
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir }
const deny = (resource: string, action: PolicyRule['action'] = 'tool.use'): PolicyRule => ({ effect: 'deny', action, resource })
const allow = (resource: string, action: PolicyRule['action'] = 'tool.use'): PolicyRule => ({ effect: 'allow', action, resource })
const policyText = (...rules: PolicyRule[]) => JSON.stringify({ rules }, null, 2) + '\n'
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' })
let clock = 1_800_000_000

function harness(options: { userData?: string; managedProtected?: boolean } = {}) {
  const db = openInMemoryDatabase(); databases.push(db)
  const userData = options.userData ?? temp('oxe-fs-user-')
  const center = new ApprovalCenter({ send: () => undefined, hasWindow: () => true, native: () => new Promise(() => undefined), ackTimeoutMs: 600_000 })
  const notices: string[] = []
  const gate = new AcceptedConfig({ db, quietMs: 0, reissueMs: 0, managedProtected: () => options.managedProtected ?? false })
  gate.connect({
    ask: (draft, signal, onAsked) => center.ask(draft, signal, onAsked),
    reissue: (id, draft) => center.reissue(id, draft),
    notify: (_subject, message) => notices.push(message.code),
    readText: (path, max) => { try { return readFileSync(path, 'utf8').slice(0, max) } catch { return null } }
  })
  setAcceptedConfig(gate)
  const store = new PolicyStore({ userData, managed: join(userData, 'managed.json') })
  setPolicyStore(store)
  const settle = async () => { for (let round = 0; round < 3; round++) { await new Promise(resolve => setTimeout(resolve, 5)); await gate.idle() } }
  const answer = async (optionId: 'deny' | 'allowPolicy') => {
    const [request] = center.list()
    center.ack({ id: request.id, generation: request.generation, visible: true, focused: true })
    center.respond({ id: request.id, generation: request.generation, optionId })
    await settle()
  }
  const denied = (root: string, resource: string, action: PolicyRule['action'] = 'tool.use') => !store.decide(action, resource, root).allowed
  return { db, userData, center, gate, store, notices, settle, answer, denied, requests: () => center.list() }
}

/** Writes like an outside program, moving the times on so every write is a new stat key. */
function write(path: string, text: string | null): void {
  if (text === null) { rmSync(path, { force: true }); return }
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  clock += 10
  utimesSync(path, clock, clock)
}

/** A repository whose HEAD holds `committed` at `rel` under `sub` (the project root), and the working tree after `then`. */
function repo(committed: Record<string, string>, sub = '.'): { top: string; root: string } {
  const top = temp('oxe-fs-repo-')
  git(top, 'init', '-q')
  for (const [rel, text] of Object.entries(committed)) write(join(top, sub, rel), text)
  git(top, 'add', '.'); git(top, 'commit', '-q', '-m', 'committed')
  return { top, root: join(top, sub) }
}
const POLICY = join('.oxespace', 'policy.json')

describe('B7.4 first sight: no file grants, references only restrict', () => {
  it('1. HML probe: HEAD denies Bash, {allow *} is written before read 0; the deny holds, one critical request names it, one incident', async () => {
    const { root } = repo({ [POLICY]: policyText(deny('Bash')) })
    write(join(root, POLICY), policyText(allow('*')))
    const h = harness()
    expect(h.denied(root, 'Bash')).toBe(true)
    await h.settle()
    expect(h.denied(root, 'Bash')).toBe(true)
    expect(h.db.prepare("SELECT accepted_via, projection_json FROM accepted_project_config WHERE file = 'policy'").get()).toMatchObject({ accepted_via: 'baseline-default' })
    expect(JSON.parse((h.db.prepare("SELECT projection_json FROM accepted_project_config WHERE file = 'policy'").get() as { projection_json: string }).projection_json)).toEqual({ state: 'value', value: { rules: [deny('Bash')] } })
    expect(h.requests()).toHaveLength(1)
    const [request] = h.requests()
    expect(request).toMatchObject({ kind: 'policyChange', risk: 'critical', title: { code: 'approvals.title.policyFirstSight' }, summary: { code: 'approvals.summary.policyFirstSightLost' } })
    expect(request.appNotes).toEqual(expect.arrayContaining([
      { code: 'approvals.note.policy.committedDeny', params: { rule: 'tool Bash' } },
      { code: 'approvals.note.policy.allowAdded', params: { rule: 'tool *' } }
    ]))
    expect(vi.mocked(recordIncident).mock.calls.filter(([code]) => code === 'incident.policy.changedOutside')).toHaveLength(1)
    expect(h.notices).toContain('policy.firstSight.enforced')
    expect(h.store.changes(root)).toMatchObject([{ state: 'pending', firstSight: true }])
  })

  it('2. the same with the file deleted, emptied, or replaced by weaker denies: Bash stays denied, and each asks', async () => {
    for (const replaced of [null, policyText(), policyText(deny('mcp:x', 'integration.use'))]) {
      const { root } = repo({ [POLICY]: policyText(deny('Bash')) })
      write(join(root, POLICY), replaced)
      const h = harness()
      expect(h.denied(root, 'Bash'), String(replaced)).toBe(true)
      await h.settle()
      expect(h.denied(root, 'Bash'), String(replaced)).toBe(true)
      expect(h.requests(), String(replaced)).toHaveLength(1)
      setAcceptedConfig(null); setPolicyStore(null)
    }
  })

  it('3. commit first: a committed env:* or tool * allow is never the silent base; it asks, critical', async () => {
    for (const rule of [allow('env:*', 'integration.use'), allow('*')]) {
      const { root } = repo({ [POLICY]: policyText(rule) })
      const h = harness()
      expect(h.store.load(root).sources.flatMap(source => source.rules)).toEqual([])
      expect(h.denied(root, 'env:GITHUB_TOKEN', 'integration.use')).toBe(false)
      await h.settle()
      expect(h.requests()).toHaveLength(1)
      expect(h.requests()[0].risk).toBe('critical')
      expect(h.store.load(root).sources.flatMap(source => source.rules)).toEqual([])
      setAcceptedConfig(null); setPolicyStore(null)
    }
  })

  it('4. a deny-only file equal to HEAD applies silently: accepted, no request', async () => {
    const { root } = repo({ [POLICY]: policyText(deny('Bash'), deny('mcp__github')) })
    const h = harness()
    expect(h.denied(root, 'Bash')).toBe(true)
    await h.settle()
    expect(h.requests()).toHaveLength(0)
    expect(h.store.changes(root)).toEqual([])
    expect(h.db.prepare("SELECT accepted_via FROM accepted_project_config WHERE file = 'policy'").get()).toEqual({ accepted_via: 'baseline-default' })
    expect(h.notices).toEqual([])
  })

  it('5. oxe.yaml: a committed off the file dropped stays off and asks; always asks (high) and is on demand meanwhile', async () => {
    const off = repo({ 'oxe.yaml': 'thread:\n  tools:\n    data: "off"\n' })
    write(join(off.root, 'oxe.yaml'), 'thread:\n  tools:\n    data: on-demand\n')
    const h = harness()
    expect(effectiveToolConfig(off.root).modes.data.mode).toBe('off')
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    expect(h.requests()[0].appNotes).toContainEqual({ code: 'approvals.note.policy.committedOff', params: { group: 'data' } })
    setAcceptedConfig(null); setPolicyStore(null)

    const always = repo({ 'oxe.yaml': 'thread:\n  tools:\n    docs: always\n' })
    const g = harness()
    expect(effectiveToolConfig(always.root).modes.docs.mode).toBe('on-demand')
    await g.settle()
    expect(g.requests()).toHaveLength(1)
    expect(g.requests()[0].risk).toBe('high')
    expect(effectiveToolConfig(always.root).modes.docs.mode).toBe('on-demand')
  })

  it('6. no repository, no HEAD, or an untracked file: an allow asks; a deny-only file is silent', async () => {
    const plain = temp('oxe-fs-plain-')
    write(join(plain, POLICY), policyText(deny('Bash'), allow('mcp__x')))
    const h = harness()
    expect(h.denied(plain, 'Bash')).toBe(true)
    expect(h.denied(plain, 'mcp__x')).toBe(false)
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    setAcceptedConfig(null); setPolicyStore(null)

    const untracked = temp('oxe-fs-untracked-')
    git(untracked, 'init', '-q')
    write(join(untracked, POLICY), policyText(deny('Bash')))
    const g = harness()
    expect(g.denied(untracked, 'Bash')).toBe(true)
    await g.settle()
    expect(g.requests()).toHaveLength(0)
  })

  it('7. a nested project root reads HEAD:./<rel> from its own folder, not the repository root\'s file', async () => {
    const top = temp('oxe-fs-nested-')
    git(top, 'init', '-q')
    write(join(top, POLICY), policyText())
    write(join(top, 'sub', POLICY), policyText(deny('Bash')))
    git(top, 'add', '.'); git(top, 'commit', '-q', '-m', 'committed')
    const root = join(top, 'sub')
    write(join(root, POLICY), policyText(allow('*')))
    const h = harness()
    expect(h.denied(root, 'Bash')).toBe(true)
    expect(committedBlobArgs(root, '.oxespace/policy.json')).toEqual(['--no-pager', '-c', 'core.fsmonitor=', '-C', root, 'cat-file', 'blob', 'HEAD:./.oxespace/policy.json'])
  })

  it('8. a worktree: inherits a primary row; with none, the primary\'s file and HEAD restrict it; a committed allow * on its branch asks', async () => {
    const { root: primary } = repo({ [POLICY]: policyText(deny('Bash')) })
    // The primary's working file gains a deny nobody has read yet (no row for the primary).
    write(join(primary, POLICY), policyText(deny('Bash'), deny('mcp__primary_only')))
    const worktree = join(temp('oxe-fs-wt-'), 'wide')
    git(primary, 'worktree', 'add', '-q', '-b', 'wide', worktree, 'HEAD')
    write(join(worktree, POLICY), policyText(allow('*')))
    git(worktree, 'commit', '-q', '-am', 'allow everything')
    const h = harness()
    expect(h.denied(worktree, 'Bash')).toBe(true)
    expect(h.denied(worktree, 'mcp__primary_only')).toBe(true)
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    expect(h.requests()[0].risk).toBe('critical')
  })

  it('9. upgrade: the all-roots sweep of a tools/call applies the floor and parks; a launch asks once, a deny-only project never', async () => {
    const wide = temp('oxe-fs-wide-')
    write(join(wide, POLICY), policyText(deny('mcp__oxespace__oxespace_db_execute'), allow('mcp__x')))
    const narrow = temp('oxe-fs-narrow-')
    write(join(narrow, POLICY), policyText(deny('mcp__oxespace__oxespace_git_change')))
    const h = harness()
    const ctx = { workspaceServ: { list: () => [{ rootPath: wide }, { rootPath: narrow }], get: () => undefined } } as unknown as Parameters<typeof toolCallBlocked>[1]
    expect(toolCallBlocked('oxespace_db_execute', ctx)).toBeDefined()
    expect(toolCallBlocked('oxespace_git_change', ctx)).toBeDefined()
    await h.settle()
    expect(h.requests()).toHaveLength(0)
    // The project's own launch (a review point) raises its one request.
    h.gate.reviewPoint(h.store.subjects(wide))
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    h.gate.reviewPoint(h.store.subjects(narrow))
    await h.settle()
    expect(h.requests()).toHaveLength(1)
  })

  it('10. the user layer: its denies apply at once, an env: allow asks critical, and Deny keeps the denies', async () => {
    const userData = temp('oxe-fs-userlayer-')
    write(join(userData, 'policy.json'), policyText(deny('Bash'), allow('env:GH', 'integration.use')))
    const h = harness({ userData })
    expect(h.denied('', 'Bash')).toBe(true)
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    expect(h.requests()[0].risk).toBe('critical')
    await h.answer('deny')
    expect(h.denied('', 'Bash')).toBe(true)
  })

  it('12. registration: ThreadProjectService.add leaves the accepted version before it returns', async () => {
    const root = temp('oxe-fs-reg-')
    write(join(root, POLICY), policyText(deny('Bash')))
    const h = harness()
    await new ThreadProjectService(h.db).add(root)
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM accepted_project_config WHERE file = 'policy'").get()).toEqual({ n: 1 })
    // A write right after it is a change against that version.
    write(join(root, POLICY), policyText(allow('*')))
    expect(h.denied(root, 'Bash')).toBe(true)
    await h.settle()
    expect(h.requests()).toHaveLength(1)
    expect(toolConfigSubject(root)).not.toBeNull()
  })

  it('13. the HEAD read runs nothing the repository configures (textconv, fsmonitor) and without GIT_*', async () => {
    const top = temp('oxe-fs-hard-')
    git(top, 'init', '-q')
    const marker = join(top, 'MARKER')
    const command = `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`
    git(top, 'config', 'core.fsmonitor', command)
    git(top, 'config', 'diff.x.textconv', command)
    write(join(top, '.gitattributes'), '*.json diff=x\n')
    write(join(top, POLICY), policyText(deny('Bash')))
    git(top, '-c', 'core.fsmonitor=', 'add', '.'); git(top, '-c', 'core.fsmonitor=', 'commit', '-q', '-m', 'c')
    rmSync(marker, { force: true })
    write(join(top, POLICY), policyText(allow('*')))
    const h = harness()
    expect(h.denied(top, 'Bash')).toBe(true)
    await h.settle()
    expect(existsSync(marker)).toBe(false)
    expect(Object.keys(gitEnvironment({ GIT_DIR: '/x', GIT_CONFIG_PARAMETERS: "'core.pager=evil'", PATH: '/bin' }))).toEqual(['PATH'])
  })
})

describe('14. guard: first sight never accepts anything that grants', () => {
  it('the floor holds only restrictions, keeps every reference\'s, and what applies unasked is deny-only', () => {
    let seed = 7
    const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const resources = ['Bash', 'mcp__a', 'mcp__a__*', '*', 'env:*', 'net:x']
    const anyRule = (): PolicyRule => ({ effect: random() < 0.5 ? 'deny' : 'allow', action: random() < 0.7 ? 'tool.use' : 'integration.use', resource: resources[Math.floor(random() * resources.length)] })
    const projection = (): AnyProjection => random() < 0.15 ? { state: 'absent' } : { state: 'value', value: { rules: Array.from({ length: Math.floor(random() * 5) }, anyRule) } }
    for (let round = 0; round < 2_000; round++) {
      const current = projection()
      const others = Array.from({ length: Math.floor(random() * 3) }, projection)
      const { floor } = firstSightFloorOf('policy', current, others)
      const floorRules = floor.state === 'value' ? (floor.value as { rules: PolicyRule[] }).rules : []
      expect(floorRules.every(rule => rule.effect === 'deny')).toBe(true)
      for (const reference of [current, ...others]) {
        if (reference.state !== 'value') continue
        for (const rule of (reference.value as { rules: PolicyRule[] }).rules) {
          if (rule.effect === 'deny') expect(floorRules.some(item => item.action === rule.action && item.resource.toLowerCase() === rule.resource.toLowerCase())).toBe(true)
        }
      }
      if (classify({ file: 'policy', layer: 'project' }, floor, current).applies) {
        const rules = current.state === 'value' ? (current.value as { rules: PolicyRule[] }).rules : []
        expect(rules.every(rule => rule.effect === 'deny')).toBe(true)
      }
    }
  })

  it('oxe.yaml: the floor is never above on demand, and takes the lowest mode of every reference', () => {
    const modes = (data: string, docs: string): AnyProjection => ({ state: 'value', value: {
      orchestration: { mode: 'on-demand', source: 'default' }, app: { mode: 'on-demand', source: 'default' },
      data: { mode: data as never, source: 'project' }, docs: { mode: docs as never, source: 'project' }
    } as never })
    const { floor, missing } = firstSightFloorOf('oxe.yaml', modes('always', 'always'), [modes('off', 'always')])
    expect((floor as { value: Record<string, { mode: string }> }).value.data.mode).toBe('off')
    expect((floor as { value: Record<string, { mode: string }> }).value.docs.mode).toBe('on-demand')
    expect(missing).toEqual(['off\0data'])
  })
})
