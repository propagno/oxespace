// Frozen end-to-end acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-229, PQ-07·16, CA-5), in the built app
// with real services (OXESPACE_E2E_MOCK_NATIVE=0), a real PostgreSQL container and a stand-in agent in the pane's
// terminal making 250 real reads through the internal MCP (250 audit entries, no paid account). Written by the
// planner; the executor must not edit it. Red until audit.list pages and Agent activity offers Load more.
import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
// ---- catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pqReadFile } from 'node:fs'
import { join as pqJoin } from 'node:path'

const pqRead = (rel: string): string => pqReadFile(pqJoin(process.cwd(), rel), 'utf8')
const pqCatalogs: Record<string, unknown> = {}
/** The OxeQuery catalog text of a key, so elements are found by the string the person reads. A missing key fails loudly. */
function cat(key: string, vars: Record<string, string | number> = {}, lang: 'en' | 'pt-BR' = 'en'): string {
  pqCatalogs[lang] ??= JSON.parse(pqRead(`shared/locales/${lang}/oxequery.json`))
  let node: unknown = pqCatalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} oxequery catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
// ---- real databases in containers + OxeQuery in the built app (inlined so every task's PR stands alone) ----
// Like tests/live/oxequery-live.test.ts: a real PostgreSQL or MongoDB in Docker (Podman with OXE_CONTAINER_ENGINE=podman).
// Without a container engine the spec is skipped and says why. The app runs with OXESPACE_E2E_MOCK_NATIVE=0: real
// OxePod (it lists the container), the real OxeQuery worker and the real main process.
import { execFileSync as pqExec } from 'node:child_process'

