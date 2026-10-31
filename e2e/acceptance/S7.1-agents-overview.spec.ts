import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * S7.1 · The aggregated agents model in main (design spec docs/design/s7-mission-control.md §3, §13, §14).
 * Roadmap acceptance: an OxeCode pane, a conversation, a delegation and a work run appear with the right state and
 * requests; a state change arrives within 1 s. Each entry carries mode, state, cost, session, worktree and requests,
 * in the 7-state vocabulary (needs-you, failed, working, finished, idle, stopped, unknown); seenAt lives in main and
 * survives a restart; every agents:* channel is kept from agents (mcp-coverage forbidden/excluded).
 *
 * REAL main, no doubles, no agent runs:
 * - the pane's state comes from the real hook server, posted from inside the pane's own terminal with that pane's
 *   execution credentials, exactly as a Claude lifecycle hook does (hook.js below);
 * - the conversation, delegation and work run are rows in the profile's database, as their services store them.
 * Contract names are taken from the spec (§14: shared/types/ipc/agents.ts, oxe.agents.*); owners may rename.
 */
type Entry = { kind: string; id: string; state: string; [k: string]: unknown }
type AgentsApi = { overview: () => Promise<Entry[] | { agents: Entry[] }>; markSeen: (key: { kind: string; id: string }) => Promise<unknown>; onChanged: (l: (e: unknown) => void) => () => void }
const agents = (page: Page) => page.evaluate(async () => {
  const api = (window as unknown as { oxe: { agents?: AgentsApi } }).oxe.agents
  if (!api) return null
  const r = await api.overview()
  return Array.isArray(r) ? r : r.agents
})
const find = (list: Entry[] | null, kind: string, id?: string) => list?.find(e => e.kind === kind && (id === undefined || e.id === id || String(e.id).endsWith(id)))

const HOOK = String.raw`
const [event] = process.argv.slice(2)
const sent = process.argv[3]
if (sent) require('fs').writeFileSync(sent, String(Date.now()))
fetch('http://127.0.0.1:' + process.env.OXESPACE_AGENT_HOOK_PORT + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ executionId: process.env.OXESPACE_EXECUTION_ID, token: process.env.OXESPACE_EXECUTION_TOKEN, workspaceId: process.env.OXESPACE_WORKSPACE_ID,
    agent: 'claude-code', payload: { hook_event_name: event, session_id: 'acc-s71-session', cwd: process.cwd() } }) })
  .then(r => console.log('hook ' + event + ' ' + r.status), e => console.log('hook error ' + e.message))
`

