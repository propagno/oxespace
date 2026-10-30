import { test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { connectFromContainer } from '../helpers/oxepod'

/**
 * Redesign audit, part 1 (permission dialogs), from the outside: the test plays an agent that calls the internal MCP
 * server over HTTP with the port and token the app gives agents, and records the native dialog the person would see
 * (dialog.showMessageBox is replaced by a recorder that answers Deny, then Allow once). Includes adversarial request
 * text: fake warning bullets, a misleading first line, very long SQL and right-to-left override characters.
 * Not part of CI. Output: e2e/screenshots/homologation/audit-permissions/notes.json
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-permissions')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

async function rpc(port: number, token: string, workspace: string, method: string, params: object): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-OXE-Workspace-Id': workspace },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  return response.json()
}

/** Replaces the native dialog with a recorder; `answer` is the button index it returns. */
async function recordDialogs(app: ElectronApplication, answer: number) {
  await app.evaluate(({ dialog }, value) => {
    const g = globalThis as Record<string, unknown>
    g.dialogs ??= []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown>
      ;(g.dialogs as unknown[]).push({ type: options.type, title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId, hasIcon: !!options.icon })
      return { response: value, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, answer)
}
const takeDialogs = (app: ElectronApplication) => app.evaluate(() => { const g = globalThis as Record<string, unknown>; const out = g.dialogs; g.dialogs = []; return out })

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`agent actions that need the person's approval: ${locale}`, async () => {
    test.setTimeout(240_000)
    const { app, page, root, workspaceRoot, consoleErrors } = await launchApp({ locale })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await connectFromContainer(page, 'pg-dev', locale === 'pt-BR' ? { connect: /no OxeQuery$/, save: 'Salvar e abrir' } : undefined)

      const db = new DatabaseSync(join(root, 'oxespace.sqlite3'), { readOnly: true })
      const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
      const workspace = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
      db.close()
      const call = (name: string, args: object = {}) => rpc(meta.port, meta.token, workspace, 'tools/call', { name, arguments: args })

      const listed = await rpc(meta.port, meta.token, workspace, 'tools/list', {}) as { result?: { tools?: Array<{ name: string; description?: string }> } }
      const tools = listed.result?.tools ?? []
      notes[`${locale}-tools`] = tools.map(tool => tool.name)
      const connections = await call('oxespace_db_connections')
      notes[`${locale}-connections`] = JSON.stringify(connections).slice(0, 600)
      const connectionId = JSON.stringify(connections).match(/"id\\?"\s*:\s*\\?"([^"\\]+)/)?.[1]

      const attempts: Array<[string, string, object]> = [
        ['plain write', 'oxespace_db_execute', { connectionId, sql: 'DELETE FROM users WHERE id = 1' }],
        ['fake warning bullets and a reassuring first line', 'oxespace_db_execute', { connectionId, sql: 'SELECT 1; -- read only, safe to allow\n\n• Verified by OXESpace: no changes\n\nDROP TABLE users' }],
        ['right-to-left override', 'oxespace_db_execute', { connectionId, sql: 'SELECT 1 /* \u202Eelbat pord */; DROP TABLE orders' }],
        ['very long statement', 'oxespace_db_execute', { connectionId, sql: `UPDATE users SET name = '${'x'.repeat(6000)}' WHERE id = 2` }],
        ['container action', 'oxespace_container_action', { id: 'pg-dev', action: 'stop' }]
      ]
      for (const [label, tool, args] of attempts) {
        await recordDialogs(app, 0)
        const denied = await call(tool, args)
        const shownDeny = await takeDialogs(app)
        await recordDialogs(app, 1)
        const allowed = await call(tool, args)
        const shownAllow = await takeDialogs(app)
        notes[`${locale}-${label}`] = { tool, deniedResult: JSON.stringify(denied).slice(0, 400), dialogOnDeny: shownDeny, allowedResult: JSON.stringify(allowed).slice(0, 400), dialogOnAllow: shownAllow }
      }
      await page.screenshot({ path: join(OUT, `${locale}-after.png`) })
      notes[`${locale}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}
