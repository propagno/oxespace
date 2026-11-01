import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { setToolGroupMode } from '../../electron/main/services/mcp-tool-groups'
import { setToolRule } from '../../electron/main/services/mcp-tool-rules'
import { policyDeniedToolNames, setAcceptedConfig, setPolicyStore } from '../../electron/main/services/policy'
import { AcceptedConfig } from '../../electron/main/services/policy/accepted-config'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import { effectiveToolConfig, toolConfigSubject } from '../../electron/main/services/policy/tool-config'
import type { ApprovalRequest } from '../../shared/types/approvals'
import { removeTempDir } from '../helpers/removeTempDir'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const dirs: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  setAcceptedConfig(null)
  setPolicyStore(null)
  for (const db of databases.splice(0)) db.close()
  for (const dir of dirs.splice(0)) removeTempDir(dir)
})

const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir }
const rule = (effect: 'allow' | 'deny', resource: string) => ({ effect, action: 'tool.use', resource })
const policyText = (...rules: unknown[]) => JSON.stringify({ rules }, null, 2) + '\n'
const DB_EXECUTE = 'mcp__oxespace__oxespace_db_execute'
let clock = 1_700_000_000

/** A project with a real database, policy store, approval center and file service; the window is the test. */
function project(options: { managedProtected?: boolean; timeoutMs?: number; root?: string } = {}) {
  const root = options.root ?? temp('oxe-b74-')
  const userData = temp('oxe-b74-user-')
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const center = new ApprovalCenter({ send: () => undefined, hasWindow: () => true, native: () => new Promise(() => undefined), ackTimeoutMs: 600_000, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) })
  const notices: string[] = []
  const gate = new AcceptedConfig({ db, quietMs: 0, reissueMs: 0, managedProtected: () => options.managedProtected ?? false })
  gate.connect({
    ask: (draft, signal, onAsked) => center.ask(draft, signal, onAsked),
    reissue: (id, draft) => center.reissue(id, draft),
    notify: (_subject, message) => notices.push(message.code),
    readText: (path, max) => { try { return readFileSync(path, 'utf8').slice(0, max) } catch { return null } }
  })
  setAcceptedConfig(gate)
  const managed = join(userData, 'managed.json')
  const store = new PolicyStore({ userData, managed })
  setPolicyStore(store)
  const files = new FileSystemService((id, requested) => (id === 'A' && requested === root ? root : null))
  const policyFile = join(root, '.oxespace', 'policy.json')
  /** Writes like an outside program, and moves the times on so every write is a new stat key. */
  const write = (path: string, text: string | null) => {
    if (text === null) { rmSync(path, { force: true }); return }
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
    clock += 10
    utimesSync(path, clock, clock)
  }
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 5)); await gate.idle(); await new Promise(resolve => setTimeout(resolve, 5)); await gate.idle() }
  /** Reads like every security reader does (a tools/call, a launch), then lets the comparison run. */
  const read = async () => { const denied = policyDeniedToolNames(root); await settle(); return denied }
  const requests = () => center.list()
  const answer = async (optionId: 'deny' | 'allowPolicy', request: ApprovalRequest = center.list()[0]) => {
    center.ack({ id: request.id, generation: request.generation, visible: true, focused: true })
    const result = center.respond({ id: request.id, generation: request.generation, optionId })
    await settle()
    return result
  }
  return { root, userData, db, center, gate, store, files, policyFile, managed, notices, write, settle, read, requests, answer }
}

/** Accepted at first sight: a policy with one deny (and data off in oxe.yaml when asked). */
async function accepted(options: Parameters<typeof project>[0] & { yaml?: string } = {}) {
  const context = project(options)
  context.write(context.policyFile, policyText(rule('deny', DB_EXECUTE)))
  if (options.yaml) context.write(join(context.root, 'oxe.yaml'), options.yaml)
  await context.read()
  if (options.yaml) effectiveToolConfig(context.root)
  await context.settle()
  expect(context.requests()).toHaveLength(0)
  return context
}