const PQ_ENGINE = process.env.OXE_CONTAINER_ENGINE === 'podman' ? 'podman' : 'docker'
const pqDocker = (...args: string[]): string => pqExec(PQ_ENGINE, args, { encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
/** Why this machine cannot run the spec, or null. */
function noContainerEngine(): string | null {
  try { const os = pqDocker('info', '--format', '{{.OSType}}'); return os === 'linux' ? null : `the ${PQ_ENGINE} daemon here runs ${os} containers: this OxeQuery e2e needs a Linux PostgreSQL or MongoDB container` } catch {
    return `no ${PQ_ENGINE} daemon on this machine: this OxeQuery e2e needs a real PostgreSQL or MongoDB container (as tests/live/oxequery-live.test.ts)`
  }
}
async function pqUntil(label: string, check: () => boolean, ms = 120_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 1000)) }
  throw new Error(`timed out: ${label}`)
}
const pqTry = (run: () => unknown): boolean => { try { run(); return true } catch { return false } }
const stopContainer = (name: string): void => { pqTry(() => pqDocker('rm', '-f', name)) }
/** PostgreSQL 16, user app, database shop, trust auth (no password to type), seeded with `sql`. */
async function startPostgres(name: string, sql = ''): Promise<void> {
  stopContainer(name)
  pqDocker('run', '-d', '--name', name, '-e', 'POSTGRES_USER=app', '-e', 'POSTGRES_DB=shop', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', process.env.OXE_LIVE_PG_IMAGE ?? 'docker.io/library/postgres:16-alpine')
  await pqUntil(`${name} accepts connections`, () => pqTry(() => pqDocker('exec', name, 'psql', '-U', 'app', '-d', 'shop', '-tAc', 'SELECT 1')))
  if (sql) pqDocker('exec', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'app', '-d', 'shop', '-c', sql)
}
/** MongoDB 7 without auth, seeded by `js` run against the database shop. */
async function startMongo(name: string, js = ''): Promise<void> {
  stopContainer(name)
  pqDocker('run', '-d', '--name', name, '-p', '127.0.0.1::27017', process.env.OXE_LIVE_MONGO_IMAGE ?? 'docker.io/library/mongo:7')
  await pqUntil(`${name} answers`, () => pqTry(() => pqDocker('exec', name, 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 }).ok')))
  if (js) pqDocker('exec', name, 'mongosh', '--quiet', 'shop', '--eval', js)
}
/** OxeQuery in the title bar's mode switch, by its mode id (whatever the switch is drawn as). */
async function openOxeQuery(page: Page): Promise<void> {
  await page.locator('[data-app-mode="data"]').first().click()
  await expect(page.locator('.oq-view')).toBeVisible({ timeout: 30_000 })
}
/** New connection › From a running container › the container › Save and open, as a person does. */
async function connectContainer(page: Page, name: string): Promise<void> {
  await openOxeQuery(page)
  await page.getByRole('button', { name: cat('connections.new') }).first().click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('radio', { name: cat('form.sourceContainer') }).click({ timeout: 60_000 })
  const select = dialog.getByLabel(cat('form.containerLabel'))
  const option = select.locator('option', { hasText: new RegExp(`^${name}\\b`) })
  await option.waitFor({ state: 'attached', timeout: 60_000 })
  await select.selectOption(await option.evaluate((el: HTMLOptionElement) => el.value))
  await dialog.getByRole('button', { name: cat('form.saveOpen') }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toBeVisible({ timeout: 60_000 })
}
// ---- an agent in the pane: a script started in the pane's own terminal calls the internal MCP with that pane's
// execution credentials, as an agent there would (e2e/acceptance/AOS-real-approval-over-settings.spec.ts). No paid
// account is used. Steps: [{ wait, tool, args, times }]; each answer (first 300 chars) is written to `out`.
import { existsSync as pqExists, readFileSync as pqReadOut, writeFileSync as pqWrite } from 'node:fs'
import { join as pqPath } from 'node:path'

const PQ_AGENT = String.raw`
const fs = require('fs')
const [out, planFile] = process.argv.slice(2)
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const results = []
const call = (name, args, id) => fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, signal: AbortSignal.timeout(180000),
  body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) }).then(r => r.text(), e => 'error: ' + e.message)
;(async () => {
  for (const step of plan) {
    await new Promise(r => setTimeout(r, step.wait || 0))
    for (let i = 0; i < (step.times || 1); i++) { results.push((await call(step.tool, step.args, results.length)).slice(0, 300)); if (i % 25 === 0 || i === (step.times || 1) - 1) fs.writeFileSync(out, JSON.stringify(results)); if (step.pace) await new Promise(r => setTimeout(r, step.pace)) }
  }
})()
`
interface PqStep { wait?: number; tool: string; args: Record<string, unknown>; times?: number; pace?: number }
/** Starts the steps in the first pane's terminal (the Code view must be showing); returns a reader of the answers. */
async function agentInPane(page: Page, root: string, steps: PqStep[]): Promise<() => string[]> {
  const script = pqPath(root, 'agent.js'), plan = pqPath(root, 'plan.json'), out = pqPath(root, 'answers.json')
  pqWrite(script, PQ_AGENT); pqWrite(plan, JSON.stringify(steps))
  await page.locator('[data-app-mode="code"]').first().click()
  await page.locator('[data-testid="pane-container"] .xterm').first().click()
  await page.keyboard.type(`node "${script}" "${out}" "${plan}"`)
  await page.keyboard.press('Enter')
  return () => (pqExists(out) ? JSON.parse(pqReadOut(out, 'utf8')) as string[] : [])
}
/** Gives agents access to a connection (and its environment), through the window's own door to main, as Save does. */
async function agentAccess(page: Page, name: string, change: Record<string, unknown>): Promise<void> {
  const ok = await page.evaluate(async ({ name, change }) => {
    const oxe = (window as unknown as { oxe: { oxeQuery: { call: (op: string, input: unknown) => Promise<{ ok: boolean; value: Array<Record<string, unknown>> }> } } }).oxe
    const listed = await oxe.oxeQuery.call('connections.list', {})
    const found = listed.value.find(item => item.name === name)
    return found ? (await oxe.oxeQuery.call('connections.save', { ...found, ...change })).ok : false
  }, { name, change })
  expect(ok, `${name}: agent access saved`).toBe(true)
}
const PG = `pq0716-pg-${process.pid}`
test('DIAG t18 seed', async () => {
  const reason = noContainerEngine()
  test.skip(reason !== null, reason ?? '')
  test.setTimeout(600_000)
  await startPostgres(PG, 'CREATE TABLE items (id int PRIMARY KEY); INSERT INTO items VALUES (1);')
  const { app, page, root, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await connectContainer(page, PG)
    await agentAccess(page, PG, { agentAccess: 'read' })
    const t0 = Date.now()
    const answers = await agentInPane(page, root, [{ wait: 1_000, tool: 'oxespace_db_query', args: { connection: PG, sql: 'SELECT id FROM items' }, times: 40, pace: 2_200 }])
    const mainCatalog = JSON.parse(pqRead('shared/locales/en/main.json')) as { messages: { approvals: { title: { oxequery: string }; option: { allowSessionReads: string } } } }
    const approval = page.getByRole('dialog', { name: mainCatalog.messages.approvals.title.oxequery })
    await expect(approval).toBeVisible({ timeout: 60_000 })
    console.log(`DIAG approval shown after ${Date.now() - t0} ms; buttons: ${(await approval.getByRole('button').allTextContents()).join(' | ')}`)
    const listed = await page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<Array<Record<string, unknown>>> } } }).oxe.approvals.list())
    console.log('DIAG list before click: ' + JSON.stringify(listed.map(r => ({ id: r.id, generation: r.generation, risk: r.risk, ackRequired: r.ackRequired, allowDelayMs: r.allowDelayMs, options: (r.options as Array<{ id: string; intent: string }>).map(o => o.id + ':' + o.intent), requester: r.requester }))).slice(0, 900))
    await approval.getByRole('button', { name: mainCatalog.messages.approvals.option.allowSessionReads, exact: true }).click()
    await page.waitForTimeout(3_000)
    const after = await page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<Array<Record<string, unknown>>>; history: () => Promise<unknown[]> } } }).oxe.approvals)
      .then(() => null).catch(() => null)
    const state = await page.evaluate(async () => { const a = (window as unknown as { oxe: { approvals: { list: () => Promise<Array<Record<string, unknown>>>; history: () => Promise<unknown[]>; respond: (i: unknown) => Promise<unknown> } } }).oxe.approvals; const l = await a.list(); const h = await a.history(); const direct = l[0] ? await a.respond({ id: l[0].id, generation: l[0].generation, optionId: 'allow-session' }) : null; return { pendingAfterClick: l.map(r => r.id), history: JSON.stringify(h).slice(0, 600), directRespond: direct } })
    console.log('DIAG after click: ' + JSON.stringify(state).slice(0, 1400))
    for (let s = 0; s < 6; s++) {
      await page.waitForTimeout(10_000)
      const dialogs = await page.getByRole('dialog').allTextContents()
      console.log(`DIAG t=${Math.round((Date.now() - t0) / 1000)}s answers=${answers().length} dialogs=${dialogs.length} ${dialogs.map(d => d.slice(0, 120)).join(' || ')}`)
      if (answers().length >= 40) break
    }
    const groups = new Map<string, number>()
    for (const a of answers()) { const k = a.slice(0, 160); groups.set(k, (groups.get(k) ?? 0) + 1) }
    for (const [k, n] of groups) console.log(`DIAG answer x${n}: ${k}`)
  } finally {
    await app.close()
  }
})
