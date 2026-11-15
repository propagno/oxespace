// Frozen end-to-end acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-180, AG-01, CA-7), in the built app with
// real services (OXESPACE_E2E_MOCK_NATIVE=0) and real git worktrees. Written by the planner; the executor must not edit
// it. Two conversations of the same agent (a stand-in Claude, no paid account) work in worktrees on different
// branches; the person looks at one, and the agent asks to run a destructive command in the other. The floating notice
// must say who asks, in which conversation and on which branch, the exact command, and the catalog's risk (Critical:
// it cannot be undone), with only Deny and See impact. Deny answers the stand-in.
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

test('AG-01 in the app: a request from another conversation names it, its branch and the exact command, with only Deny and See impact', async () => {
  test.setTimeout(300_000)
  const agent = standIn('ag01b')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: agent.env })
  try {
    await resizeWindow(app, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const project = await oxe<{ projectId: string; displayName: string }>(page, 'thread.addProject', root)
    await oxe(page, 'thread.setNewConversationAccess', 'read-only')
    const watched = await conversation(page, project.projectId, root, 'Checkout fix', 'ag01b/checkout')
    const asking = await conversation(page, project.projectId, root, 'Release notes', 'ag01b/release')
    await openConversation(page, watched)

    const command = 'rm -rf ./build/release-ag01b'
    await askForCommand(page, agent.bin, asking.id, command)
    // The harness reached the app's notice (today's polite status already names the agent).
    await expect(page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /Needs you: .* · Claude/ }).first()).toBeVisible({ timeout: 90_000 })

    const notice = page.locator('[data-ui="approval-toast"]')
    await expect(notice, 'the notice in the mould of the card').toBeVisible()
    await expect(notice).toContainText(cat('thread', 'f7.card.needsApproval', { agent: 'Claude' }))
    await expect(notice.locator('[data-ui="approval-toast-conversation"]')).toHaveText(/Release notes/)
    const place = notice.locator('[data-ui="approval-toast-place"]')
    await expect(place).toHaveText(/ag01b\/release/)
    expect(await place.evaluate(node => getComputedStyle(node).fontFamily), 'the branch in --font-mono').toBe(await tokenFont(page, '--font-mono'))
    await expect(notice).not.toContainText('ag01b/checkout')
    await expect(notice).not.toContainText('Checkout fix')

    const exact = notice.locator('[data-ui="approval-toast-command"]')
    expect((await exact.textContent())?.trim(), 'the exact command').toBe(command)
    const risk = notice.locator('[data-ui="risk-label"]')
    await expect(risk).toHaveCount(1)
    await expect(risk).toHaveAttribute('data-risk', 'critical')
    await expect(risk).toHaveText(cat('common', 'approvals.risk.label', { level: cat('common', 'approvals.risk.critical') }))
    expect(await risk.evaluate(node => getComputedStyle(node).backgroundColor), 'critical is the solid danger').toBe(await tokenColor(page, '--intent-danger-solid'))

    await expect(notice.getByRole('button', { name: /allow|approve/i }), 'never a way to allow a critical request').toHaveCount(0)
    await expect(notice.getByRole('button', { name: cat('thread', 'f7.card.seeImpact') })).toBeVisible()
    const copy = notice.getByRole('button', { name: cat('thread', 'approvalDetails.copyExact') })
    const box = (await copy.boundingBox())!
    expect(Math.min(box.width, box.height), 'the copy target is 24 px or more').toBeGreaterThanOrEqual(24)
    await page.screenshot({ path: test.info().outputPath('ag01b-approval-toast.png') })

    await notice.getByRole('button', { name: cat('thread', 'request.deny'), exact: true }).click()
    await expect.poll(() => agent.answers().filter(entry => entry.event === 'answer').map(entry => entry.behavior), { timeout: 30_000 }).toEqual(['deny'])
    await expect(notice).toHaveCount(0)
  } finally {
    await app.close()
  }
})
