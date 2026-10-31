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
const HIDDEN_WHEN_LIVE = [
  '[data-testid="working-indicator"]',
  // Terminal canvases are live content. They are hidden rather than masked because a mask
  // is painted over everything, which would cover any overlay (palette, menus) above them.
  '.xterm',
  // Pane resize grips fade in with focus and pointer state, which no fixed wait settles.
  '.resize-handle',
  // Tooltips follow the pointer, which the captures park at a corner; the sidebar header's shows the app version.
  '[role="tooltip"]',
  // A terminal's status dot (pane header, sidebar row) turns from starting to running when its
  // shell is up, which no fixed wait settles; the dot has a fixed size, so hiding it moves nothing.
  '.pane-status-dot',
  // A pane's title follows its shell ("PS>" until the shell renames it "Terminal 4"), which no fixed wait settles.
  '.pane-intent-text',
  '[data-testid="pane-session-row"] .pane-activity-dot',
  // The top bar's path names a temporary folder.
  '.workspace-topbar-path',
  // The app version changes every release; it must not make every baseline stale.
  '[data-app-version]',
  '.split-resize-handle'
]

/**
 * Removed from layout rather than hidden: the top bar's integration chips
 * follow real PTY activity and change width, and as hidden boxes they would still move the
 * actions next to them. Without them the title and the Panels, MCP and Activity actions sit
 * in the same place every run and are compared.
 */
const REMOVED_FROM_LAYOUT = ['.workspace-topbar .workspace-integrations']

const VOLATILE_SELECTORS = [
  '[data-visual-volatile]',
  '.monaco-editor .cursors-layer',
  '.xterm-cursor-layer',
  'time'
]

export interface SurfaceOptions {
  /** Restrict the comparison to one element instead of the whole window. */
  target?: Locator
  /**
   * Elements whose text varies between runs (temp paths, relative times). They are hidden,
   * not masked: a mask box takes the width of the current text, so proportional-font text
   * of different widths moves the box edge by a few pixels and fails the comparison.
   */
  hide?: Locator[]
  /** Per-surface tolerance in pixels; the default lives in playwright.visual.config.ts. */
  maxDiffPixels?: number
  /** Extra regions painted over (fixed-size live content, such as a timer), on top of the volatile ones. */
  mask?: Locator[]
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
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}${[...HIDDEN_WHEN_LIVE, '[data-visual-hidden]'].map(selector => `${selector}{visibility:hidden!important}`).join('')}${REMOVED_FROM_LAYOUT.map(selector => `${selector}{display:none!important}`).join('')}`
  })
  for (const locator of options.hide ?? []) {
    await locator.evaluateAll(elements => elements.forEach(element => element.setAttribute('data-visual-hidden', '')))
  }
  const mask = [...VOLATILE_SELECTORS.map(selector => page.locator(selector)), ...(options.mask ?? [])]
  await expect(options.target ?? page).toHaveScreenshot(`${name}.png`, {
    mask,
    animations: 'disabled',
    // Only override the config default when asked: an explicit `undefined` replaces it.
    ...(options.maxDiffPixels === undefined ? {} : { maxDiffPixels: options.maxDiffPixels })
  })
}
