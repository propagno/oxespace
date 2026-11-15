// Frozen end-to-end acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-217, PQ-07·4, CA-4), in the built app
// with real services (OXESPACE_E2E_MOCK_NATIVE=0), the comfortable density and a real PostgreSQL container. Written by
// the planner; the executor must not edit it. Red while OxeQuery.css keeps 10/11 px literals.
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
const PG = `pq074-pg-${process.pid}`
test('PQ-07·4 in the app: in the comfortable density no OxeQuery text is under 12 px', async () => {
  const reason = noContainerEngine()
  test.skip(reason !== null, reason ?? '')
  test.setTimeout(300_000)
  await startPostgres(PG, 'CREATE TABLE users (id int PRIMARY KEY, name text); INSERT INTO users VALUES (1, \'alice\'), (2, \'bob\');')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', density: 'comfortable', realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await connectContainer(page, PG)
    await page.getByRole('navigation', { name: cat('tree.label') }).getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    await expect(page.locator('.oq-grid').first().getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.locator('.oq-grid-header [role="columnheader"]').filter({ hasText: /^name/ }).first().click()
    // Every element of the OxeQuery view that holds text of its own, shown or kept in the layout (opacity 0 included).
    const small = await page.locator('.oq-view').first().evaluate(view => [...view.querySelectorAll('*')]
      .filter(el => [...el.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim()) && el.getClientRects().length > 0)
      .map(el => ({ size: parseFloat(getComputedStyle(el).fontSize), text: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${el.textContent?.trim().slice(0, 20)}"` }))
      .filter(item => item.size < 12).map(item => `${item.size}px ${item.text}`))
    expect(small).toEqual([])
  } finally {
    await app.close()
    stopContainer(PG)
  }
})
