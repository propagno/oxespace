// Frozen end-to-end acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-181, AG-09, CA-7 with CA-1, CA-4 and
// CA-5), in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must
// not edit it. A stand-in Claude (no paid account) asks for approval in a conversation the person is not looking at:
// the bell counts it in a neutral count (the pill is the only amber of the top bar), and its entry leads with the
// needs-you sun and says "{project} · OxeChat". The person answers in the conversation's own card: the bell stops
// counting it (it stays in the history, read) and the pill goes back to no number.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The catalog text of `ns:key` (shared/locales/<lang>/<ns>.json, English by default), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}, lang = 'en'): string {
  pbCatalogs[`${lang}/${ns}`] ??= JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`))
  let node: unknown = pbCatalogs[`${lang}/${ns}`]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
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

/** The OxeChat view with `visible` open, so a request of any other conversation arrives in the background. */
async function openConversation(page: Page, visible: Conversation): Promise<void> {
  await page.locator('button[data-app-mode="thread"]').first().click()
  const row = page.locator(`[data-thread-row="${visible.id}"] [data-list-item]`).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
}

/** The computed colour a token resolves to in the page (root scope). */
function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

/** A px length a token (or a calc of tokens) resolves to on the page root. */
function lengthPx(page: Page, value: string): Promise<number> {
  return page.evaluate(expr => {
    const probe = document.createElement('div')
    probe.style.position = 'absolute'
    probe.style.height = expr
    document.body.append(probe)
    const out = probe.getBoundingClientRect().height
    probe.remove()
    return out
  }, value)
}

/** The font family a token resolves to. */
function tokenFont(page: Page, token: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('span')
    probe.style.fontFamily = `var(${name})`
    document.body.append(probe)
    const value = getComputedStyle(probe).fontFamily
    probe.remove()
    return value
  }, token)
}
test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('AG-09 in the app: the bell counts a request in a neutral count with its place, and stops counting it once it is answered in the card', async () => {
  test.setTimeout(300_000)
  const agent = standIn('ag09')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: agent.env })
  try {
    await resizeWindow(app, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const project = await oxe<{ projectId: string; displayName: string }>(page, 'thread.addProject', root)
    await oxe(page, 'thread.setNewConversationAccess', 'read-only')
    const watched = await conversation(page, project.projectId, root, 'Checkout fix')
    const asking = await conversation(page, project.projectId, root, 'Release notes')
    await openConversation(page, watched)
    // The turn stays open after the answer, so what the bell shows next is the answered request, not a finished turn.
    await askForCommand(page, agent.bin, asking.id, 'npm run clean', true)

    const count = page.getByTestId('activity-count')
    await expect(count, 'the bell counts the request').toHaveText('1', { timeout: 90_000 })
    await expect(page.getByTestId('needs-you-pill')).toContainText(/\d/)
    const background = await count.evaluate(node => getComputedStyle(node).backgroundColor)
    for (const token of ['--attn', '--attn-bg', '--attn-fg', '--intent-warning-solid', '--intent-warning-bg']) {
      expect(background, `the count is neutral, not ${token}`).not.toBe(await tokenColor(page, token))
    }

    await page.getByTestId('activity-bell').click()
    const entry = page.getByTestId('activity-item').filter({ hasText: 'Release notes' }).first()
    await expect(entry).toBeVisible()
    await expect(entry.locator('[data-ui="status-signal"][data-state="needs-you"]'), 'the needs-you sun leads the entry').toHaveCount(1)
    await expect(entry.locator('[data-ui="activity-place"]')).toHaveText(`${project.displayName} · OxeChat`)
    await page.screenshot({ path: test.info().outputPath('ag09-activity-bell.png') })
    await page.keyboard.press('Escape')

    await page.locator(`[data-thread-row="${asking.id}"] [data-list-item]`).first().click()
    const card = page.locator('.thread-request-approval').first()
    await expect(card, 'the request card in the conversation').toBeVisible({ timeout: 30_000 })
    await card.getByRole('button', { name: new RegExp(`^${cat('thread', 'request.deny')}`) }).first().click()
    await expect.poll(() => agent.answers().filter(item => item.event === 'answer').map(item => item.behavior), { timeout: 30_000 }).toEqual(['deny'])

    await expect(count, 'answered in the card, the bell stops counting it').toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('needs-you-pill').filter({ hasText: /\d/ }), 'the pill goes back to no number').toHaveCount(0, { timeout: 15_000 })
    await page.getByTestId('activity-bell').click()
    await expect(page.getByTestId('activity-item').filter({ hasText: 'Release notes' }).first(), 'the answered request stays in the history').toBeVisible()
  } finally {
    await app.close()
  }
})
