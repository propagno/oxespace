import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * T8 (S5) · The tool text a session carries stays within budget, as the agent sees it.
 * Roadmap acceptance: an ordinary session ≤ 9,000 characters of tool text; one on-demand group costs a bounded fixed
 * amount (~1.5k tokens); the test fails if any limit goes up.
 *
 * REAL app, no agent runs. The plan is applied by the bridge (--allowed-tools / --enableable-groups), not by the
 * server, so the measure goes through the workspace's .mcp.json entry, started as written over stdio with the test
 * app's own port and token, the way an agent in a Code terminal of that app gets them. The startup sync writes
 * .mcp.json, so the app is opened twice. check-316 measured 15,470 characters on #316.
 */
const ORDINARY_BUDGET = 9_000
/** ~1.5k tokens of fixed cost for keeping every group on demand, at ~4 characters per token. */
const GROUP_BUDGET = 6_000

type Rpc = { id?: number; result?: { tools?: Array<{ name: string }>; isError?: boolean }; error?: { message: string }; method?: string }

function bridge(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = '', next = 1
  const waiting = new Map<number, (r: Rpc) => void>()
  child.stdout.on('data', d => { buf += String(d); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); try { const m = JSON.parse(line) as Rpc; if (m.id !== undefined) { waiting.get(m.id)?.(m); waiting.delete(m.id) } } catch { /* not a reply */ } } })
  const call = (method: string, params: object = {}) => new Promise<Rpc>(resolve => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); setTimeout(() => { if (waiting.delete(id)) resolve({ error: { message: 'timeout' } }) }, 15_000) })
  return { call, notify: (method: string) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), close: () => child.kill() }
}

test('T8: an ordinary session carries at most 9,000 characters of tools', async () => {
  test.setTimeout(180_000)
  const profile = realProfile('t8', { OXESPACE_LOCALE: 'en-US' })
  const first = await launchReal(profile)
  try { await openRepo(first.page, profile.repo) } finally { await quitReal(first.app) }
  const { app } = await launchReal(profile)
  let client: ReturnType<typeof bridge> | null = null
  try {
    const mcpJson = join(profile.repo, '.mcp.json')
    await expect.poll(() => existsSync(mcpJson), { timeout: 15_000 }).toBe(true)
    const servers = (JSON.parse(readFileSync(mcpJson, 'utf8')) as { mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> }).mcpServers
    const entry = Object.entries(servers).find(([k]) => /oxespace/i.test(k))?.[1]
    expect(entry, 'the workspace .mcp.json has the OXESpace entry').toBeTruthy()
    const db = new DatabaseSync(profile.db)
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    db.close()
    // profile.env is already scrubbed of the live app's variables (playwright.acceptance.config.ts).
    client = bridge(entry!.command, entry!.args ?? [], { ...profile.env, ...(entry!.env ?? {}), OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token })
    await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acc-t8', version: '0' } })
    client.notify('notifications/initialized')
    const size = async () => { const r = await client!.call('tools/list'); const tools = r.result?.tools ?? []; return { count: tools.length, chars: JSON.stringify(tools).length, names: tools.map(t => t.name), error: r.error?.message, discoveryChars: JSON.stringify(tools.filter(t => /^oxespace_(capabilities|tools_enable)$/.test(t.name))).length } }

    const ordinary = await size()
    test.info().annotations.push({ type: 'ordinary', description: `${ordinary.count} tools, ${ordinary.chars} chars` })
    expect(ordinary.error, 'the bridge answers').toBeUndefined()
    expect(ordinary.chars, `ordinary session tool text (${ordinary.count} tools)`).toBeLessThanOrEqual(ORDINARY_BUDGET)
    expect(ordinary.names, 'discovery stays offered').toEqual(expect.arrayContaining(['oxespace_capabilities', 'oxespace_tools_enable']))
    // Keeping every group available on demand costs only the discovery tools' text: ~1.5k tokens fixed.
    expect(ordinary.discoveryChars, 'fixed cost of the on-demand groups').toBeLessThanOrEqual(GROUP_BUDGET)

    // One on-demand group: it adds tools; its cost is measured and reported (per group, as T8 asks for Codex).
    const flag = (entry!.args ?? []).indexOf('--enableable-groups')
    const group = flag >= 0 ? Object.keys(JSON.parse(entry!.args![flag + 1]) as Record<string, unknown>)[0] : undefined
    expect(group, 'the plan names on-demand groups').toBeTruthy()
    await client.call('tools/call', { name: 'oxespace_tools_enable', arguments: { group } })
    const withGroup = await size()
    expect(withGroup.count, `${group} adds tools`).toBeGreaterThan(ordinary.count)
    test.info().annotations.push({ type: `group ${group}`, description: `+${withGroup.count - ordinary.count} tools, +${withGroup.chars - ordinary.chars} chars` })
  } finally { client?.close(); await quitReal(app) }
})