test('S7.1: one overview of a pane, a conversation, a delegation and a work run, live within 1 s', async () => {
  test.setTimeout(300_000)
  const profile = realProfile('s71', { OXESPACE_LOCALE: 'en-US' })
  const hook = join(profile.root, 'hook.js'); writeFileSync(hook, HOOK)
  const sent = join(profile.root, 'sent.txt')
  let { app, page } = await launchReal(profile)
  let workspaceId = '', paneId = '', threadId = ''
  try {
    await openRepo(page, profile.repo)
    ;({ workspaceId, paneId } = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ id: string; panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => ({ workspaceId: l[0].id, paneId: l[0].panes[0].id }))))
    threadId = await page.evaluate(async root => {
      const oxe = (window as unknown as { oxe: { thread: { addProject: (r: string) => Promise<{ projectId: string }>; create: (i: object) => Promise<{ thread: { id: string } }> } } }).oxe
      const { projectId } = await oxe.thread.addProject(root)
      return (await oxe.thread.create({ projectId, rootPath: root, provider: 'claude' })).thread.id
    }, profile.repo)
  } finally { await quitReal(app) }

  // What the services would have stored: a failed conversation, a running delegation, a blocked work run.
  const now = Date.now()
  const db = new DatabaseSync(profile.db)
  db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.status', 'failed', '$.title', 'Acceptance conversation') WHERE id = ?").run(threadId)
  const task = { id: 'acc-deleg', workspaceId, project: 'acc', originPaneId: paneId, originExecutionId: 'acc-exec', cwd: profile.repo, path: profile.repo, branch: 'acc/deleg', baseSha: '', localChanges: '', state: 'accepted', createdAt: now, updatedAt: now, key: 'acc-key', agentProfileId: 'claude', objective: 'Acceptance delegation', handoff: '', acceptance: '' }
  db.prepare('INSERT INTO delegations (id, origin_execution, request_key, workspace_id, payload) VALUES (?, ?, ?, ?, ?)').run(task.id, task.originExecutionId, task.key, workspaceId, JSON.stringify(task))
  db.prepare('INSERT INTO delegation_task_index (task_id, workspace_id, project, state, branch, objective, surface, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, workspaceId, task.project, task.state, task.branch, task.objective, 'terminal', now, now)
  db.prepare("INSERT INTO work_runs (id, supervisor_thread_id, workspace_id, project_id, project_root, request_key, title, status, created_at, updated_at) VALUES ('acc-run', ?, ?, 'acc', ?, 'acc-run-key', 'Acceptance run', 'blocked', ?, ?)").run(threadId, workspaceId, profile.repo, now, now)
  db.close()

  ;({ app, page } = await launchReal(profile))
  try {
    await page.locator('[data-testid="pane-container"] .xterm').first().waitFor({ timeout: 20_000 })
    const runHook = async (event: string, stamp = false) => {
      await page.locator('[data-testid="pane-container"] .xterm').first().click()
      await page.keyboard.type(`node "${hook}" ${event}${stamp ? ` "${sent}"` : ''}`); await page.keyboard.press('Enter')
    }
    await runHook('PermissionRequest')
    await page.waitForTimeout(2_000)

    const list = await agents(page)
    expect(list, 'oxe.agents.overview exists').not.toBeNull()
    expect(find(list, 'pane', paneId)?.state, 'the pane waiting on a permission needs you').toBe('needs-you')
    expect(find(list, 'thread', threadId)?.state, 'the failed conversation').toBe('failed')
    expect(find(list, 'delegation', 'acc-deleg')?.state, 'the accepted delegation is working').toBe('working')
    expect(find(list, 'work', 'acc-run')?.state, 'the blocked work run needs you').toBe('needs-you')
    for (const e of list ?? []) {
      expect(['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'], `${e.kind} state is in the vocabulary`).toContain(e.state)
      for (const field of ['mode', 'cost', 'session', 'worktree', 'requests']) expect(e, `${e.kind} carries ${field}`).toHaveProperty(field)
    }
    const pane = find(list, 'pane', paneId)!
    expect(Array.isArray(pane.requests) ? pane.requests.length : Number(pane.requests), 'the pane shows its pending request').toBeGreaterThan(0)

    // Live: the pane goes back to work; the event reaches the window within 1 s of the hook being sent.
    await page.evaluate(id => {
      const g = window as unknown as { __accWorkingAt?: number; oxe: { agents: AgentsApi } }
      g.oxe.agents.onChanged(async () => {
        const r = await g.oxe.agents.overview(); const l = Array.isArray(r) ? r : r.agents
        if (!g.__accWorkingAt && l.find(e => e.kind === 'pane' && e.id === id)?.state === 'working') g.__accWorkingAt = Date.now()
      })
    }, paneId)
    await runHook('UserPromptSubmit', true)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __accWorkingAt?: number }).__accWorkingAt ?? 0), { timeout: 10_000 }).toBeGreaterThan(0)
    const arrived = await page.evaluate(() => (window as unknown as { __accWorkingAt: number }).__accWorkingAt)
    const postedAt = Number(readFileSync(sent, 'utf8'))
    expect(arrived - postedAt, 'a state change reaches the window within 1 s').toBeLessThanOrEqual(1_000)
  } finally { await quitReal(app) }

  // seenAt lives in main: a finished run, marked seen, stays seen across a restart.
  const db2 = new DatabaseSync(profile.db)
  db2.prepare("UPDATE work_runs SET status = 'succeeded', updated_at = ? WHERE id = 'acc-run'").run(Date.now())
  db2.close()
  ;({ app, page } = await launchReal(profile))
  try {
    await expect.poll(async () => find(await agents(page), 'work', 'acc-run')?.state, { timeout: 10_000 }).toBe('finished')
    const key = find(await agents(page), 'work', 'acc-run')!
    await page.evaluate(k => (window as unknown as { oxe: { agents: AgentsApi } }).oxe.agents.markSeen(k), { kind: key.kind, id: key.id })
    await expect.poll(async () => find(await agents(page), 'work', 'acc-run')?.state, { timeout: 5_000 }).toBe('idle')
  } finally { await quitReal(app) }
  ;({ app, page } = await launchReal(profile))
  try {
    await expect.poll(async () => find(await agents(page), 'work', 'acc-run')?.state, { timeout: 10_000 }).toBe('idle')
  } finally { await quitReal(app) }
})

test('S7.1: every agents:* channel is kept from agents (mcp-coverage)', () => {
  const ipc = join(process.cwd(), 'shared', 'types', 'ipc', 'agents.ts')
  expect(existsSync(ipc), 'channels live in shared/types/ipc/agents.ts (§14)').toBe(true)
  const channels = [...readFileSync(ipc, 'utf8').matchAll(/['"](agents:[a-z-]+)['"]/gi)].map(m => m[1])
  expect(channels.length, 'agents channels declared').toBeGreaterThan(0)
  const coverage = readFileSync(join(process.cwd(), 'shared', 'mcp-coverage.ts'), 'utf8')
  for (const channel of channels) {
    const line = coverage.split('\n').find(l => l.includes(channel)) ?? ''
    expect(line, `${channel} is forbidden or excluded for agents`).toMatch(/forbidden|excluded/)
  }
})
