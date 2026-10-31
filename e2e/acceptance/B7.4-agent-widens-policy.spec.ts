import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * B7.4 (S1) · An agent cannot widen the project's OXESpace policy without the person.
 * Gated files: .oxespace/policy.json and the security part of oxe.yaml (thread.tools / toolModes, the B7.3 rules).
 * Roadmap acceptance: an outside change that widens them becomes a B10 request (kind policyChange, high risk, the diff of
 * the rules); until it is answered, and after Deny, the accepted rules stay in force; the app's own write never asks.
 *
 * REAL app, no doubles, no agent run. The "agent" is agent.js, started inside the pane's own terminal, so every write
 * comes from a process with that pane's execution env, as a CLI with broad write permission would do it:
 *   1. an editor-style edit of policy.json (temp file, then rename over it) that drops a deny rule;
 *   2. `git checkout HEAD~1 -- oxe.yaml`, which brings back a permissive committed version;
 *   3. an interpreter (python when present, else node) writing policy.json;
 *   4. a narrowing edit (one more deny rule): applies at once, with a notice, no request;
 *   5. the app's own write (Settings › Tools, setToolGroupMode → withToolMode): never asks;
 *   6. the same widened content written again after Deny: does not ask again.
 * Native dialogs are held (never answered) and counted, so nothing reaches the runner's screen.
 * Contract guesses owners may rename: kind 'policyChange', a policy-area incident code, the notice text.
 * Not covered here: expiry (APPROVAL_TIMEOUT_MS is 5 min; an e2e clock hook would let it be tested).
 */