describe('B7.4 · an outside change to the project policy applies only once accepted', () => {
  it('first sight against the defaults: a policy with denies only applies silently', async () => {
    const { read, requests, db } = await accepted()
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()).toHaveLength(0)
    expect(db.prepare('SELECT accepted_via FROM accepted_project_config').all()).toEqual([{ accepted_via: 'baseline-default' }])
  })

  it('first sight: an allow that can pass a secret asks, and the denies apply meanwhile', async () => {
    const { write, policyFile, read, requests } = project()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), { effect: 'allow', action: 'integration.use', resource: 'env:*' }))
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()).toHaveLength(1)
  })

  it('an outside widening asks, and the old rules keep applying until it is answered', async () => {
    const { write, policyFile, read, requests } = await accepted()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('allow', 'mcp__oxespace__oxespace_list_*')))
    expect(await read()).toContain(DB_EXECUTE)
    const [request] = requests()
    expect(request).toMatchObject({ kind: 'policyChange', risk: 'high', defaultOptionId: 'deny', requester: { kind: 'app' }, target: '.oxespace/policy.json', ackRequired: true })
    expect(request.summary.code).toBe('approvals.summary.policyChange.widened')
    expect(request.appNotes.map(note => note.code)).toContain('approvals.note.policy.allowAdded')
    expect(request.agentText.text).toContain('oxespace_list_*')
  })

  it('accept applies it; the file is never rewritten', async () => {
    const { write, policyFile, read, answer, store, root } = await accepted()
    const text = policyText(rule('allow', 'mcp__oxespace__oxespace_list_*'), rule('deny', DB_EXECUTE))
    write(policyFile, text)
    await read()
    expect((await answer('allowPolicy')).ok).toBe(true)
    expect(store.load(root).sources[0].rules).toEqual([rule('allow', 'mcp__oxespace__oxespace_list_*'), rule('deny', DB_EXECUTE)])
    expect(readFileSync(policyFile, 'utf8')).toBe(text)
  })

  it('deny keeps the old rules, marks the content rejected and does not ask again for it', async () => {
    const { write, policyFile, read, answer, requests, store, root, notices } = await accepted()
    const wide = policyText(rule('allow', '*'))
    write(policyFile, wide)
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()[0].risk).toBe('critical')
    await answer('deny')
    expect(notices).toContain('policy.result.kept')
    expect(await read()).toContain(DB_EXECUTE)
    write(policyFile, wide)
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()).toHaveLength(0)
    expect(store.changes(root)).toMatchObject([{ layer: 'project', file: 'policy', state: 'rejected' }])
  })

  it('a missing or invalid file counts as a change; the accepted rules apply meanwhile', async () => {
    const { write, policyFile, read, requests, answer } = await accepted()
    write(policyFile, null)
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()[0].summary.code).toBe('approvals.summary.policyChange.deleted')
    await answer('deny')
    write(policyFile, '{ "rules": [ { "effect": "allow", ')
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()[0].summary.code).toBe('approvals.summary.policyChange.invalid')
    expect(requests()[0].options.map(option => option.id)).toEqual(['deny'])
    await answer('deny')
    // Too large is invalid too (the same projection): kept out by that Deny, so it is shown in a project of its own.
    write(policyFile, JSON.stringify({ rules: [], note: 'x'.repeat(300 * 1024) }))
    expect(await read()).toContain(DB_EXECUTE)
    expect(requests()).toHaveLength(0)
    const fresh = await accepted()
    fresh.write(fresh.policyFile, JSON.stringify({ rules: [], note: 'x'.repeat(300 * 1024) }))
    expect(await fresh.read()).toContain(DB_EXECUTE)
    expect(fresh.requests()[0].summary.code).toBe('approvals.summary.policyChange.tooLarge')
    expect(fresh.requests()[0].options.map(option => option.id)).toEqual(['deny'])
  })

  it('a pure narrowing applies at once with a notice, and asks nothing', async () => {
    const { write, policyFile, read, requests, notices } = await accepted()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('deny', 'mcp__oxespace__oxespace_git_change')))
    await read()
    expect(await read()).toContain('mcp__oxespace__oxespace_git_change')
    expect(requests()).toHaveLength(0)
    expect(notices).toEqual(['policy.narrowed'])
  })

  it('a mixed change that splits applies its stricter part at once and asks about the rest', async () => {
    const { write, policyFile, read, requests, answer, store, root } = await accepted()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('deny', 'mcp__new')))
    await read() // accepted: [deny db_execute, deny new]
    write(policyFile, policyText(rule('deny', 'mcp__new'), rule('deny', 'mcp__stricter'), rule('allow', 'mcp__wider')))
    const denied = await read()
    expect(await read()).toEqual(expect.arrayContaining([DB_EXECUTE, 'mcp__new', 'mcp__stricter']))
    expect(denied).toBeDefined()
    const [request] = requests()
    expect(request.summary.code).toBe('approvals.summary.policyChange.partial')
    expect(request.appNotes.map(note => note.code)).toEqual(expect.arrayContaining(['approvals.note.policy.denyRemoved', 'approvals.note.policy.allowAdded', 'approvals.note.policy.denyAdded.applied']))
    await answer('deny')
    // Deny keeps the accepted rules plus what already applies.
    expect(store.load(root).sources[0].rules.map(item => item.resource)).toEqual([DB_EXECUTE, 'mcp__new', 'mcp__stricter'])
  })

  it('a mixed change that does not split applies nothing early', async () => {
    const { write, policyFile, read, requests } = await accepted()
    write(policyFile, policyText(rule('deny', 'mcp__oxespace__oxespace_db_*'), rule('allow', 'mcp__wider')))
    expect(await read()).toEqual([DB_EXECUTE])
    expect(requests()[0].appNotes.map(note => note.code)).toEqual(expect.arrayContaining(['approvals.note.policy.ruleEdited', 'approvals.note.policy.notSplit']))
    expect(requests()[0].summary.code).toBe('approvals.summary.policyChange.widened')
  })

  it('a rewrite while the request waits re-issues the same request with the next generation', async () => {
    const { write, policyFile, read, requests } = await accepted()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('allow', 'mcp__one')))
    await read()
    const [first] = requests()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('allow', 'mcp__two')))
    await read()
    expect(requests()).toHaveLength(1)
    expect(requests()[0]).toMatchObject({ id: first.id, generation: 2 })
    expect(requests()[0].agentText.text).toContain('mcp__two')
  })

  it('an answer bound to a version that changed meanwhile is refused and asked again', async () => {
    const { write, policyFile, read, gate, store, root, db } = await accepted()
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('allow', 'mcp__one')))
    await read()
    const [change] = store.changes(root)
    // Another window accepted something else meanwhile.
    db.prepare("UPDATE accepted_project_config SET projection_hash = 'other'").run()
    const subject = gate.subject('policy', 'project', root, policyFile)
    expect(() => gate.accept(subject, change.baseHash, change.newHash)).toThrow('policy.change.baseChanged')
  })

  it('an expired request is not a rejection: it is asked again at the next review point, not in a loop', async () => {
    const { write, policyFile, read, requests, gate, store, root } = await accepted({ timeoutMs: 60 })
    write(policyFile, policyText(rule('allow', 'mcp__x'), rule('deny', DB_EXECUTE)))
    await read()
    expect(requests()).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 120))
    await read()
    expect(requests()).toHaveLength(0)
    expect(store.changes(root)).toMatchObject([{ state: 'pending' }])
    gate.reviewPoint(store.subjects(root))
    await read()
    expect(requests()).toHaveLength(1)
  })

  it('a worktree with no accepted version starts from its primary checkout\'s', async () => {
    const primary = temp('oxe-b74-repo-')
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' })
    git(primary, 'init', '-q')
    const { write, policyFile, read, requests, store } = await accepted({ root: primary })
    git(primary, 'add', '.'); git(primary, 'commit', '-q', '-m', 'accepted')
    const worktree = join(temp('oxe-b74-wt-'), 'wide')
    git(primary, 'worktree', 'add', '-q', '-b', 'wide', worktree, 'HEAD')
    write(join(worktree, '.oxespace', 'policy.json'), policyText(rule('allow', 'mcp__oxespace__oxespace_db_*')))
    expect(policyDeniedToolNames(worktree)).not.toContain('mcp__oxespace__oxespace_db_*')
    await read()
    const decision = store.decide('tool.use', DB_EXECUTE, worktree)
    expect(decision.allowed).toBe(false)
    expect(requests().map(request => request.summary.code)).toContain('approvals.summary.policyChange.worktree')
    expect(policyFile).toBeTruthy()
  })

  it('the managed layer is gated while people on this computer can write it, and not when it is protected', async () => {
    const gated = await accepted()
    gated.write(gated.managed, policyText(rule('deny', 'mcp__managed')))
    await gated.read()
    gated.write(gated.managed, policyText(rule('allow', '*')))
    expect(gated.store.decide('tool.use', 'mcp__managed', gated.root).allowed).toBe(false)
    await gated.settle()
    expect(gated.requests()[0].title.code).toBe('approvals.title.policyChangeManaged')
    expect(gated.requests()[0].appNotes.map(note => note.code)).toContain('approvals.note.policy.managedNotProtected')

    const protectedOne = await accepted({ managedProtected: true })
    protectedOne.write(protectedOne.managed, policyText(rule('deny', 'mcp__managed')))
    expect(protectedOne.store.decide('tool.use', 'mcp__managed', protectedOne.root).allowed).toBe(false)
    protectedOne.write(protectedOne.managed, policyText(rule('allow', '*')))
    expect(protectedOne.store.decide('tool.use', 'mcp__managed', protectedOne.root).allowed).toBe(true)
    await protectedOne.settle()
    expect(protectedOne.requests()).toHaveLength(0)
  })
})

describe('B7.4 · the app\'s own writes', () => {
  it('Settings › Tools per tool applies directly, recorded as an app write', async () => {
    const { db, files, root, read, requests } = await accepted()
    await setToolRule({ db, files, policy: undefined }, { rootPath: root, server: 'github', tool: 'delete_repository', decision: 'deny' })
    expect(await read()).toEqual(expect.arrayContaining([DB_EXECUTE, 'mcp__github__delete_repository']))
    expect(requests()).toHaveLength(0)
    expect(db.prepare("SELECT accepted_via, intent_hash FROM accepted_project_config WHERE file = 'policy'").get()).toEqual({ accepted_via: 'app-write', intent_hash: null })
  })

  it('Settings › Tools groups apply directly; oxe.yaml\'s modes are gated like the policy', async () => {
    const { db, files, root, write, settle, requests, answer } = await accepted({ yaml: 'thread:\n  tools:\n    data: "off"\n' })
    expect(effectiveToolConfig(root).modes.data.mode).toBe('off')
    await setToolGroupMode(db, files, { rootPath: root, group: 'docs', mode: 'off' })
    await settle()
    expect(effectiveToolConfig(root).modes.docs.mode).toBe('off')
    expect(requests()).toHaveLength(0)
    // git checkout of a permissive version: still off, and asked.
    write(join(root, 'oxe.yaml'), 'thread:\n  tools:\n    data: always\n    app: always\n')
    expect(effectiveToolConfig(root).modes.data.mode).toBe('off')
    await settle()
    expect(requests()[0]).toMatchObject({ risk: 'critical', summary: { code: 'approvals.summary.policyChange.widened', params: { file: 'oxe.yaml' } } })
    await answer('deny')
    expect(effectiveToolConfig(root)).toMatchObject({ modes: { data: { mode: 'off' }, docs: { mode: 'off' } }, change: { state: 'rejected' } })
  })

  it('a pending change blocks every app write to the project\'s gated files, and nothing is recorded as accepted', async () => {
    const { db, files, root, write, settle, requests, policyFile } = await accepted({ yaml: 'thread:\n  tools:\n    data: "off"\n' })
    write(join(root, 'oxe.yaml'), 'thread:\n  tools:\n    data: on-demand\n    docs: always\n')
    effectiveToolConfig(root)
    await settle()
    expect(requests()).toHaveLength(1)
    await expect(setToolGroupMode(db, files, { rootPath: root, group: 'app', mode: 'off' })).rejects.toThrow('policy.change.pending')
    await expect(setToolRule({ db, files, policy: undefined }, { rootPath: root, server: 'github', tool: 'x', decision: 'deny' })).rejects.toThrow('policy.change.pending')
    expect(readFileSync(join(root, 'oxe.yaml'), 'utf8')).toContain('docs: always')
    expect(readFileSync(policyFile, 'utf8')).not.toContain('mcp__github__x')
    expect(effectiveToolConfig(root).modes).toMatchObject({ data: { mode: 'off' }, docs: { mode: 'on-demand' } })
    expect(toolConfigSubject(root)).not.toBeNull()
  })

  it('an intent left by a crash before the rename is cleared; one whose content landed is promoted silently', async () => {
    const { gate, root, policyFile, write, read, requests } = await accepted()
    const subject = gate.subject('policy', 'project', root, policyFile)
    const landed = { state: 'value' as const, value: { rules: [rule('deny', DB_EXECUTE), rule('deny', 'mcp__crash')] as never } }
    gate.markIntent(subject, landed)
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('deny', 'mcp__crash')))
    expect(await read()).toContain('mcp__crash')
    expect(requests()).toHaveLength(0)
  })
})

