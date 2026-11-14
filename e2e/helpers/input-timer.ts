import type { Page } from '@playwright/test'

/** What ends a timed interaction: every check holds in the same frame. */
export interface DoneCheck { selector: string; present?: boolean; text?: string; countAbove?: number }

/** The single-selector form: ends when `selector` is present, or gone when `wantPresent` is false. */
export async function armInputTimer(page: Page, selector: string, wantPresent: boolean): Promise<void> {
  await armInputTimerUntil(page, [{ selector, present: wantPresent }])
}

/**
 * Times one interaction from inside the renderer: from the input event the app receives (the pointer press, or the
 * key that is not a modifier) to the first animation frame where every check holds. Arm it after the
 * setup and right before the action. Playwright's own waits (an element still animating in must be stable before it
 * is clicked) and its protocol round trips happen before that event, so they are not counted: the panels read a flat
 * 250 ms that way, most of it the Panels menu's 120 ms entrance and three round trips (1.5.2 measurement fix).
 */
export async function armInputTimerUntil(page: Page, checks: DoneCheck[]): Promise<void> {
  await page.evaluate((checks) => {
    type Timer = { start: number | null; done: number | null; stop: () => void }
    const scope = window as unknown as { __oxeInputTimer?: Timer }
    scope.__oxeInputTimer?.stop()
    const timer: Timer = { start: null, done: null, stop: () => undefined }
    const begin = (event: Event): void => {
      if (timer.start !== null) return
      if (event instanceof KeyboardEvent && ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
      timer.start = event.timeStamp
    }
    let frame = 0
    const check = (): void => {
      const holds = checks.every(({ selector, present = true, text, countAbove }) => {
        const found = Array.from(document.querySelectorAll(selector)).filter(node => text === undefined || (node.textContent ?? '').includes(text))
        return countAbove !== undefined ? found.length > countAbove : (found.length > 0) === present
      })
      if (timer.start !== null && holds) { timer.done = performance.now(); timer.stop(); return }
      frame = requestAnimationFrame(check)
    }
    timer.stop = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', begin, true)
      window.removeEventListener('keydown', begin, true)
    }
    window.addEventListener('pointerdown', begin, true)
    window.addEventListener('keydown', begin, true)
    frame = requestAnimationFrame(check)
    scope.__oxeInputTimer = timer
  }, checks)
}

/** Waits for the armed timer to end and returns input → done in ms. */
export async function readInputTimer(page: Page, timeout?: number): Promise<number> {
  await page.waitForFunction(() => (window as unknown as { __oxeInputTimer?: { done: number | null } }).__oxeInputTimer?.done != null, undefined, timeout ? { timeout } : undefined)
  return await page.evaluate(() => {
    const timer = (window as unknown as { __oxeInputTimer: { start: number; done: number } }).__oxeInputTimer
    return timer.done - timer.start
  })
}

/** Time since the input event the last armed timer started from, to time a later stage of the same interaction. */
export async function sinceInput(page: Page): Promise<number> {
  return await page.evaluate(() => performance.now() - (window as unknown as { __oxeInputTimer: { start: number } }).__oxeInputTimer.start)
}
