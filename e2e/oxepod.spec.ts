import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from './helpers/launch'
import { containerRow, openView } from './helpers/oxepod'
import type Catalog from '../shared/locales/en/pods.json'

/**
 * The OxePod mode in the real renderer, backed by the in-memory container engine of electron/main/e2e/oxequery-mock.ts
 * (pg-dev and mongo-dev in the Compose project "shop", old-job on its own). Live engines run on CI only
 * (tests/live/oxequery-live.test.ts).
 */
const pt = JSON.parse(readFileSync(join(process.cwd(), 'shared', 'locales', 'pt-BR', 'pods.json'), 'utf8')) as typeof Catalog

const sidebar = (page: Page) => page.getByRole('complementary', { name: /OxePod/ })
const pageErrors = (lines: string[]): string[] => lines.filter(line => line.startsWith('pageerror:'))

test('OxePod lists containers by project, opens one, shows its logs, environment and ports, and confirms a remove', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    // Costs nothing until opened; Ctrl+4 opens it from Code, even with a terminal focused.
    expect(await page.locator('.pod-host').count()).toBe(0)
    await page.locator('.xterm').first().click().catch(() => undefined)
    await page.keyboard.press('Control+4')
    await expect(page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxePod' })).toHaveAttribute('aria-pressed', 'true')

    // Grouped by Compose project, then the rest; running first.
    const shop = sidebar(page).getByRole('region', { name: 'Project shop' })
    await expect(shop.getByRole('button')).toHaveText([/mongo-dev\s*27017/, /pg-dev\s*5432/])
    await expect(sidebar(page).getByRole('region', { name: 'Others' })).toContainText('old-job')
    await expect(sidebar(page).getByRole('radiogroup', { name: 'Container engine' }).getByRole('radio', { name: 'Docker' })).toHaveAttribute('aria-checked', 'true')

    // The first running container opens by itself; another is one click away: details, live logs, usage.
    await expect(page.getByRole('region', { name: 'mongo-dev details' })).toBeVisible()
    await containerRow(page, 'pg-dev').click()
    await expect(containerRow(page, 'pg-dev')).toHaveAttribute('aria-current', 'page')
    const detail = page.getByRole('region', { name: 'pg-dev details' })
    await expect(detail).toContainText('postgres:16')
    // The engine's clock may run ahead of this one (the e2e clock is frozen in the past): never "started in 2 weeks".
    await expect(detail).toContainText(/started (now|.* ago)/)
    await expect(detail.getByLabel('Container logs')).toContainText('database system is ready to accept connections')
    await detail.getByRole('searchbox', { name: 'Filter logs' }).fill('checkpoint')
    await expect(detail.getByLabel('Container logs')).not.toContainText('ready to accept')
    await expect(detail.getByLabel('Usage')).toContainText('60.0 MB / 2.00 GB')

    // The environment arrives redacted from the main process; ports say where to reach them.
    await detail.getByRole('tab', { name: 'Environment' }).click()
    const environment = detail.getByRole('table', { name: 'Environment' })
    await expect(environment.getByRole('row', { name: /POSTGRES_USER/ })).toContainText('app')
    await expect(environment.getByRole('row', { name: /POSTGRES_PASSWORD/ })).toContainText('hidden')
    await detail.getByRole('tab', { name: 'Ports' }).click()
    await expect(detail.getByRole('table', { name: 'Ports' })).toContainText('localhost:5432')

    // A database asks before it is stopped.
    await detail.getByRole('button', { name: 'Stop pg-dev' }).click()
    const stop = page.getByRole('dialog', { name: 'Stop pg-dev?' })
    await expect(stop).toContainText('interrupted')
    await stop.getByRole('button', { name: 'Cancel' }).click()

    // Remove always asks, says what stays, and acts only after the confirmation.
    await containerRow(page, 'old-job').click()
    const oldJob = page.getByRole('region', { name: 'old-job details' })
    await oldJob.getByRole('button', { name: 'Remove old-job…' }).click()
    const remove = page.getByRole('dialog', { name: 'Remove the container old-job?' })
    await expect(remove).toContainText('cannot be undone')
    await remove.getByRole('button', { name: 'Cancel' }).click()
    await expect(containerRow(page, 'old-job')).toBeVisible()
    await oldJob.getByRole('button', { name: 'Remove old-job…' }).click()
    await remove.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(containerRow(page, 'old-job')).toHaveCount(0)
    await expect(page.getByRole('region', { name: /^(pg|mongo)-dev details$/ })).toBeVisible()

    // "/" finds a container.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('/')
    await expect(sidebar(page).getByRole('searchbox', { name: 'Filter containers' })).toBeFocused()
    await page.keyboard.type('mongo')
    await expect(sidebar(page).getByRole('region', { name: 'Project shop' }).getByRole('button')).toHaveCount(1)
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})

