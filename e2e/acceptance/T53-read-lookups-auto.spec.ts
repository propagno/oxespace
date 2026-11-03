import { expect, test, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * T53 (1.4.1, BACKEND + SECURITY) · Black box, REAL app: in an OxeChat conversation, OXESpace's own read-only lookups
 * (code search, callers, impact, hybrid explore…) are answered without the person when the project has no rule and
 * "Auto-approve reads" is on; a write tool of the same server still asks; a third-party server with a tool of the same
 * name still asks; with "Auto-approve reads" off the lookups ask again. Found by the S5 recorded task on 97120f9c: every
 * lookup stopped on a per-call approval nobody was there to answer.
 *
 * RED until T53's PR lands (the first expectation fails today). Non-blocking: acceptance runs only on dispatch.
 *
 * No paid run, no account: the agent is a stand-in `claude` on PATH that speaks the CLI's stream-json protocol and asks
 * for each tool exactly as the real CLI does (`control_request` / `can_use_tool`, with `--permission-prompt-tool stdio`).
 * It logs every answer it gets. An answer that arrives while the request was never pending in the app is the app's
 * own; a pending request is the app asking the person, and this spec declines it as the person would.
 * Linux only: on Windows the app launches only a native executable (`.exe`), and a script stand-in is refused there.
 */
const SERVER = 'oxespace-delegation'
const READS = ['oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_impact', 'oxespace_hybrid_explore']
const WRITE = 'oxespace_skills_change'
const OTHER = 'mcp__acme-tools__oxespace_code_search'
const mcp = (tool: string) => `mcp__${SERVER}__${tool}`

const STAND_IN = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const dir = __dirname, args = process.argv.slice(2)
const log = entry => fs.appendFileSync(path.join(dir, 'stand-in-log.jsonl'), JSON.stringify({ at: Date.now(), ...entry }) + '\n')
const out = value => process.stdout.write(JSON.stringify(value) + '\n')
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

type Request = { id: string; generation: number; toolName?: string; state?: string }
type Snap = { thread: { id: string }; pendingRequests?: Request[]; turns?: Array<{ status: string }> }
const oxe = <T>(page: Page, path: string, ...args: unknown[]) => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('T53: OXESpace read lookups are answered without the person; writes, other servers and the off switch still ask', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('t53', { OXESPACE_LOCALE: 'en-US' })
  const bin = join(profile.root, 'bin'); mkdirSync(bin, { recursive: true })
  const standIn = join(bin, 'claude'); writeFileSync(standIn, STAND_IN); chmodSync(standIn, 0o755)
  profile.env.PATH = `${bin}${delimiter}${profile.env.PATH ?? process.env.PATH ?? ''}`
  const logFile = join(bin, 'stand-in-log.jsonl')
  const answers = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { event: string; tool: string; id: string; behavior?: string }) : []
  const { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  const responses: string[] = []; out.responses = responses
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    const root = realpathSync.native(profile.repo)
    const { projectId } = await oxe<{ projectId: string }>(page, 'thread.addProject', root)
    const id = (await oxe<Snap>(page, 'thread.create', { projectId, rootPath: root, provider: 'claude' })).thread.id
    out.autoApproveReadsAtStart = await oxe<boolean>(page, 'thread.autoApproveReads')

    /** One turn of the stand-in over `tools`: which the app answered by itself, which it put to the person (declined here). */
    const turn = async (label: string, tools: string[]) => {
      writeFileSync(join(bin, 'scenario.json'), JSON.stringify(tools.map(tool => ({ tool, input: { query: 'applyDiscount' } }))))
      const before = answers().length
      const asked = new Set<string>()
      await oxe(page, 'thread.send', id, `T53 ${label}`)
      const end = Date.now() + 60_000
      while (Date.now() < end) {
        const snap = await oxe<Snap>(page, 'thread.read', id)
        for (const request of (snap.pendingRequests ?? []).filter(r => !r.state || r.state === 'pending')) {
          asked.add(request.toolName ?? request.id)
          // As the person: the window's own answer to a listed request, naming its generation.
          const answer = await oxe(page, 'thread.respondPending', { threadId: id, requestId: request.id, generation: request.generation, response: { decision: 'decline', reason: 'T53 acceptance: the person declines' } })
            .then(r => JSON.stringify(r), e => `error: ${e instanceof Error ? e.message : String(e)}`)
          responses.push(`${request.toolName}: ${answer.slice(0, 200)}`)
        }
        if (answers().slice(before).filter(a => a.event === 'answer').length >= tools.length) break
        await page.waitForTimeout(500)
      }
      const got = answers().slice(before).filter(a => a.event === 'answer')
      const result = Object.fromEntries(tools.map(tool => [tool, asked.has(tool) ? 'asked the person' : got.find(a => a.tool === tool)?.behavior === 'allow' ? 'allowed by the app' : got.find(a => a.tool === tool) ? `app answered ${got.find(a => a.tool === tool)?.behavior}` : 'no answer']))
      out[label] = result
      return result
    }

    const defaults = await turn('defaults', [...READS.map(mcp), mcp(WRITE), OTHER])
    for (const tool of READS) expect.soft(defaults[mcp(tool)], `${tool}: a read lookup of OXESpace's own server, no rule → answered without the person`).toBe('allowed by the app')
    expect.soft(defaults[mcp(WRITE)], `${WRITE}: a write tool still asks`).toBe('asked the person')
    expect.soft(defaults[OTHER], 'a third-party server\'s tool with the same name still asks').toBe('asked the person')

    await oxe(page, 'thread.setAutoApproveReads', false)
    const off = await turn('reads-off', [mcp(READS[0])])
    expect.soft(off[mcp(READS[0])], '"Auto-approve reads" off → the lookup asks').toBe('asked the person')
    await oxe(page, 'thread.setAutoApproveReads', true)

    // Nothing reached the agent as "allow" that the person declined, and no request is left behind.
    const left = (await oxe<Snap>(page, 'thread.read', id)).pendingRequests?.filter(r => !r.state || r.state === 'pending') ?? []
    expect.soft(left.length, 'no request left pending').toBe(0)
  } finally {
    console.log('T53', JSON.stringify(out))
    await quitReal(app)
  }
})
