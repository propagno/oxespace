// Frozen end-to-end acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-180, POLISH-02 #9 in its comment of
// 15/11), in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must
// not edit it. One vertical dock: the approval notice --space-3 above the status bar (never over it), the toast stack
// above the notice with a --space-2 gap (never the same spot), the notice in --attn-border with --radius-sm. A stand-in
// Claude (no paid account) asks in a conversation the person is not looking at.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'
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

test('POLISH-02 #9 in the app: the approval notice sits above the status bar and the toast stack above the notice', async () => {
  test.setTimeout(300_000)
  const agent = standIn('ag01b-dock')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: agent.env })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const project = await oxe<{ projectId: string }>(page, 'thread.addProject', root)
    await oxe(page, 'thread.setNewConversationAccess', 'read-only')
    const watched = await conversation(page, project.projectId, root, 'Checkout fix')
    const asking = await conversation(page, project.projectId, root, 'Release notes')
    await openConversation(page, watched)
    await askForCommand(page, agent.bin, asking.id, 'npm run clean')

    const notice = page.locator('[data-ui="approval-toast"]')
    await expect(notice).toBeVisible({ timeout: 90_000 })
    const statusBar = page.locator(`footer[aria-label="${cat('code', 'workspace.status.bar')}"]`).first()
    await expect(statusBar).toBeVisible()
    const bar = (await statusBar.boundingBox())!
    const card = (await notice.boundingBox())!
    const gap3 = await lengthPx(page, 'var(--space-3)')
    const gap2 = await lengthPx(page, 'var(--space-2)')
    expect(card.y + card.height, 'the notice never covers the status bar').toBeLessThanOrEqual(bar.y + 0.5)
    expect(Math.abs(bar.y - (card.y + card.height) - gap3), 'the notice sits --space-3 above the status bar').toBeLessThanOrEqual(1)

    const stack = page.getByRole('region', { name: cat('common', 'ui.toast.region') })
    // An empty stack has no height, so its box is read from the page, not from Playwright's visibility-gated boundingBox.
    const above = await stack.evaluate(node => { const r = node.getBoundingClientRect(); return { y: r.y, height: r.height } })
    expect(above.y + above.height, 'the toast stack sits above the notice').toBeLessThanOrEqual(card.y + 0.5)
    expect(Math.abs(card.y - (above.y + above.height) - gap2), 'with a --space-2 gap').toBeLessThanOrEqual(1)

    const paint = await notice.evaluate(node => { const style = getComputedStyle(node); return { border: style.borderTopColor, radius: style.borderTopLeftRadius } })
    expect(paint.border, 'the notice border is --attn-border').toBe(await tokenColor(page, '--attn-border'))
    expect(parseFloat(paint.radius), 'with --radius-sm').toBeCloseTo(await lengthPx(page, 'var(--radius-sm)'), 1)
    await page.screenshot({ path: test.info().outputPath('ag01b-dock.png') })
  } finally {
    await app.close()
  }
})
