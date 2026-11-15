// Frozen end-to-end acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-218, PQ-07·5, CA-4 and CA-2's contrast),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0) and a real PostgreSQL container opened as local.
// Written by the planner; the executor must not edit it. Red while the environment is shown twice and semantic text
// uses a -solid colour (3.11:1 in the light theme).
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
const PG = `pq075-pg-${process.pid}`
/** WCAG contrast of a node's text against the first opaque background behind it. */
async function contrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate(el => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
    const lum = ([r, g, b]: number[]) => { const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
    let back: number[] = [255, 255, 255]
    for (let node: Element | null = el; node; node = node.parentElement) { const bg = rgb(getComputedStyle(node).backgroundColor); if (bg.length >= 3 && (bg[3] ?? 1) >= 0.99) { back = bg; break } }
    const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(back)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}
test('PQ-07·5 in the app: one environment pill, and the read-write badge reads at 4.5:1 in both themes', async () => {
  const reason = noContainerEngine()
  test.skip(reason !== null, reason ?? '')
  test.setTimeout(400_000)
  await startPostgres(PG)
  for (const appearance of ['light', 'dark'] as const) {
    const { app, page, workspaceRoot } = await launchApp({ appearance, realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
    try {
      await openDemoWorkspace(page, workspaceRoot)
      await connectContainer(page, PG)
      // The connection writes (read-write badge) and is local: what the item saw in the light theme.
      await page.evaluate(async name => {
        const oxe = (window as unknown as { oxe: { oxeQuery: { call: (op: string, input: unknown) => Promise<{ ok: boolean; value: Array<Record<string, unknown>> }> } } }).oxe
        const listed = await oxe.oxeQuery.call('connections.list', {})
        const found = listed.value.find(item => item.name === name)!
        await oxe.oxeQuery.call('connections.save', { ...found, readOnly: false, environment: 'local' })
      }, PG)
      await page.reload(); await openOxeQuery(page)
      await page.getByRole('button', { name: new RegExp(`^${PG}`) }).first().click()
      await expect(page.locator('.oq-badge[data-readonly="false"]').first()).toBeVisible({ timeout: 60_000 })
      const local = cat('environment.short.local')
      const shown = await page.locator('.oq-view').first().evaluate((view, text) => [...view.querySelectorAll('*')]
        .filter(el => el.children.length === 0 && el.textContent?.trim() === text && el.getClientRects().length > 0).length, local)
      expect(shown, `"${local}" appears once (${appearance})`).toBe(1)
      expect(await contrast(page, '.oq-badge[data-readonly="false"]'), `read-write badge contrast (${appearance})`).toBeGreaterThanOrEqual(4.5)
    } finally {
      await app.close()
    }
  }
  stopContainer(PG)
})
