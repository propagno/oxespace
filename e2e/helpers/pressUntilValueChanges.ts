import { appendFileSync } from 'node:fs'
import { expect, test, type Locator } from '@playwright/test'

/**
 * FL-09 (team/estado/flakes.md), TECH LEAD's rc-fix: thread-view's sidebar resize sometimes ends one step short on the
 * loaded linux 3/3 shard, and the cause was not found in isolation. Presses `key` on a separator `times` times, each
 * press checked against the exact value it should give (the value before it plus one step, clamped to aria-valuemin
 * and aria-valuemax). A press that leaves the value unchanged is pressed again, at most `maxRepress` times in the whole
 * call, and every re-press is recorded with what the page saw (a Playwright annotation and a line in the CI job
 * summary). Any other value, such as a jump of more than one step, fails at once. Use it only where FL-09 applies.
 */
export async function pressUntilValueChanges(separator: Locator, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  times: number, options: { step: number; maxRepress?: number; label: string }): Promise<void> {
  const { step, maxRepress = 2, label } = options
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  const read = async (name: string) => Number(await separator.getAttribute(name))
  const [min, max] = [await read('aria-valuemin'), await read('aria-valuemax')]
  // What the page saw around a press that did not land: where each keydown went and what had focus.
  await separator.page().evaluate(() => {
    const w = window as unknown as { __fl09?: string[] }
    if (w.__fl09) return
    w.__fl09 = []
    document.addEventListener('keydown', event => {
      if (!event.key.startsWith('Arrow')) return
      const t = event.target as HTMLElement | null
      const own = t?.getAttribute?.('role') === 'separator'
      w.__fl09!.push(`${event.key}→${own ? `separator(${t!.getAttribute('aria-valuenow')})` : `${t?.tagName}.${String(t?.className ?? '').slice(0, 40)}`}`)
      if (w.__fl09!.length > 40) w.__fl09!.shift()
    }, true)
  })
  let represses = 0
  for (let index = 0; index < times; index++) {
    const before = await read('aria-valuenow')
    const expected = Math.max(min, Math.min(max, before + direction * step))
    for (;;) {
      await separator.press(key)
      if (expected === before) { await expect(separator).toHaveAttribute('aria-valuenow', String(before)); break }
      // The value may render a moment after the key: wait for it to move, then demand the exact step.
      const after = await expect.poll(() => read('aria-valuenow'), { timeout: 2_000 }).not.toBe(before).then(() => read('aria-valuenow'), () => before)
      if (after === expected) break
      expect(after, `${label}: ${key} #${index + 1} from ${before} must give exactly ${expected}`).toBe(before)
      // Unchanged: the press did not land. Record it, then press again within the budget.
      represses++
      const diag = await separator.page().evaluate(() => {
        const w = window as unknown as { __fl09?: string[] }
        const a = document.activeElement as HTMLElement | null
        return `focus=${a?.getAttribute?.('role') === 'separator' ? 'separator' : `${a?.tagName}.${String(a?.className ?? '').slice(0, 40)}`} keys=[${(w.__fl09 ?? []).slice(-12).join(', ')}]`
      })
      const line = `FL-09 re-press ${represses}/${maxRepress}: ${label}, ${key} #${index + 1} from ${before} (expected ${expected}) did not move the value; ${diag}`
      test.info().annotations.push({ type: 'FL-09', description: line })
      console.log(line)
      if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`) } catch { /* summary is best effort */ } }
      expect(represses, `${label}: more than ${maxRepress} presses did not land; ${diag}`).toBeLessThanOrEqual(maxRepress)
    }
  }
}
