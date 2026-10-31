import { _electron as electron, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #220 (B1.2 side chat runtime) on main, black box without a live agent (no Claude/Codex run on the person's account):
 * the refusals and input checks a window can reach through thread.sideOpen / sideSend / sideClose in the REAL app.
 * The live behaviour (two runs side by side, events in order, Codex tools) needs a real session and is not run here.
 * Output: e2e/screenshots/homologation/check-220/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-220')
mkdirSync(OUT, { recursive: true })

test('side chat: refusals and input checks without a live agent', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-220-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const uuid = '0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601'
    notes.calls = await page.evaluate(async id => {
      const t = (window as unknown as { oxe: { thread: Record<string, (...a: unknown[]) => Promise<unknown>> } }).oxe.thread
      const run = async (label: string, fn: () => Promise<unknown>) => { try { return { label, ok: String(JSON.stringify(await fn())).slice(0, 240) } } catch (e) { return { label, threw: String(e).replace(/^Error: Error invoking remote method '[^']+': /, '').slice(0, 200) } } }
      return [
        await run('open unknown conversation', () => t.sideOpen('no-such-conversation')),
        await run('open empty id', () => t.sideOpen('')),
        await run('open non-string', () => t.sideOpen(42 as never)),
        await run('send to unknown side (uuid)', () => t.sideSend(id, 'oi')),
        await run('send with non-uuid side id', () => t.sideSend('../../etc', 'oi')),
        await run('send empty text', () => t.sideSend(id, '')),
        await run('send text with NUL', () => t.sideSend(id, 'a\u0000b')),
        await run('send 300k text', () => t.sideSend(id, 'x'.repeat(300_000))),
        await run('close unknown side', () => t.sideClose(id)),
        await run('close twice', () => t.sideClose(id)),
        await run('close non-uuid', () => t.sideClose('not-a-uuid')),
        // Other handlers that resolve with nothing: is the TypeError the side chat's or every void handler's?
        await run('search.cancel (void)', () => (window as unknown as { oxe: { search: { cancel: () => Promise<unknown> } } }).oxe.search.cancel()),
        await run('diagnostics.clearIncidents (void)', () => (window as unknown as { oxe: { diagnostics: { clearIncidents: () => Promise<unknown> } } }).oxe.diagnostics.clearIncidents()),
        await run('thread.unwatch? markSeen (void)', () => (window as unknown as { oxe: { agentState: { markSeen: (p: string) => Promise<unknown> } } }).oxe.agentState.markSeen('no-such-pane'))
      ]
    }, uuid)
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
