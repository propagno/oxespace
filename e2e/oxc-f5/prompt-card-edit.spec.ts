// Frozen end-to-end acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A5 (task T5), in the built app
// with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. A stand-in
// Claude (no paid account) answers a prompt. In the conversation the prompt card sits on the one left axis of the
// 800 px column (AG-11-CRITERIOS-F5 "Regras": BRD-04.column.width; AG-10 §2.1), the header shows only the title, and the
// person edits the prompt from the card (T2's thread.editPrompt): the agent receives the edited text as a new turn.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { existsSync as pbExistsFile, readdirSync as pbReaddir, readFileSync as pbReadFile } from 'node:fs'
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
/** Every key path of a catalog, flattened ("a.b.c" -> text). */
function flatCatalog(ns: string, lang: string): Record<string, string> {
  const walk = (value: unknown, prefix: string): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    typeof item === 'string' ? { [prefix + key]: item } : walk(item, `${prefix}${key}.`)))
  return walk(JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`)), '')
}
/** The key that holds `en` in English and `pt` in pt-BR, or '' (a new pair of words the task adds to both catalogs). */
function pairKey(ns: string, en: string, pt: string): string {
  const english = flatCatalog(ns, 'en'), portuguese = flatCatalog(ns, 'pt-BR')
  return Object.keys(english).find(key => english[key] === en && portuguese[key] === pt) ?? ''
}
/** State and note of one measure of src/design/targets (undefined when absent). SOURCE-TEXT (marked): the target files are data. */
function measureOf(id: string): { state: string; note?: string } | undefined {
  const name = id.split('.')[0].toLowerCase()
  if (!pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))) return undefined
  return (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string; note?: string }> }).measures.find(item => item.id === id)
}
/** The OxeChat brand measures (src/design/targets, OXE-149) that are not enforced and locked yet. SOURCE-TEXT (marked): the target files are data. */
function notEnforced(ids: readonly string[]): string[] {
  const lock = (JSON.parse(pbRead('src/design/targets/enforced.lock.json')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05', 'brd-25'].filter(name => pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))).flatMap(name => (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
// ---- the built app with real services and a stand-in agent (inlined so every task's PR stands alone) ----
// OXESPACE_E2E_MOCK_NATIVE=0: the real main process, database, git and conversations. The agent is a stand-in `claude`
// on PATH, a node script that speaks the CLI's stream-json protocol (the e2e/t53 and Polimento · Aprovações stand-in,
// grown by four steps): per user message it reads scenario.json and, step by step, says a text (an assistant message),
// writes a file in its working folder, lists a plan (a TodoWrite tool use and its result, as the CLI does), asks for a
// tool (control_request can_use_tool) or holds the turn open; it logs every user text it received and every answer.
// No paid account, no network. Linux only: on Windows the app launches only a native .exe.
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
const textOf = message => { const content = message && message.message && message.message.content; return typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block && block.type === 'text').map(block => block.text).join('\n') : '' }
function handle(message) {
  if (message.type === 'control_request') {
    log({ event: 'control', subtype: message.request && message.request.subtype, mode: message.request && message.request.mode })
    const response = message.request && message.request.subtype === 'initialize' ? { commands: [], models: [{ value: 'default', displayName: 'Default' }] } : {}
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } }); return
  }
  if (message.type === 'control_response') {
    const response = message.response || {}, resolve = waiting.get(response.request_id)
    if (resolve) { waiting.delete(response.request_id); resolve(response) }
    return
  }
  if (message.type === 'user') log({ event: 'user', text: textOf(message).slice(0, 4000) })
  if (message.type === 'user' && !busy) { busy = true; turn().finally(() => { busy = false }) }
}
const say = text => out({ type: 'assistant', session_id: session, message: { id: 'msg_' + crypto.randomBytes(8).toString('hex'), role: 'assistant', content: [{ type: 'text', text }] } })
async function turn() {
  const file = path.join(dir, 'scenario.json')
  const steps = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [], mcp_servers: [], model: 'stand-in', claude_code_version: '2.1.0' })
  for (const step of steps) {
    if (step.hold) { log({ event: 'hold' }); await new Promise(() => undefined) }
    if (step.say) { say(step.say); continue }
    if (step.write) { fs.writeFileSync(path.join(process.cwd(), step.write.path), step.write.text); log({ event: 'wrote', path: step.write.path }); continue }
    if (step.plan) {
      const id = 'toolu_' + crypto.randomBytes(8).toString('hex')
      out({ type: 'assistant', session_id: session, message: { id: 'msg_' + crypto.randomBytes(8).toString('hex'), role: 'assistant', content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos: step.plan.map(content => ({ content, status: 'pending', activeForm: content })) } }] } })
      out({ type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Todos have been modified successfully.' }] } })
      continue
    }
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

type StandInEntry = { event: string; tool?: string; behavior?: string; text?: string; args?: string; subtype?: string; mode?: string; path?: string }
interface StandIn { bin: string; env: Record<string, string>; log: () => StandInEntry[]; scenario: (steps: unknown[]) => void }
/** A stand-in `claude` in a folder of its own, and the env that puts it first on PATH with an empty Claude config. */
function standIn(prefix: string): StandIn {
  const root = mkdtempSync(join(tmpdir(), `oxe-${prefix}-`))
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const script = join(bin, 'claude'); writeFileSync(script, STAND_IN); chmodSync(script, 0o755)
  const logFile = join(bin, 'stand-in-log.jsonl')
  return {
    bin,
    env: { OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_LOCALE: 'en-US', PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    log: () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
    scenario: steps => writeFileSync(join(bin, 'scenario.json'), JSON.stringify(steps))
  }
}

/** A real git repository in the demo folder (one committed file, a.txt), so changes and checkpoints are real. */
function gitRepo(root: string): string {
  writeFileSync(join(root, 'a.txt'), 'a\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'init'], { cwd: root })
  return realpathSync.native(root)
}

/** window.oxe.<group>.<fn>(...args) in the page: the same bridge the renderer uses. */
const oxe = <T>(page: Page, path: string, ...args: unknown[]) => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>

/** A conversation of the stand-in Claude in the project, with the access asked and a name. */
async function conversation(page: Page, root: string, title: string, access: 'read-only' | 'workspace-write' | 'full-access'): Promise<{ id: string; projectId: string }> {
  const { projectId } = await oxe<{ projectId: string }>(page, 'thread.addProject', root)
  await oxe(page, 'thread.setNewConversationAccess', access)
  const snap = await oxe<{ thread: { id: string } }>(page, 'thread.create', { projectId, rootPath: root, provider: 'claude' })
  await oxe(page, 'thread.command', snap.thread.id, `/rename ${title}`)
  return { id: snap.thread.id, projectId }
}

/** Sends one message as the window does; a start that fails is tried once more, as a person would press Send again. */
async function sendText(page: Page, threadId: string, text: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const sent = await oxe(page, 'thread.send', threadId, text).then(() => 'ok', e => String(e instanceof Error ? e.message : e))
    if (sent === 'ok') return
    if (attempt === 2) throw new Error(`the stand-in turn could not start: ${sent}`)
    await page.waitForTimeout(3_000)
  }
}

/** The status of the conversation as main reads it. */
const threadStatus = async (page: Page, id: string): Promise<string> => (await oxe<{ thread: { status: string } }>(page, 'thread.read', id)).thread.status

/** The OxeChat view with the conversation open, once the app's mode bar is there. */
async function openConversation(page: Page, id: string): Promise<void> {
  await page.locator('button[data-app-mode="thread"]').first().waitFor({ timeout: 30_000 })
  await page.locator('button[data-app-mode="thread"]').first().click()
  const row = page.locator(`[data-thread-row="${id}"] [data-list-item]`).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
}
test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('OxeChat in the app: right-aligned prompt bubble in the 1080 px column (OXE-401, OXE-441), a quiet header, and Edit prompt sends the edited text as a new turn', async () => {
  test.setTimeout(300_000)
  const agent = standIn('f5-prompt')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark', realClock: true, env: agent.env })
  try {
    await page.locator('button[data-app-mode]').first().waitFor({ timeout: 60_000 })
    await layoutAtWidth(app, page, 1640, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const chat = await conversation(page, root, 'Refund idempotency', 'workspace-write')
    agent.scenario([{ say: 'Which header should carry the key?' }])
    await sendText(page, chat.id, 'Add an idempotency key to refunds')
    await expect.poll(() => threadStatus(page, chat.id), { timeout: 60_000 }).toBe('idle')
    await openConversation(page, chat.id)

    const column = page.locator('[data-ui="chat-column"]')
    await expect(column).toHaveCount(1)
    const prompt = column.locator('[data-ui="prompt-card"]').first()
    await expect(prompt).toContainText('Add an idempotency key to refunds')
    const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!
    const columnBox = await box('[data-ui="chat-column"]')
    // OXE-401: --measure-chat widened from 800px to 1080px
    expect(Math.abs(columnBox.width - 1080), `the column is 1080 px wide (${columnBox.width})`).toBeLessThanOrEqual(1)
    const promptBox = (await prompt.boundingBox())!
    // OXE-441: explicit user decision aligns the user prompt bubble to the right edge of the reading column.
    expect(Math.abs((promptBox.x + promptBox.width) - (columnBox.x + columnBox.width)), 'the prompt bubble aligns flush with the column\'s right edge').toBeLessThanOrEqual(1)
    expect(promptBox.x, 'the prompt bubble sits to the right of the column\'s left edge').toBeGreaterThan(columnBox.x)
    expect(promptBox.width, 'the prompt bubble is narrower than the full 1080 px column').toBeLessThan(columnBox.width)
    const header = page.locator('[data-ui="chat-header"]')
    await expect(header.locator('[data-ui="chat-title"]')).toHaveText('Refund idempotency')
    await expect(header, 'no agent · project · access line').not.toContainText(/Claude|Can edit/)
    await page.screenshot({ path: test.info().outputPath('f5-prompt-card.png') })

    await prompt.hover()
    await prompt.getByRole('button', { name: 'Edit prompt' }).click()
    const editor = prompt.getByRole('textbox')
    await expect(editor).toHaveValue('Add an idempotency key to refunds')
    await editor.fill('Add an idempotency key to refunds, read from the Idempotency-Key header')
    await prompt.getByRole('button', { name: cat('thread', 'composer.send') }).click()
    await expect.poll(() => agent.log().filter(entry => entry.event === 'user').map(entry => entry.text ?? ''), { timeout: 60_000 })
      .toEqual([expect.stringContaining('Add an idempotency key to refunds'), expect.stringContaining('read from the Idempotency-Key header')])
    await expect(column.locator('[data-ui="prompt-card"]'), 'the edited turn stays in the history').toHaveCount(2, { timeout: 30_000 })
    await expect(column.locator('[data-ui="prompt-card"]').first(), 'marked as edited, resent below').toContainText('Edited · resent below')
    await expect.poll(() => threadStatus(page, chat.id), { timeout: 60_000 }).toBe('idle')
    await expect(column.locator('[data-ui="prompt-card"]').first().getByRole('button', { name: 'Edit prompt' }), 'the edited prompt is history: no Edit').toHaveCount(0)
  } finally {
    await app.close()
  }
})
