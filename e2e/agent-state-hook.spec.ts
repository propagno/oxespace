/**
 * Smoke test of the E2E agent-state hook (F29): a spec sets a pane's agent state in the main process and the window
 * receives the production `agent-state:changed` event. FRONTEND extends this with the UI assertions.
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type SetInput = { paneId: string; state: 'working' | 'waiting' | 'done' | 'ended'; agent?: 'claude' | 'codex'; hookEvent?: string }

test('the agent-state hook drives a pane through blocked and done with the production events', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-agent-state-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    const set = (input: SetInput) => app.evaluate((_electron, value) => (globalThis as unknown as { __oxeE2eAgentState?: (input: unknown) => unknown }).__oxeE2eAgentState?.(value), input)

    const paneId = await page.evaluate(async (rootPath) => {
      const workspace = await (window as unknown as { oxe: { workspace: { create(input: unknown): Promise<{ panes: Array<{ id: string }> }> } } }).oxe.workspace.create({ rootPath, layoutPreset: 1 })
      return workspace.panes[0].id
    }, repo)
    // Record what the window receives on the production channel.
    await page.evaluate(() => {
      const events: unknown[] = []
      ;(window as unknown as { __agentStateEvents: unknown[] }).__agentStateEvents = events
      ;(window as unknown as { oxe: { agentState: { onChanged(listener: (event: unknown) => void): void } } }).oxe.agentState.onChanged(event => events.push(event))
    })
    const received = () => page.evaluate(() => (window as unknown as { __agentStateEvents: Array<{ state?: string; source?: string }> }).__agentStateEvents.at(-1))

    expect(await set({ paneId, state: 'waiting', hookEvent: 'PermissionRequest' })).toMatchObject({ ok: true, explain: { state: { state: 'blocked', source: 'hook' } } })
    await expect.poll(received).toMatchObject({ state: 'blocked', source: 'hook' })

    await set({ paneId, state: 'working' })
    expect(await set({ paneId, state: 'done' })).toMatchObject({ ok: true, explain: { state: { state: 'done', source: 'hook' } } })
    await expect.poll(received).toMatchObject({ state: 'done', source: 'hook' })
    expect(await page.evaluate((id) => (window as unknown as { oxe: { agentState: { explain(id: string): Promise<unknown> } } }).oxe.agentState.explain(id), paneId)).toMatchObject({ state: { state: 'done', source: 'hook' } })

    expect(await set({ paneId: 'not-a-pane', state: 'waiting' })).toEqual({ ok: false, refusal: 'unknown-pane' })
  } finally {
    await app.close()
  }
})
