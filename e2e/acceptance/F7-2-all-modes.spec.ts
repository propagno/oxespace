import { expect, test, type Page } from '@playwright/test'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * F7.2 · #363, black box on the REAL app (no doubles), every mode, cold and warm, by click and by Ctrl+1..5:
 * - the mode button reads pressed in the first frame after the press;
 * - the old view stays until the new one is up, never dimmed, with no brand loader, bare spinner or early skeleton
 *   (before 300 ms);
 * - with reduced motion, no fade.
 * #363's own spec (f7-2-view-switch) covers the OxeQuery cold switch frame by frame, keys in flight and the slow CPU.
 */
const MODES = [['thread', 'Control+2'], ['data', 'Control+3'], ['pods', 'Control+4'], ['post', 'Control+5'], ['code', 'Control+1']] as const
type Sample = { t: number; pressed: boolean; oldUp: boolean; newUp: boolean; skeleton: boolean; brand: boolean; dimmed: boolean; fading: boolean }

async function switchTo(page: Page, from: string, to: string, how: 'click' | string) {
  await page.evaluate(({ from, to }) => {
    const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
    const w = window as unknown as { __s: Sample[]; __t0: number }
    w.__s = []; w.__t0 = 0
    const start = () => {
      if (w.__t0) return
      w.__t0 = performance.now()
      const sample = () => {
        const t = performance.now() - w.__t0
        const main = document.querySelector('main') ?? document.body
        const oldV = document.querySelector(`[data-view="${from}"]`), newV = [...document.querySelectorAll(`[data-view="${to}"]`)].find(visible) ?? null
        // DIAG (FE, F7.2 follow-up): on a frame with neither view up, every [data-view] host as the browser sees it.
        const empty = !visible(oldV) && !newV
        const hosts = empty ? [...document.querySelectorAll('[data-view]')].map(e => {
          const cs = getComputedStyle(e); const r = e.getBoundingClientRect()
          return { view: e.getAttribute('data-view'), visibility: cs.visibility, display: cs.display, contentVisibility: cs.getPropertyValue('content-visibility'), opacity: cs.opacity,
            position: cs.position, offsetParentNull: (e as HTMLElement).offsetParent === null, hidden: (e as HTMLElement).hidden, inert: (e as HTMLElement).inert, ariaHidden: e.getAttribute('aria-hidden'),
            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: String((e as HTMLElement).className).slice(0, 60) }
        }) : undefined
        w.__s.push({ ...(hosts ? { hosts } : {}),
          t, pressed: document.querySelector(`button[data-app-mode="${to}"]`)?.getAttribute('aria-pressed') === 'true',
          oldUp: visible(oldV), newUp: !!newV,
          skeleton: [...main.querySelectorAll('[data-skeleton]')].some(visible), brand: [...main.querySelectorAll('[data-brand-loader]')].some(visible),
          dimmed: !!oldV && visible(oldV) && Number(getComputedStyle(oldV).opacity) < 1,
          fading: document.getAnimations().some(a => { const e = a.effect as KeyframeEffect | null; return !!e && (e.getKeyframes?.() ?? []).some(f => 'opacity' in f) && !!(e.target as Element | null)?.closest?.('main') && Number(e.getTiming().duration) > 1 })
        })
        if (t < 2_500 && !(w.__s.length > 3 && w.__s.slice(-3).every(s => s.newUp))) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }
    // Armed on the digit's keydown (Ctrl+N selects on the digit), never on the Control key a frame earlier (FE on #450).
    const onKey = (e: KeyboardEvent) => { if (/^[1-9]$/.test(e.key) || /^Digit[1-9]$/.test(e.code)) { document.removeEventListener('keydown', onKey, true); start() } }
    document.addEventListener('keydown', onKey, true)
    document.querySelector(`button[data-app-mode="${to}"]`)?.addEventListener('pointerdown', start, { capture: true, once: true })
  }, { from, to })
  if (how === 'click') await page.locator(`button[data-app-mode="${to}"]`).first().click()
  else await page.keyboard.press(how)
  await page.waitForTimeout(2_800)
  return page.evaluate(() => (window as unknown as { __s: Sample[] }).__s)
}

for (const motion of ['full', 'reduce'] as const) {
  test(`F7.2 real app: every mode, cold then warm, by keyboard and click (motion ${motion})`, async () => {
    test.setTimeout(240_000)
    const profile = realProfile(`f72${motion}`, { OXESPACE_LOCALE: 'en-US' })
    const { app, page } = await launchReal(profile)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
    const rows: string[] = []
    try {
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
        dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
      })
      await page.emulateMedia({ reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' })
      await openRepo(page, profile.repo)
      await page.locator('[data-testid="pane-container"] .xterm').first().click()
      for (const round of ['cold', 'warm'] as const) {
        let from = 'code'
        for (const [to, key] of MODES) {
          const how = round === 'cold' ? key : 'click'
          const s = await switchTo(page, from, to, how)
          const commit = s.find(x => x.newUp)?.t ?? Infinity
          const first = s[0]
          const before = s.filter(x => x.t < commit)
          const row = { round, to, how, frames: s.length, firstPressed: first?.pressed, commit: Math.round(commit),
            oldGone: before.some(x => !x.oldUp), dimmed: s.some(x => x.dimmed), brand: s.some(x => x.brand),
            earlySkeleton: s.some(x => x.skeleton && x.t < 300), fading: s.some(x => x.fading) }
          rows.push(JSON.stringify(row))
          const emptyFrames = s.filter(x => (x as Sample & { hosts?: unknown }).hosts)
          if (emptyFrames.length) rows.push('EMPTY ' + JSON.stringify({ round, to, motion, frameTimes: s.map(x => Math.round(x.t)), empty: emptyFrames.map(x => ({ t: Math.round(x.t), hosts: (x as Sample & { hosts?: unknown }).hosts })) }))
          expect.soft(first?.pressed, `${round} ${to} (${how}): pressed in the first frame`).toBe(true)
          expect.soft(commit, `${round} ${to}: the new view comes up`).toBeLessThan(2_500)
          expect.soft(row.oldGone, `${round} ${to}: the old view stays until the new one is up`).toBe(false)
          expect.soft(row.dimmed, `${round} ${to}: never dimmed`).toBe(false)
          expect.soft(row.brand, `${round} ${to}: no brand loader`).toBe(false)
          expect.soft(row.earlySkeleton, `${round} ${to}: no skeleton before 300 ms`).toBe(false)
          if (motion === 'reduce') expect.soft(row.fading, `${round} ${to}: no fade with reduced motion`).toBe(false)
          from = to
        }
      }
      expect.soft(errors, 'no page error').toEqual([])
    } finally {
      console.log('F72-ALL', motion, '\n' + rows.join('\n'))
      await quitReal(app)
    }
  })
}
