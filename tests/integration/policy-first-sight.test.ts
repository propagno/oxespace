import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { setAcceptedConfig, setPolicyStore } from '../../electron/main/services/policy'
import { AcceptedConfig, committedBlobArgs, firstSightFloorOf, gitEnvironment, SAFE_GIT_OPTIONS, type AnyProjection } from '../../electron/main/services/policy/accepted-config'
import { McpConfigSync } from '../../electron/main/services/mcp-sync.service'
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
    expect(committedBlobArgs(root, '.oxespace/policy.json')).toEqual([...SAFE_GIT_OPTIONS, '-C', root, 'cat-file', 'blob', 'HEAD:./.oxespace/policy.json'])
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

  it('13. the HEAD read never lazy-fetches in a partial clone, so a repo-configured transport (core.sshCommand) never runs', async () => {
    const top = temp('oxe-fs-promisor-')
    git(top, 'init', '-q')
    const marker = join(temp('oxe-fs-marker-'), 'MARKER').replace(/\\/g, '/')
    const script = join(temp('oxe-fs-script-'), 'transport.js').replace(/\\/g, '/')
    writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(marker)}, 'x'); process.exit(1)\n`)
    // A promisor repo whose HEAD names a blob it does not have: reading it would fetch from "origin" over ssh.
    for (const [name, value] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.promisor', 'true'],
      ['remote.origin.url', 'ssh://example.invalid/repo'], ['core.sshCommand', `node "${script}"`], ['protocol.ssh.allow', 'always']]) git(top, 'config', name, value)
    const run = (args: string[], input?: string) => execFileSync('git', ['-C', top, ...args], { input, encoding: 'utf8', env: gitEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    const blob = run(['hash-object', '--stdin'], policyText(deny('Bash')))
    const folder = run(['mktree', '--missing'], `100644 blob ${blob}\tpolicy.json\n`)
    const tree = run(['mktree', '--missing'], `040000 tree ${folder}\t.oxespace\n`)
    const commit = run(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit-tree', tree, '-m', 'missing blob'])
    run(['update-ref', 'HEAD', commit])
    // The repro is live: a plain read of that blob runs the configured transport.
    try { execFileSync('git', ['-C', top, 'cat-file', 'blob', 'HEAD:./.oxespace/policy.json'], { stdio: 'ignore', timeout: 20_000 }) } catch { /* the fetch fails */ }
    expect(existsSync(marker)).toBe(true)
    rmSync(marker, { force: true })
    write(join(top, POLICY), policyText(allow('*')))
    const h = harness()
    expect(h.denied(top, 'Bash')).toBe(false)
    await h.settle()
    expect(existsSync(marker)).toBe(false)
    expect(gitEnvironment({ GIT_DIR: '/x', PATH: '/bin' })).toEqual({ PATH: '/bin', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' })
    expect(SAFE_GIT_OPTIONS).toEqual(expect.arrayContaining(['protocol.allow=never', 'protocol.ext.allow=never', 'protocol.ssh.allow=never', 'protocol.file.allow=never']))
  })
})

describe('14. guard: first sight never accepts anything that grants', () => {
  it('the floor holds only restrictions, keeps every reference\'s, and what applies unasked is deny-only', () => {
    let seed = 7
    const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const resources = ['Bash', 'mcp__a', 'mcp__a__*', '*', 'env:*', 'net:x']
    const anyRule = (): PolicyRule => ({ effect: random() < 0.5 ? 'deny' : 'allow', action: random() < 0.7 ? 'tool.use' : 'integration.use', resource: resources[Math.floor(random() * resources.length)] })
    const projection = (): AnyProjection => random() < 0.1 ? { state: 'invalid' } : random() < 0.15 ? { state: 'absent' } : { state: 'value', value: { rules: Array.from({ length: Math.floor(random() * 5) }, anyRule) } }
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

describe('B7.4 first sight: SECURITY round 4', () => {
  const insertWorkspace = (db: AppDatabase, id: string, root: string) =>
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', 'builtin-claude')").run(id, id, root)

  it('S4-2: the boot sync of every workspace (syncAll) applies the floor and parks; each project asks at its own review point', async () => {
    const wide = temp('oxe-fs-sync-wide-')
    write(join(wide, POLICY), policyText(deny('mcp__oxespace__oxespace_db_execute'), allow('mcp:GitHub', 'integration.use')))
    write(join(wide, 'oxe.yaml'), 'thread:\n  tools:\n    docs: always\n')
    const other = temp('oxe-fs-sync-other-')
    write(join(other, POLICY), policyText(allow('mcp__x')))
    const h = harness()
    insertWorkspace(h.db, 'A', wide)
    insertWorkspace(h.db, 'B', other)
    h.db.prepare("INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at) VALUES ('g', NULL, 'GitHub', 'stdio', '{\"transport\":\"stdio\",\"command\":\"gh\"}', 1, 1, 0, 0)").run()
    h.db.prepare("INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at) VALUES ('o', NULL, 'oxespace', 'stdio', '{\"transport\":\"stdio\",\"command\":\"node\",\"args\":[\"bridge.cjs\"]}', 1, 1, 0, 0)").run()
    new McpConfigSync(h.db).syncAll()
    await h.settle()
    expect(h.requests()).toHaveLength(0)
    expect(h.denied(wide, 'mcp__oxespace__oxespace_db_execute')).toBe(true)
    expect(effectiveToolConfig(wide).modes.docs.mode).toBe('on-demand')
    h.gate.reviewPoint([...h.store.subjects(wide), toolConfigSubject(wide)!])
    await h.settle()
    expect(h.requests()).toHaveLength(2)
    // The first-sight notice: once for the project, when its review is asked, not for each file or the parked sweep.
    expect(h.notices.filter(code => code === 'policy.firstSight.enforced')).toHaveLength(1)
  })

  it('S4-4: relink reads the new folder before it returns', async () => {
    const primary = temp('oxe-fs-relink-')
    git(primary, 'init', '-q')
    write(join(primary, 'README.md'), 'x\n')
    git(primary, 'add', '.'); git(primary, 'commit', '-q', '-m', 'root')
    const moved = join(temp('oxe-fs-relink-moved-'), 'checkout')
    git(primary, 'worktree', 'add', '-q', '-b', 'moved', moved, 'HEAD')
    write(join(moved, POLICY), policyText(deny('Bash')))
    const h = harness()
    const service = new ThreadProjectService(h.db)
    const { projectId } = await service.add(primary)
    const before = (h.db.prepare('SELECT COUNT(*) AS n FROM accepted_project_config').get() as { n: number }).n
    await service.relink(projectId, moved)
    expect((h.db.prepare('SELECT COUNT(*) AS n FROM accepted_project_config').get() as { n: number }).n).toBeGreaterThan(before)
    write(join(moved, POLICY), policyText(allow('*')))
    expect(h.denied(moved, 'Bash')).toBe(true)
  })

  it('S4-4: workspace.create reads the project before it returns (the IPC handler, by its source)', () => {
    const source = readFileSync(join('electron', 'main', 'ipc', 'workspace.ipc.ts'), 'utf8')
    const handler = source.slice(source.indexOf('IPC_CHANNELS.workspace.create,'), source.indexOf('IPC_CHANNELS.workspace.setActive'))
    expect(handler).toMatch(/const created = workspaceService\.create\(parsed\)\s+[^]*firstPolicyRead\(created\.rootPath\)\s+return created/)
  })

  it('S4-4: resolve() never returns, nor records, anything that grants at first sight (policy and oxe.yaml, invalid included)', { timeout: 60_000 }, async () => {
    let seed = 11
    const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const resources = ['Bash', 'mcp__a', '*', 'env:*']
    const anyRule = (): PolicyRule => ({ effect: random() < 0.5 ? 'deny' : 'allow', action: random() < 0.7 ? 'tool.use' : 'integration.use', resource: resources[Math.floor(random() * resources.length)] })
    const mode = () => (['off', 'on-demand', 'always'] as const)[Math.floor(random() * 3)]
    for (let round = 0; round < 40; round++) {
      const h = harness()
      const roll = random()
      const policy: AnyProjection = roll < 0.1 ? { state: 'invalid' } : roll < 0.2 ? { state: 'absent' } : { state: 'value', value: { rules: Array.from({ length: 1 + Math.floor(random() * 4) }, anyRule) } }
      const shown = h.gate.resolve(h.gate.subject('policy', 'user', null, join(h.userData, 'policy.json')), policy)
      const rules = shown.state === 'value' ? (shown.value as { rules: PolicyRule[] }).rules : []
      expect(rules.every(rule => rule.effect === 'deny')).toBe(true)
      const modes = { orchestration: { mode: mode(), source: 'project' }, data: { mode: mode(), source: 'project' }, docs: { mode: mode(), source: 'project' }, app: { mode: mode(), source: 'project' } }
      const root = temp('oxe-fs-fuzz-')
      const yaml: AnyProjection = random() < 0.1 ? { state: 'invalid' } : { state: 'value', value: modes as never }
      const subject = h.gate.subject('oxe.yaml', 'project', root, join(root, 'oxe.yaml'))
      const seen = h.gate.resolve(subject, yaml)
      if (seen.state === 'value') for (const entry of Object.values(seen.value as Record<string, { mode: string }>)) expect(entry.mode).not.toBe('always')
      await h.settle()
      for (const row of h.db.prepare('SELECT projection_json FROM accepted_project_config').all() as { projection_json: string }[]) {
        const accepted = JSON.parse(row.projection_json) as AnyProjection
        if (accepted.state !== 'value') continue
        const value = accepted.value as { rules?: PolicyRule[] } & Record<string, { mode?: string }>
        if (value.rules) expect(value.rules.every(rule => rule.effect === 'deny')).toBe(true)
        else for (const entry of Object.values(value)) expect(entry.mode).not.toBe('always')
      }
      setAcceptedConfig(null); setPolicyStore(null)
      h.db.close(); databases.splice(databases.indexOf(h.db), 1)
    }
  })
})
