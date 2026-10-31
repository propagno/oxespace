import { _electron as electron, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * #267 on main, REAL app in a throwaway profile: what moved off the main entry still works on first use. Agent hooks
 * install and remove (Claude and Codex config pointed at temp folders by CLAUDE_CONFIG_DIR / CODEX_HOME, so nothing of
 * the person's is touched); session search finds a planted fake session (same temp folders); voice answers its model
 * status (no download); OXE detect answers; and an agent's first OxeQuery call over the internal MCP is timed against
 * the second. Output: e2e/screenshots/homologation/check-267/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-267')
mkdirSync(OUT, { recursive: true })

test('on-demand modules work on first use', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-267-'))
  const claudeDir = join(root, 'claude'), codexDir = join(root, 'codex')
  const repo = join(root, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  // A fake Claude session with a word nobody else uses.
  const project = join(claudeDir, 'projects', 'C--fake-project'); mkdirSync(project, { recursive: true })
  writeFileSync(join(project, '11111111-2222-3333-4444-555555555555.jsonl'), JSON.stringify({ type: 'user', sessionId: '11111111-2222-3333-4444-555555555555', cwd: repo, timestamp: new Date().toISOString(), message: { role: 'user', content: 'please refactor the zanzibarquux module' } }) + '\n')
  mkdirSync(join(codexDir, 'sessions'), { recursive: true })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'en-US', CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir } })
  const notes: Record<string, unknown> = {}
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const call = <T>(fn: string, ...args: unknown[]) => page.evaluate(async ({ fn, args }) => {
      const parts = fn.split('.'); let target: unknown = (window as unknown as { oxe: unknown }).oxe
      for (const p of parts.slice(0, -1)) target = (target as Record<string, unknown>)[p]
      const started = performance.now()
      try { const value = await (target as Record<string, (...a: unknown[]) => Promise<unknown>>)[parts.at(-1)!](...args); return { ms: Math.round(performance.now() - started), value } } catch (e) { return { ms: Math.round(performance.now() - started), error: String(e).slice(0, 200) } }
    }, { fn, args }) as Promise<{ ms: number; value?: T; error?: string }>

    // Agent hooks (Settings path).
    notes.hooksStatus = await call('agentHooks.status')
    notes.hooksInstallClaude = await call('agentHooks.install', 'claude-code')
    notes.hooksInstallCodex = await call('agentHooks.install', 'codex')
    notes.hookFiles = { claude: existsSync(join(claudeDir, 'settings.json')) ? readFileSync(join(claudeDir, 'settings.json'), 'utf8').slice(0, 300) : null, codex: existsSync(join(codexDir, 'hooks.json')) ? readFileSync(join(codexDir, 'hooks.json'), 'utf8').slice(0, 300) : null }
    notes.hooksRemoveClaude = await call('agentHooks.remove', 'claude-code')
    notes.hooksRemoveCodex = await call('agentHooks.remove', 'codex')
    // Session search, first and second time.
    notes.sessionSearch1 = await call('session.search', { query: 'zanzibarquux' })
    notes.sessionSearch2 = await call('session.search', { query: 'zanzibarquux' })
    // Voice model status (no download) and OXE detect.
    notes.voice = await call('voice.getModelStatus', 'base')
    notes.oxe = await call('oxe.detect', false)
    // A workspace, then an agent's OxeQuery calls over the internal MCP.
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(3_000)
    const db = new DatabaseSync(join(root, 'oxespace.sqlite3'))
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    const workspace = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
    db.close()
    const rpc = async (name: string) => { const t = Date.now(); const res = await fetch(`http://127.0.0.1:${meta.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meta.token}`, 'X-OXE-Workspace-Id': workspace }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }) }); return { ms: Date.now() - t, body: JSON.stringify(await res.json()).slice(0, 240) } }
    notes.oxequeryFirst = await rpc('oxespace_db_connections')
    notes.oxequerySecond = await rpc('oxespace_db_connections')
    notes.oxequeryThird = await rpc('oxespace_db_connections')
    notes.errors = errors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