type Req = { id: string; generation: number; kind: string; risk: string; defaultOptionId: string; options: Array<{ id: string; intent: string }>; title: { code: string }; summary: { code: string }; target?: string; [k: string]: unknown }
type Oxe = {
  approvals: { list: () => Promise<Req[]>; history: () => Promise<Array<{ id: string; kind: string; by: string; outcome: string }>>; ack: (i: object) => Promise<unknown>; respond: (i: object) => Promise<{ ok: boolean }> }
  diagnostics: { incidents: () => Promise<Array<{ code: string; area: string; lastAt: number; count: number }>> }
  policy: { get: (id: string) => Promise<unknown> }
  mcpInternal: { toolGroups: (i: object) => Promise<{ groups: Array<{ id: string; mode: string; source: string }> }>; setToolGroupMode: (i: object) => Promise<unknown> }
  workspace: { list: () => Promise<Array<{ id: string }>> }
}
/** Runs `fn(window.oxe, arg)` in the window; a string expression goes through CDP, so the page's CSP does not apply. */
const oxe = <T>(page: Page, fn: (o: Oxe, arg: never) => Promise<T>, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.oxe, ${JSON.stringify(arg ?? null)})`) as Promise<T>

const rule = (effect: string, resource: string) => ({ effect, action: 'tool.use', resource })
const ACCEPTED_POLICY = JSON.stringify({ rules: [rule('deny', 'mcp__oxespace__oxespace_db_execute')] }, null, 2) + '\n'
const WIDE_POLICY = JSON.stringify({ rules: [rule('allow', '*')] }, null, 2) + '\n'
const WIDE_POLICY_2 = JSON.stringify({ rules: [rule('allow', 'mcp__oxespace__*')] }, null, 2) + '\n'
const NARROW_POLICY = JSON.stringify({ rules: [rule('deny', 'mcp__oxespace__oxespace_db_execute'), rule('deny', 'mcp__oxespace__oxespace_git_change')] }, null, 2) + '\n'
const ACCEPTED_YAML = 'thread:\n  tools:\n    data: "off"\n'
const PERMISSIVE_YAML = 'thread:\n  tools:\n    data: always\n    app: always\n'

const AGENT = String.raw`
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const [step, payload, done] = process.argv.slice(2)
const policy = path.join('.oxespace', 'policy.json')
let used = step
try {
  if (step === 'rename-edit') { fs.writeFileSync(policy + '.acc-tmp', fs.readFileSync(payload)); fs.renameSync(policy + '.acc-tmp', policy) }
  else if (step === 'write') fs.writeFileSync(policy, fs.readFileSync(payload))
  else if (step === 'git-checkout') execFileSync('git', ['checkout', 'HEAD~1', '--', 'oxe.yaml'], { stdio: 'ignore' })
  else if (step === 'interpreter') {
    try { execFileSync('python', ['-c', 'import shutil,sys; shutil.copyfile(sys.argv[1], sys.argv[2])', payload, policy], { stdio: 'ignore' }); used = 'python' }
    catch { execFileSync(process.execPath, ['-e', 'require("fs").copyFileSync(process.argv[1], process.argv[2])', payload, policy], { stdio: 'ignore' }); used = 'node -e' }
  }
  fs.writeFileSync(done, JSON.stringify({ ok: true, used, execution: Boolean(process.env.OXESPACE_EXECUTION_ID) }))
} catch (e) { fs.writeFileSync(done, JSON.stringify({ ok: false, used, error: String(e && e.message) })) }
`

test('B7.4: an agent widening the OXESpace policy waits for the person', async () => {
  test.setTimeout(300_000)
  const profile = realProfile('b74p', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=acc@example.invalid', '-c', 'user.name=acc', ...args], { cwd: repo })
  mkdirSync(join(repo, '.oxespace'))
  // HEAD~1 holds a permissive oxe.yaml; HEAD is the accepted state, as a project whose history once had wider rules.
  writeFileSync(join(repo, 'oxe.yaml'), PERMISSIVE_YAML); git('add', '.'); git('commit', '-q', '-m', 'wide')
  writeFileSync(join(repo, 'oxe.yaml'), ACCEPTED_YAML); writeFileSync(join(repo, '.oxespace', 'policy.json'), ACCEPTED_POLICY)
  git('add', '.'); git('commit', '-q', '-m', 'accepted')
  const agent = join(root, 'agent.js'); writeFileSync(agent, AGENT)
  const payload = (name: string, text: string) => { const p = join(root, `${name}.json`); writeFileSync(p, text); return p }

  const { app, page } = await launchReal(profile)
  try {
    await holdNativeDialogs(app)
    await openRepo(page, repo)
    const workspaceId = await oxe(page, o => o.workspace.list().then(l => l[0].id))
    const terminal = page.locator('[data-testid="pane-container"] .xterm').first()
    await terminal.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(2_000)
    const policyText = () => oxe(page, (o, id: string) => o.policy.get(id).then(v => JSON.stringify(v)), workspaceId)
    const groupMode = (group: string) => oxe(page, (o, a: { root: string; group: string }) => o.mcpInternal.toolGroups({ rootPath: a.root }).then(r => r.groups.find(g => g.id === a.group)?.mode), { root: repo, group })
    const pending = () => oxe(page, o => o.approvals.list())
    const incidents = () => oxe(page, o => o.diagnostics.incidents())

    expect(await policyText(), 'the accepted deny rule is in force at start').toContain('oxespace_db_execute')
    expect(await groupMode('data'), 'the accepted oxe.yaml keeps data off at start').toBe('off')
    expect(await pending(), 'nothing is asked at start').toHaveLength(0)

    let step = 0
    const runAgent = async (what: string, file?: string) => {
      const done = join(root, `done-${++step}.json`)
      await terminal.click()
      await page.keyboard.type(`node "${agent}" ${what} "${file ?? '-'}" "${done}"`); await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(done), { timeout: 20_000, message: `agent step ${what} finished` }).toBe(true)
      const result = JSON.parse(readFileSync(done, 'utf8')) as { ok: boolean; used: string; execution: boolean; error?: string }
      expect(result.ok, `agent step ${what} wrote the file (${result.error ?? result.used})`).toBe(true)
      expect(result.execution, 'the agent runs with the pane execution env').toBe(true)
      return result
    }
    /** A widening edit: a policyChange request with the diff, the old rules in force, then Deny keeps them. */
    const expectAskedThenDeny = async (label: string, changed: string, stillInForce: () => Promise<boolean>) => {
      const since = Date.now()
      const before = new Set((await pending()).map(r => r.id))
      let request: Req | undefined
      await expect.soft.poll(async () => {
        request = (await pending()).find(r => !before.has(r.id))
        return request ? request.kind : 'none'
      }, { timeout: 10_000, message: `${label}: the person is asked (B10 policyChange)` }).toBe('policyChange')
      expect.soft(await stillInForce(), `${label}: until the answer, the accepted rules stay in force`).toBe(true)
      if (request) {
        expect.soft(['high', 'critical'], `${label}: high risk`).toContain(request.risk)
        expect.soft(request.options.find(o => o.id === request!.defaultOptionId)?.intent, `${label}: Deny is the default`).toBe('deny')
        expect.soft(request.title.code, `${label}: title is a C3 code`).toMatch(/^[a-z][\w]*(\.[\w]+)+$/)
        const shown = JSON.stringify({ ...request, agentText: undefined })
        expect.soft(shown, `${label}: the app's own text carries the diff of the rules`).toContain(changed)
        await oxe(page, (o, r: Req) => o.approvals.ack({ id: r.id, generation: r.generation, visible: true, focused: true }), request)
        const answer = await oxe(page, (o, r: Req) => o.approvals.respond({ id: r.id, generation: r.generation, optionId: r.defaultOptionId }), request)
        expect.soft(answer.ok, `${label}: Deny is accepted`).toBe(true)
        await page.waitForTimeout(1_000)
        expect.soft(await stillInForce(), `${label}: after Deny the accepted rules stay in force`).toBe(true)
        const entry = (await oxe(page, o => o.approvals.history())).find(h => h.id === request!.id)
        expect.soft(entry?.outcome, `${label}: the decision is in the history`).toBe('deny')
      }
      const journal = (await incidents()).filter(i => i.lastAt >= since && /policy/i.test(`${i.code} ${i.area}`))
      expect.soft(journal.length, `${label}: the outside change is in the incident journal with a C3 code`).toBeGreaterThan(0)
    }

    // (5) The app's own write: Settings › Tools turns docs off through withToolMode. It applies and never asks.
    await oxe(page, (o, root: string) => o.mcpInternal.setToolGroupMode({ rootPath: root, group: 'docs', mode: 'off' }), repo)
    await page.waitForTimeout(3_000)
    expect.soft(await pending(), '(5) the app\'s own write asks nothing').toHaveLength(0)
    expect.soft(await groupMode('docs'), '(5) the app\'s own write applies').toBe('off')
    expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).accNative), '(5) no native dialog').toBe(0)

    // (1) Editor-style edit (temp + rename) dropping the deny rule.
    await runAgent('rename-edit', payload('wide', WIDE_POLICY))
    await expectAskedThenDeny('(1) rename edit of policy.json', '"allow"', async () => (await policyText()).includes('oxespace_db_execute'))

    // (6) The same widened content again after Deny: no second request, the accepted rules still apply.
    const beforeRepeat = (await pending()).length
    await runAgent('write', payload('wide', WIDE_POLICY))
    await page.waitForTimeout(5_000)
    expect.soft((await pending()).length, '(6) the same content after Deny does not ask again').toBe(beforeRepeat)
    expect.soft(await policyText(), '(6) the accepted rules still apply').toContain('oxespace_db_execute')

    // (3) An interpreter writes a different widening.
    const used = await runAgent('interpreter', payload('wide2', WIDE_POLICY_2))
    await expectAskedThenDeny(`(3) ${used.used} writes policy.json`, 'mcp__oxespace__*', async () => (await policyText()).includes('oxespace_db_execute'))

    // (2) git checkout of a permissive committed oxe.yaml.
    await runAgent('git-checkout')
    expect(readFileSync(join(repo, 'oxe.yaml'), 'utf8'), 'the permissive version is on disk').toContain('data: always')
    await expectAskedThenDeny('(2) git checkout -- oxe.yaml', 'data', async () => (await groupMode('data')) === 'off')

    // (4) A narrowing edit: one more deny rule. Applies at once, with a notice, and asks nothing.
    const beforeNarrow = (await pending()).length
    await runAgent('write', payload('narrow', NARROW_POLICY))
    await expect.soft.poll(policyText, { timeout: 5_000, message: '(4) the narrowing applies at once' }).toContain('oxespace_git_change')
    expect.soft((await pending()).length, '(4) a narrowing asks nothing').toBe(beforeNarrow)
    await expect.soft(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: /policy|política/i }).first(), '(4) the person is told the rules got stricter').toBeVisible({ timeout: 5_000 })

    expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).accNative), 'no native dialog while the window is open').toBe(0)
  } finally {
    await quitReal(app)
    // Electron may still hold files in user-data for a moment; a leftover temp folder must not hide the result.
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch { /* left in the temp folder */ }
  }
})

/** Native dialogs never show: message boxes are held unanswered (a person who has not clicked) and counted. */
async function holdNativeDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as Record<string, unknown>; g.accNative = 0
    dialog.showMessageBox = (() => { g.accNative = (g.accNative as number) + 1; return new Promise(() => undefined) }) as typeof dialog.showMessageBox
    dialog.showMessageBoxSync = (() => { g.accNative = (g.accNative as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
  })
}
