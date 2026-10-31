import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * #182 (B7.2 tool groups on demand) on main, black box over the REAL internal MCP server, as a generic MCP client would
 * see it (no agent runs): what tools/list offers before any group is on and its text size against T8; the discovery
 * tools always present; oxespace_tools_enable with a valid group, an unknown one, and a hostile name; tools/list after.
 * Output: e2e/screenshots/homologation/check-182/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-182')
mkdirSync(OUT, { recursive: true })

test('tool groups on demand over the internal MCP', async () => {
  test.setTimeout(150_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-182-'))
  const repo = join(root, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'en-US' } })
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(3_000)
    const db = new DatabaseSync(join(root, 'oxespace.sqlite3'))
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    const workspace = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
    db.close()
    const rpc = async (method: string, params: object = {}) => {
      const res = await fetch(`http://127.0.0.1:${meta.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meta.token}`, 'X-OXE-Workspace-Id': workspace }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      return res.json() as Promise<{ result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>; content?: Array<{ text: string }>; isError?: boolean }; error?: unknown }>
    }
    const list = async () => {
      const r = await rpc('tools/list')
      const tools = r.result?.tools ?? []
      return { count: tools.length, chars: JSON.stringify(tools).length, names: tools.map(t => t.name) }
    }
    const before = await list()
    notes.before = { count: before.count, chars: before.chars, names: before.names }
    notes.discoveryPresent = ['oxespace_execution_context', 'oxespace_capabilities', 'oxespace_tools_enable'].map(n => `${n}:${before.names.includes(n)}`)
    for (const [label, args] of [['valid group (search)', { group: 'search' }], ['unknown group', { group: 'no-such-group' }], ['hostile name', { group: '../../etc' }], ['no args', {}]] as const) {
      const r = await rpc('tools/call', { name: 'oxespace_tools_enable', arguments: args })
      notes[`enable: ${label}`] = { isError: r.result?.isError ?? null, text: (r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r)).slice(0, 300) }
    }
    const after = await list()
    notes.after = { count: after.count, chars: after.chars, added: after.names.filter(n => !before.names.includes(n)) }
    notes.capabilities = await rpc('tools/call', { name: 'oxespace_capabilities', arguments: {} }).then(r => (r.result?.content?.[0]?.text ?? JSON.stringify(r)).slice(0, 600))
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
