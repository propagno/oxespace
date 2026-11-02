import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * B9.2 (S4) · A pairing code nobody uses expires on its own (homologation #232).
 * Roadmap acceptance: a pairing with no phone connecting expires within 2 minutes; the code no longer pairs and the
 * Devices screen says it expired instead of showing a live code forever.
 *
 * REAL app: the gateway has to be on, so the OS firewall prompt shows on the runner's screen; gated behind
 * OXESPACE_ACCEPT_FIREWALL=1 like M1. Waits the full 2 minutes plus a margin.
 */
type Remote = { setEnabled: (i: { enabled: boolean }) => Promise<unknown>; startPairing: () => Promise<{ uri: string; expiresAt: number }>; status: () => Promise<Record<string, unknown>> }

test('B9.2: an unused pairing code expires within two minutes', async () => {
  test.skip(process.env.OXESPACE_ACCEPT_FIREWALL !== '1', 'turning the gateway on shows the OS firewall prompt; set OXESPACE_ACCEPT_FIREWALL=1 where that is expected')
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-b92-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.evaluate(() => (window as unknown as { oxe: { remote: Remote } }).oxe.remote.setEnabled({ enabled: true }))
    const startedAt = Date.now()
    const offer = await page.evaluate(() => (window as unknown as { oxe: { remote: Remote } }).oxe.remote.startPairing())
    expect(offer.expiresAt - startedAt, 'the code is announced to expire within 2 min').toBeLessThanOrEqual(120_000 + 1_000)

    // Nobody connects. Past the deadline, main has dropped the offer by itself (no cancel from the screen).
    await page.waitForTimeout(Math.max(0, offer.expiresAt - Date.now()) + 5_000)
    const status = await page.evaluate(() => (window as unknown as { oxe: { remote: Remote } }).oxe.remote.status())
    expect(JSON.stringify(status), 'no live pairing offer after it expired').not.toMatch(/"pairing(Offer)?":\s*\{/)

    // The screen tells the person it expired.
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: /Dispositivos|Devices/ }).locator('visible=true').first().click()
    await expect(page.getByText(/expirou|expirado|expired/i).first(), 'Devices says the code expired').toBeVisible({ timeout: 5_000 })
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})
