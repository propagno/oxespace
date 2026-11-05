import { _electron as electron, expect, test } from '@playwright/test'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { realProfile, quitReal } from './real-app'
import { writeFutureDatabase } from './future-db'

/**
 * T87 (HML, v1.4.1 post-release): a database this version cannot open (here one a newer OXESpace stamped at a future
 * user_version) shows one blocking screen with the reason and the three ways out. Before, the window started empty
 * ("Could not load conversations", New workspace doing nothing) and read as lost data.
 */
test('a database from a newer OXESpace shows the startup failure screen, not an empty app', async () => {
  test.setTimeout(120_000)
  const profile = realProfile('t87')
  writeFutureDatabase(profile.db, 999)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: profile.env })
  try {
    const page = await app.firstWindow()
    const screen = page.getByTestId('startup-failure')
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(screen).toHaveAttribute('data-code', 'newer-schema')
    await expect(screen.getByRole('heading', { level: 2 })).toHaveText('This data comes from a newer OXESpace')
    await expect(screen).toContainText(join(profile.root, 'db-backups'))
    for (const name of ['Open the backups folder', 'Copy details', 'Quit']) await expect(screen.getByRole('button', { name })).toBeVisible()
    // The error's own words are folded under Details.
    await screen.getByText('Details', { exact: true }).click()
    await expect(screen).toContainText('created by a newer OXESpace version')
    // Nothing of the normal interface mounted behind it, and no handler of it is there to half work.
    await expect(page.getByTestId('btn-new-workspace')).toHaveCount(0)
    await expect(page.getByText('Could not load conversations')).toHaveCount(0)
    const listed = await page.evaluate(async () => {
      try { await (window as unknown as { oxe: { thread: { list(): Promise<unknown> } } }).oxe.thread.list(); return 'answered' } catch (error) { return String(error) }
    })
    expect(listed).toContain('No handler registered')
    // Copy details puts the code, the paths and the message on the clipboard.
    await screen.getByRole('button', { name: 'Copy details' }).click()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Startup failure: newer-schema')
    expect(copied).toContain(profile.db)
    expect(copied).toContain('created by a newer OXESpace version')
  } finally {
    await quitReal(app)
    rmSync(profile.root, { recursive: true, force: true })
  }
})
