// Shared harness of the OxeChat F4 end-to-end acceptance specs (e2e/oxc/*.real.spec.ts), written by the planner with the
// frozen tests (user rule of 15/11: "o design está sendo melhorado 100% o backend deve acompanhar"; each card gets one CA in
// the built app with real services). The executor does not edit it.
// The REAL app (e2e/acceptance/real-app.ts: real main process, real database file, no thread fixture) over a temp git
// repository. No paid run and no account: the agent is a stand-in `claude` on PATH that speaks the CLI's stream-json
// protocol (the same stand-in as e2e/t53-read-lookups-auto.spec.ts): it answers `auth status`, `--version` and
// `initialize`, and on each user message asks for the tools listed in scenario.json (`control_request` / `can_use_tool`),
// logs every answer, then ends the turn. Linux only: on Windows the app launches only a native executable.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchReal, quitReal, realProfile, type RealProfile } from '../acceptance/real-app'

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
  const file = path.join(dir, 'scenario.json')
  const steps = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  out({ type: 'system', subtype: 'init', session_id: session, cwd: process.cwd(), tools: [], mcp_servers: [], model: 'stand-in', claude_code_version: '2.1.0' })
  for (const step of steps) {
    const id = 'stand-in-' + crypto.randomUUID()
    const answered = new Promise(resolve => waiting.set(id, resolve))
    log({ event: 'ask', tool: step.tool, id })
    out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: step.tool, input: step.input || {}, tool_use_id: 'toolu_' + crypto.randomBytes(8).toString('hex') } })
    const response = await answered
    log({ event: 'answer', tool: step.tool, id, behavior: (response.response && response.response.behavior) || response.subtype })
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: 'stand-in turn done', session_id: session, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } })
}
`

export interface RealOxeChat {
  app: ElectronApplication
  page: Page
  profile: RealProfile
  /** The repository the project points at (real path). */
  root: string
  /** The tools the stand-in asks for on the next turn. */
  scenario(steps: Array<{ tool: string; input?: Record<string, unknown> }>): void
  /** What the stand-in logged: its starts, the tools it asked for and the answers it got. */
  log(): Array<{ event: string; tool?: string; behavior?: string }>
  /** The app again over the same profile and database (a restart). */
  restart(): Promise<void>
  close(): Promise<void>
}

/** window.oxe.<group>.<fn>(...args) in the window: the same calls the UI makes. */
export const oxe = <T>(page: Page, path: string, ...args: unknown[]): Promise<T> => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>

export async function launchOxeChat(prefix: string, locale = 'en-US'): Promise<RealOxeChat> {
  const profile = realProfile(prefix, { OXESPACE_LOCALE: locale })
  const bin = join(profile.root, 'bin'); mkdirSync(bin, { recursive: true })
  const standIn = join(bin, 'claude'); writeFileSync(standIn, STAND_IN); chmodSync(standIn, 0o755)
  profile.env.PATH = `${bin}${delimiter}${profile.env.PATH ?? process.env.PATH ?? ''}`
  const logFile = join(bin, 'stand-in-log.jsonl')
  let launched = await launchReal(profile)
  const quiet = async (app: ElectronApplication): Promise<void> => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
  }
  await quiet(launched.app)
  const session: RealOxeChat = {
    get app() { return launched.app },
    get page() { return launched.page },
    profile,
    root: realpathSync.native(profile.repo),
    scenario: steps => writeFileSync(join(bin, 'scenario.json'), JSON.stringify(steps)),
    log: () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [],
    restart: async () => { await quitReal(launched.app); launched = await launchReal(profile); await quiet(launched.app) },
    close: () => quitReal(launched.app)
  }
  return session
}

/** Adds the repository as a project and creates a Claude conversation in it, through the window's real calls. */
export async function conversationIn(chat: RealOxeChat, access: 'read-only' | 'workspace-write' | 'full-access' = 'read-only'): Promise<{ projectId: string; id: string }> {
  const { projectId } = await oxe<{ projectId: string }>(chat.page, 'thread.addProject', chat.root)
  await oxe(chat.page, 'thread.setNewConversationAccess', access)
  const id = (await oxe<{ thread: { id: string } }>(chat.page, 'thread.create', { projectId, rootPath: chat.root, provider: 'claude' })).thread.id
  return { projectId, id }
}

/** Sends one message; a start that fails is tried once more, as a person would press Send again (e2e/t53 trap). */
export async function send(chat: RealOxeChat, id: string, text: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const sent = await oxe(chat.page, 'thread.send', id, text).then(() => 'ok', error => String(error instanceof Error ? error.message : error))
    if (sent === 'ok') return
    if (attempt === 2) throw new Error(`the turn could not start: ${sent}`)
    await chat.page.waitForTimeout(3_000)
  }
}

/** Waits until the conversation has a pending request (the stand-in asked for a tool). */
export async function pendingRequest(chat: RealOxeChat, id: string): Promise<{ id: string; generation: number }> {
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    const snap = await oxe<{ pendingRequests?: Array<{ id: string; generation: number; state?: string }> }>(chat.page, 'thread.read', id)
    const request = (snap.pendingRequests ?? []).find(item => !item.state || item.state === 'pending')
    if (request) return request
    await chat.page.waitForTimeout(500)
  }
  throw new Error('no pending request within 60 s')
}

/** OxeChat mode, with the conversation selected from the sidebar. */
export async function openInOxeChat(chat: RealOxeChat, title: string): Promise<void> {
  await chat.page.locator('button[data-app-mode="thread"]').first().click()
  const row = chat.page.locator('[aria-label="OxeChat sidebar"] [data-ui="sidebar-row"]').filter({ hasText: title }).first()
  await row.waitFor({ timeout: 30_000 })
  await row.click()
}

export const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })
