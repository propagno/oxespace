import { expect, test, type Page } from '@playwright/test'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * F30 (S3, UX-03) · The activity center survives a restart.
 * Roadmap acceptance: close and reopen with 5 entries → all 5 appear, with read/unread kept.
 * REAL app: main's store (#294) is the source; the entries are recorded the way the window records them.
 */
type Api = { activity: { record: (e: unknown[]) => Promise<{ ok: boolean }>; seen: (at: number) => Promise<unknown> } }

test('F30: five entries and their read state come back after the app closes', async () => {
  const profile = realProfile('f30', { OXESPACE_LOCALE: 'en-US' })
  const now = Date.now()
  const entries = [1, 2, 3, 4, 5].map(i => ({ source: 'thread', id: `acc-thread-${i}`, kind: i <= 2 ? 'needs-you' : 'finished', target: { type: 'thread', threadId: `acc-thread-${i}` }, title: `Acceptance entry ${i}`, at: now - (6 - i) * 60_000 }))
  let { app, page } = await launchReal(profile)
  try {
    const recorded = await page.evaluate(e => (window as unknown as { oxe: Api }).oxe.activity.record(e), entries)
    expect(recorded.ok).toBe(true)
    // The person looked at the list after the 3rd entry: 1–3 are read, 4–5 unread.
    await page.evaluate(at => (window as unknown as { oxe: Api }).oxe.activity.seen(at), entries[2].at)
  } finally { await quitReal(app) }

  ;({ app, page } = await launchReal(profile))
  try {
    await expect(page.getByTestId('activity-count'), 'two unread after the restart').toHaveText('2', { timeout: 10_000 })
    await openCenter(page)
    const center = page.getByTestId('activity-center')
    await expect(center.getByTestId('activity-item'), 'all five are back').toHaveCount(5)
    for (const e of entries) await expect(center.getByText(e.title)).toBeVisible()
  } finally { await quitReal(app) }
})

async function openCenter(page: Page): Promise<void> {
  await page.getByTestId('activity-bell').click()
  await expect(page.getByTestId('activity-center')).toBeVisible()
}