test('Connect in OxeQuery fills in the connection from a database container and asks only for the password', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openView(page, 'OxePod')
    await containerRow(page, 'pg-dev').click()
    const card = page.getByRole('region', { name: 'Database detected' })
    await expect(card).toContainText('PostgreSQL on localhost:5432')
    await expect(card).toContainText('agents never see it')
    await card.getByRole('button', { name: 'Connect in OxeQuery' }).click()

    await expect(page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' })).toHaveAttribute('aria-pressed', 'true')
    const form = page.getByRole('dialog', { name: 'New connection' })
    await expect(form).toContainText('From the container pg-dev')
    await expect(form.getByLabel('Host')).toHaveValue('127.0.0.1')
    await expect(form.getByLabel('Port')).toHaveValue('5432')
    await expect(form.getByLabel('Password')).toBeFocused()
    await form.getByLabel('Password').fill('dev-password')
    await form.getByRole('button', { name: 'Save and open' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev', exact: true })).toBeVisible()

    // Back in OxePod, the saved connection opens instead of making another one.
    await openView(page, 'OxePod')
    await expect(card).toContainText('Saved as the connection pg-dev.')
    await card.getByRole('button', { name: 'Open in OxeQuery' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog', { name: 'New connection' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('images, clean-up and Compose ask before anything destructive', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openView(page, 'OxePod')

    // The Compose project of the open container.
    const compose = page.getByRole('region', { name: 'Compose project shop' })
    await expect(compose).toContainText('2 services · 2 of 2 running')
    await compose.getByRole('button', { name: 'Logs' }).click()
    await expect(compose).toContainText('web-1  | ready')
    await compose.getByRole('button', { name: 'Close output' }).click()
    await compose.getByRole('button', { name: 'Down…' }).click()
    const down = page.getByRole('dialog', { name: 'Take shop down?' })
    await expect(down).toContainText('Named volumes are kept')
    await down.getByRole('button', { name: 'Cancel' }).click()

    // Images, volumes and networks, with a confirmed remove and confirmed clean-ups.
    await sidebar(page).getByRole('button', { name: 'Images, volumes and networks' }).last().click()
    const resources = page.getByRole('region', { name: 'Images, volumes and networks' })
    await expect(resources.getByRole('table', { name: /^Images/ })).toContainText('postgres')
    await resources.getByRole('radio', { name: /^Volumes/ }).click()
    await resources.getByRole('button', { name: 'Remove volume pg-dev-data' }).click()
    const volume = page.getByRole('dialog', { name: 'Remove volume pg-dev-data?' })
    await expect(volume).toContainText('cannot be recovered')
    await volume.getByRole('button', { name: 'Cancel' }).click()
    await resources.getByRole('button', { name: 'Clean up stopped…' }).click()
    const prune = page.getByRole('dialog', { name: 'Remove every stopped container?' })
    await expect(prune).toContainText('Named volumes stay')
    await prune.getByRole('button', { name: 'Clean up' }).click()
    await expect(page.getByText('Stopped containers removed')).toBeVisible()
    await expect(containerRow(page, 'old-job')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('OxePod explains a stopped container engine and keeps checking', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxepod-engine-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3'), OXE_MOCK_ENGINE: 'stopped'
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await openView(page, 'OxePod')
    const problem = page.getByRole('alert').filter({ hasText: 'Docker is not running' })
    await expect(problem).toBeVisible()
    await expect(problem).toContainText('Start Docker Desktop')
    await expect(problem.getByRole('button', { name: 'Check again' })).toBeEnabled()
    await expect(sidebar(page)).toContainText('Docker: installed, not running')
  } finally { await app.close() }
})

test('OxePod speaks Brazilian Portuguese', async () => {
  test.setTimeout(120_000)
  const { app, page, consoleErrors } = await launchApp({ locale: 'pt-BR' })
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await openView(page, 'OxePod')
    await expect(sidebar(page).getByRole('region', { name: pt.sidebar.project.replace('{{name}}', 'shop') })).toBeVisible()
    await containerRow(page, 'pg-dev').click()
    await expect(sidebar(page).getByRole('region', { name: pt.sidebar.others })).toContainText('old-job')
    const detail = page.getByRole('region', { name: pt.detail.label.replace('{{name}}', 'pg-dev') })
    for (const tab of ['logs', 'stats', 'environment', 'ports', 'terminal', 'command'] as const) await expect(detail.getByRole('tab', { name: pt.tab[tab] })).toBeVisible()
    await expect(page.getByRole('region', { name: pt.bridge.title })).toContainText(pt.bridge.connect)
    await detail.getByRole('button', { name: pt.actions.removeNamed.replace('{{name}}', 'pg-dev') }).click()
    const remove = page.getByRole('dialog', { name: pt.remove.title.replace('{{name}}', 'pg-dev') })
    await expect(remove).toContainText(pt.remove.final)
    await remove.getByRole('button', { name: pt.common.cancel }).click()
    // No catalog key leaked into the page (a key looks like "detail.label").
    const text = await page.locator('.pod-host').innerText() + await sidebar(page).innerText()
    expect(text).not.toMatch(/\b(?:sidebar|detail|actions|tab|stats|remove|environment|ports|bridge|about|compose|engine|view)\.[a-zA-Z]+/)
    expect(consoleErrors.filter(line => /i18next|missingKey/i.test(line))).toEqual([])
  } finally {
    await app.close()
  }
})
