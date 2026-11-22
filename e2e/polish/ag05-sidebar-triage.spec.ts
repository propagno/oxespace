// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-187, AG-05, CA-5; A27), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. A stand-in Claude (no
// paid account) asks for approval in a conversation of a project the person has collapsed in the OxeChat sidebar: the
// collapsed project's row shows the needs-you signal; "/" goes to the filter, and the "Needs you" chip lists only the
// waiting conversation. Red on main f65fa5374: a collapsed project shows no state and the filter has no chips.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

function cat(ns: string, key: string, vars: Record<string, string> = {}): string {
  let node: unknown = JSON.parse(readFileSync(join(process.cwd(), `shared/locales/en/${ns}.json`), 'utf8'))
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? `{{${name}}}`)
}
// ---- the built app with real services and a stand-in agent (inlined so every task's PR stands alone) ----
// OXESPACE_E2E_MOCK_NATIVE=0: the real main process, real git worktrees, real conversations. The agent is a stand-in
// `claude` on PATH, a node script that speaks the CLI's stream-json protocol and asks for a tool exactly as the real CLI
// does (control_request can_use_tool), the same stand-in as e2e/t53-read-lookups-auto.spec.ts. No paid account, no
// network. Linux only: on Windows the app launches only a native .exe, and a script stand-in is refused there.
const STAND_IN = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const dir = __dirname, args = process.argv.slice(2)
const log = entry => fs.appendFileSync(path.join(dir, 'stand-in-log.jsonl'), JSON.stringify({ at: Date.now(), ...entry }) + '\n')
const out = value => process.stdout.write(JSON.stringify(value) + '\n')
log({ event: 'start', args: args.join(' ').slice(0, 400) })
if (args[0] === '--version' || args[0] === '-v') { process.stdout.write('2.1.0 (Claude Code)\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'stand-in' })); process.exit(0) }
const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const session = at('--session-id') || at('--resume') || crypto.randomUUID()
const waiting = new Map()
let buffer = '', busy = false
process.stdin.on('data', data => {
  buffer += data
  for (let i; (i = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line.trim()) handle(JSON.parse(line)) }
})
process.stdin.on('end', () => process.exit(0))
function handle(message) {
  if (message.type === 'control_request') {
    const response = message.request && message.request.subtype === 'initialize' ? { commands: [], models: [{ value: 'default', displayName: 'Default' }] } : {}
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } }); return
  }
  if (message.type === 'control_response') {
    const response = message.response || {}, resolve = waiting.get(response.request_id)
    if (resolve) { waiting.delete(response.request_id); resolve(response) }
    return
  }
  if (message.type === 'user' && !busy) { busy = true; turn().finally(() => { busy = false }) }
}
async function turn() {
  const steps = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'))
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [], mcp_servers: [], model: 'stand-in', claude_code_version: '2.1.0' })
  for (const step of steps) {
    // A held turn stays open after its answers, as an agent still at work: no result, so no "finished" entry follows.
    if (step.hold) { log({ event: 'hold' }); await new Promise(() => undefined) }
    const id = 'stand-in-' + crypto.randomUUID()
    const answered = new Promise(resolve => waiting.set(id, resolve))
    log({ event: 'ask', tool: step.tool, id, cwd: process.cwd() })
    out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: step.tool, input: step.input || {}, tool_use_id: 'toolu_' + crypto.randomBytes(8).toString('hex') } })
    const response = await answered
    log({ event: 'answer', tool: step.tool, id, behavior: (response.response && response.response.behavior) || response.subtype })
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: 'stand-in turn done', session_id: session, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } })
}
`

interface StandIn { bin: string; env: Record<string, string>; answers: () => Array<{ event: string; tool?: string; behavior?: string; cwd?: string }> }
/** A stand-in `claude` in a folder of its own, and the env that puts it first on PATH with an empty Claude config. */
function standIn(prefix: string): StandIn {
  const root = mkdtempSync(join(tmpdir(), `oxe-${prefix}-`))
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const script = join(bin, 'claude'); writeFileSync(script, STAND_IN); chmodSync(script, 0o755)
  const log = join(bin, 'stand-in-log.jsonl')
  return {
    bin,
    env: { OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_LOCALE: 'en-US', PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    answers: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  }
}

/** A real git repository in the demo folder, so conversations can get worktrees of their own. */
function gitRepo(root: string): string {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
  return realpathSync.native(root)
}

/** window.oxe.<group>.<fn>(...args) in the page: the same bridge the renderer uses. */
const oxe = <T>(page: Page, path: string, ...args: unknown[]) => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>

interface Conversation { id: string; title: string; branch?: string }
/** A conversation of the stand-in Claude in the project, Read only (so a shell command asks), optionally in a worktree, with a name. */
async function conversation(page: Page, projectId: string, root: string, title: string, branch?: string): Promise<Conversation> {
  const snap = await oxe<{ thread: { id: string } }>(page, 'thread.create', { projectId, rootPath: root, provider: 'claude', ...(branch ? { worktree: { branch } } : {}) })
  await oxe(page, 'thread.command', snap.thread.id, `/rename ${title}`)
  return { id: snap.thread.id, title, branch }
}

/** Sends a message the stand-in answers by asking for `command` in Bash (then holding the turn open when `hold`); a start that fails is tried once more. */
async function askForCommand(page: Page, bin: string, threadId: string, command: string, hold = false): Promise<void> {
  writeFileSync(join(bin, 'scenario.json'), JSON.stringify([{ tool: 'Bash', input: { command, description: 'Clean the build output' } }, ...(hold ? [{ hold: true }] : [])]))
  for (let attempt = 1; ; attempt++) {
    const sent = await oxe(page, 'thread.send', threadId, 'Please clean the build output').then(() => 'ok', e => String(e instanceof Error ? e.message : e))
    if (sent === 'ok') return
    if (attempt === 2) throw new Error(`the stand-in turn could not start: ${sent}`)
    await page.waitForTimeout(3_000)
  }
}

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('AG-05 in the app: collapsed project shows needs-you signal and status chip isolates waiting thread', async () => {
  test.setTimeout(300_000)
  const agent = standIn('ag05')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: agent.env })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const project = await oxe<{ projectId: string; displayName: string }>(page, 'thread.addProject', root)
    await oxe(page, 'thread.setNewConversationAccess', 'read-only')
    const waiting = await conversation(page, project.projectId, root, 'Rotate the keys')
    const calm = await conversation(page, project.projectId, root, 'Write the runbook')
    await page.locator('button[data-app-mode="thread"]').first().click()
    await expect(page.locator(`[data-thread-row="${calm.id}"] [data-list-item]`).first()).toBeVisible({ timeout: 30_000 })

    // The person collapses the project, then the agent asks.
    const group = page.locator('[data-ui="sidebar-group"]').filter({ hasText: project.displayName }).first()
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(`[data-thread-row="${waiting.id}"]`)).toHaveCount(0)
    await askForCommand(page, agent.bin, waiting.id, 'npm run clean', true)
    await expect(group.locator('[data-ui="status-signal"][data-state="needs-you"]'), 'the collapsed project says someone needs you').toHaveCount(1, { timeout: 90_000 })

    // "/" goes to the filter; the Needs you chip lists only the waiting conversation.
    await page.locator('.thread-navigation').click({ position: { x: 20, y: 300 } }).catch(() => undefined)
    await page.keyboard.press('/')
    const filter = page.getByRole('searchbox', { name: cat('thread', 'sidebar.filter') })
    await expect(filter).toBeFocused()
    const chips = page.locator('[data-ui="thread-state-chips"]')
    await expect(chips).toBeVisible()
    await chips.getByRole('button', { name: cat('thread', 'status.attention') }).click()
    await expect(chips.getByRole('button', { name: cat('thread', 'status.attention') })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator(`[data-thread-row="${waiting.id}"]`)).toHaveCount(1)
    await expect(page.locator(`[data-thread-row="${calm.id}"]`)).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('ag05-sidebar-triage.png') })
  } finally {
    await app.close()
  }
})
