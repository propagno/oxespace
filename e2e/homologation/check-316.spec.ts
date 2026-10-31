import { _electron as electron, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * #316 (B7.2 sessionless groups; re-probe of check-182) black box as a GENERIC MCP client: the REAL app opens a repo,
 * writes the workspace's .mcp.json, and the oxespace entry in it is started exactly as written (command, args, env) and
 * spoken to over stdio, the way any MCP client would. No agent runs.
 * Measures tools/list (count, characters) and oxespace_tools_enable with {}, a non-string, `search`, an unknown group,
 * a hostile name, then one group the plan says is enableable.
 * Output: e2e/screenshots/homologation/check-316/notes.json
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-316')
mkdirSync(OUT, { recursive: true })

type Rpc = { id?: number; result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean }; error?: { code: number; message: string }; method?: string }

/** This session itself runs in an OXESpace terminal: never hand its OXESPACE_* (the live app's MCP port and token) on. */
const cleanEnv = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith('OXESPACE_') && v !== undefined)) as Record<string, string>

function stdioClient(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, { env: { ...cleanEnv(), ...env }, stdio: ['pipe', 'pipe', 'pipe'], shell: /\.cmd$/i.test(command) })
  let buf = ''; let next = 1; const waiting = new Map<number, (r: Rpc) => void>(); const notices: string[] = []; const stderr: string[] = []
  child.stdout.on('data', d => { buf += String(d); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { const m = JSON.parse(line) as Rpc; if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id) } else if (m.method) notices.push(m.method) } catch { notices.push(`non-json: ${line.slice(0, 80)}`) } } })
  child.stderr.on('data', d => stderr.push(String(d)))
  const call = (method: string, params: object = {}) => new Promise<Rpc>(resolve => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); setTimeout(() => { if (waiting.delete(id)) resolve({ error: { code: -1, message: 'timeout' } }) }, 15_000) })
  const notify = (method: string) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  return { call, notify, notices, stderr, close: () => child.kill() }
}

test('#316: what a generic MCP client gets from the workspace .mcp.json', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-316-'))
  const repo = join(root, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo })
  const launchEnv = { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'en-US', CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home') } as Record<string, string>
  let app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: launchEnv })
  const notes: Record<string, unknown> = {}
  let client: ReturnType<typeof stdioClient> | null = null
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    const mcpJson = join(repo, '.mcp.json')
    for (let i = 0; i < 30 && !existsSync(mcpJson); i++) await page.waitForTimeout(500)
    if (!existsSync(mcpJson)) {
      // The startup sync (McpService → syncAll) writes it for workspaces that exist: open the app again.
      notes.writtenOnOpen = false
      await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
      app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: launchEnv })
      const again = await app.firstWindow()
      await again.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
      for (let i = 0; i < 30 && !existsSync(mcpJson); i++) await again.waitForTimeout(500)
    }
    notes.mcpJsonWritten = existsSync(mcpJson)
    if (!existsSync(mcpJson)) return
    const servers = (JSON.parse(readFileSync(mcpJson, 'utf8')) as { mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> }).mcpServers
    const [name, entry] = Object.entries(servers).find(([k]) => /oxespace/i.test(k)) ?? []
    if (!entry) { notes.entry = Object.keys(servers); return }
    const flag = (f: string) => { const i = (entry.args ?? []).indexOf(f); return i >= 0 ? entry.args![i + 1] : null }
    const enableable = JSON.parse(flag('--enableable-groups') ?? '{}') as Record<string, string[]>
    notes.entry = { name, command: entry.command.replace(/.*[\\/]/, '…/'), allowedTools: JSON.parse(flag('--allowed-tools') ?? 'null'), enableableGroups: Object.keys(enableable), argsChars: JSON.stringify(entry.args ?? []).length }
    notes.entryEnvKeys = Object.keys(entry.env ?? {})
    // A client outside OXESpace gets only what the file carries:
    const bare = stdioClient(entry.command, entry.args ?? [], entry.env ?? {})
    notes.withFileOnly = await bare.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hml-bare', version: '0' } }).then(async r => { bare.notify('notifications/initialized'); const l = await bare.call('tools/list'); return { init: r.error ?? 'ok', list: l.error ?? `${l.result?.tools?.length ?? 0} tools`, stderr: bare.stderr.join('').slice(0, 200) } })
    bare.close()
    // As an agent in a Code terminal of THIS test app gets it: the app injects its own port and token.
    const db = new DatabaseSync(join(root, 'oxespace.sqlite3'))
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    db.close()
    client = stdioClient(entry.command, entry.args ?? [], { ...(entry.env ?? {}), OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token })
    notes.initialize = await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hml-generic', version: '0' } }).then(r => r.error ?? 'ok')
    client.notify('notifications/initialized')
    const list = async () => { const r = await client!.call('tools/list'); const tools = r.result?.tools ?? []; return { count: tools.length, chars: JSON.stringify(tools).length, names: tools.map(t => t.name), error: r.error } }
    const before = await list()
    notes.before = before
    const enable = async (args: unknown) => { const r = await client!.call('tools/call', { name: 'oxespace_tools_enable', arguments: args }); return { isError: r.result?.isError ?? null, error: r.error ?? null, text: (r.result?.content?.[0]?.text ?? '').slice(0, 240) } }
    notes.enable = {
      empty: await enable({}),
      nonString: await enable({ group: 42 }),
      search: await enable({ group: 'search' }),
      unknown: await enable({ group: 'no-such-group' }),
      hostile: await enable({ group: '../../etc' })
    }
    const valid = Object.keys(enableable)[0]
    if (valid) {
      notes.enableValid = { group: valid, result: await enable({ group: valid }) }
      const after = await list()
      notes.after = { count: after.count, chars: after.chars, added: after.names.filter(n => !before.names.includes(n)), expected: enableable[valid] }
    }
    notes.notifications = client.notices
    notes.bridgeStderr = client.stderr.join('').slice(0, 600)
  } finally {
    client?.close()
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
