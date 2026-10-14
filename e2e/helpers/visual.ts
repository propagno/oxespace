import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Pixel-regression helper. Baselines are per platform (see playwright.visual.config.ts)
 * because Windows and Linux rasterise fonts differently.
 *
 * Volatile regions are masked rather than the whole surface being skipped, so layout
 * and colour regressions around them are still caught.
 */
/**
 * Elements that come and go with live PTY activity. A mask only exists while its element
 * does, so presence alone would change the screenshot; hiding keeps the layout and gives
 * the same pixels either way. The counted badges (needs you / failed) are deterministic
 * and stay visible.
 */
const HIDDEN_WHEN_LIVE = ['[data-testid="working-indicator"]']

const VOLATILE_SELECTORS = [
  '[data-visual-volatile]',
  '.monaco-editor .cursors-layer',
  '.xterm-cursor-layer',
  'time'
]

export interface SurfaceOptions {
  /** Restrict the comparison to one element instead of the whole window. */
  target?: Locator
  /** Extra regions to mask for this surface only. */
  mask?: Locator[]
  maxDiffPixelRatio?: number
}

/** Waits for fonts and a quiet frame, then compares against the stored baseline. */
export async function expectSurface(page: Page, name: string, options: SurfaceOptions = {}): Promise<void> {
  // The pointer rests wherever the last click was. Hover affordances (pane resize grips,
  // row highlights) would then depend on layout timing, so park it on the title bar.
  await page.mouse.move(2, 2)
  await page.evaluate(() => document.fonts.ready)
  // Two animation frames let layout and transitions settle without a fixed sleep.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}${HIDDEN_WHEN_LIVE.map(selector => `${selector}{visibility:hidden!important}`).join('')}`
  })
  const mask = [...VOLATILE_SELECTORS.map(selector => page.locator(selector)), ...(options.mask ?? [])]
  await expect(options.target ?? page).toHaveScreenshot(`${name}.png`, {
    mask,
    animations: 'disabled',
    maxDiffPixelRatio: options.maxDiffPixelRatio
  })
}