describe('B7.4 · SECURITY review of #372', () => {
  it('H1: at first sight the denies in force are the accepted version before asking, and Deny keeps them', async () => {
    const { write, policyFile, read, requests, answer, store, root } = project()
    write(policyFile, policyText(rule('deny', 'Bash'), { effect: 'allow', action: 'integration.use', resource: 'env:GITHUB_TOKEN' }))
    expect(await read()).toContain('Bash')
    const [request] = requests()
    expect(request.summary.code).toBe('approvals.summary.policyChange.partial')
    expect(request.risk).toBe('critical')
    await answer('deny')
    expect(await read()).toContain('Bash')
    expect(store.load(root).sources[0].rules).toEqual([rule('deny', 'Bash')])
  })

  it('H2: a 127 KB policy whose widening line is last is cut by the center and offers Deny only, with that line first', async () => {
    const { write, policyFile, read, requests } = await accepted()
    const padding = Array.from({ length: 480 }, (_, index) => rule('allow', `mcp__padding_${index}_${'x'.repeat(170)}`))
    const text = policyText(rule('deny', DB_EXECUTE), ...padding, { effect: 'allow', action: 'integration.use', resource: 'env:*' })
    expect(text.length).toBeGreaterThan(110 * 1024)
    expect(text.length).toBeLessThan(256 * 1024)
    write(policyFile, text)
    expect(await read()).toContain(DB_EXECUTE)
    const [request] = requests()
    expect(request.agentText).toMatchObject({ truncated: true, length: text.length })
    expect(request.options.map(option => option.id)).toEqual(['deny'])
    expect(request.risk).toBe('critical')
    expect(request.appNotes[0]).toEqual({ code: 'approvals.note.policy.allowAdded', params: { rule: 'integration env:*' } })
  })

  it('M2: a file swapped between the read that found it and the one that shows it is never shown or accepted', async () => {
    const { write, policyFile, read, requests, settle, root } = await accepted()
    write(policyFile, policyText(rule('allow', '*')))
    policyDeniedToolNames(root)
    // Swapped before the request is built: the shown text would not be the version an Allow records.
    write(policyFile, policyText(rule('deny', DB_EXECUTE), rule('deny', 'mcp__swapped')))
    await settle()
    expect(requests()).toHaveLength(0)
    await read()
    expect(await read()).toContain('mcp__swapped')
    expect(requests()).toHaveLength(0)
  })

  it('M4: a worktree keeps its primary\'s version as its own, so deleting its .git file and restarting does not reset it', async () => {
    const primary = temp('oxe-b74-repo-')
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' })
    git(primary, 'init', '-q')
    const first = await accepted({ root: primary })
    git(primary, 'add', '.'); git(primary, 'commit', '-q', '-m', 'accepted')
    const worktree = join(temp('oxe-b74-wt-'), 'kept')
    git(primary, 'worktree', 'add', '-q', '-b', 'kept', worktree, 'HEAD')
    expect(await first.read()).toContain(DB_EXECUTE)
    expect(first.store.decide('tool.use', DB_EXECUTE, worktree).allowed).toBe(false)
    await first.settle()
    expect(first.db.prepare("SELECT accepted_via FROM accepted_project_config WHERE accepted_via = 'inherited'").all()).toHaveLength(1)
    // The agent deletes the worktree's .git file; the app restarts (a new gate over the same database).
    rmSync(join(worktree, '.git'), { force: true })
    const gate = new AcceptedConfig({ db: first.db, quietMs: 0, reissueMs: 0, managedProtected: () => false })
    const asked: string[] = []
    gate.connect({ ask: async draft => { asked.push(draft.summary.code); return { intent: 'deny', optionId: 'deny', by: 'timeout' } } })
    setAcceptedConfig(gate)
    const store = new PolicyStore({ userData: first.userData, managed: first.managed })
    setPolicyStore(store)
    first.write(join(worktree, '.oxespace', 'policy.json'), policyText(rule('allow', 'mcp__oxespace__oxespace_db_*')))
    expect(store.decide('tool.use', DB_EXECUTE, worktree).allowed).toBe(false)
    await gate.idle()
    expect(asked).toHaveLength(1)
    expect(store.decide('tool.use', DB_EXECUTE, worktree).allowed).toBe(false)
  })
})

