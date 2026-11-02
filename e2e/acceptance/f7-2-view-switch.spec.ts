import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * F7.2 (S6, CCR approved) · Switching views and loading, per docs/design/motion.md "Switching views and loading" (#348).
 * Acceptance:
 * 1. the mode button is selected (aria-pressed) and busy (aria-busy) within 50 ms of the click;
 * 2. the previous view stays on screen until the new one commits, with no dimming, spinner or brand loader over it;
 * 3. a skeleton (the new view's own) only from 300 ms on; never the brand loader, never a bare spinner;
 * 5. focus and the announcement move at the commit: focus lands in the new view, the mode name is announced once; keys
 *    typed into the old view before the commit stay in the old view;
 * 6. reduced motion: same rules, no cross-fade.
 *
 * A frame recorder runs in the page from the pointerdown on the button until the new view is settled, sampling every
 * animation frame. It reads the data hooks F7.2 adds: `data-view` on each view's host and `data-skeleton` on skeletons. The cold switch is OxeCode → OxeQuery (its chunk is not loaded yet); a second run slows the CPU
 * ×6 (as e2e/oxequery-typing does) so the switch crosses 300 ms and the skeleton rule is exercised. e2e doubles (OXESPACE_E2E_MOCK_NATIVE).
 */
type Frame = { t: number; pressed: boolean; busy: boolean; oldUp: boolean; newUp: boolean; skeleton: boolean; brand: boolean; spinner: boolean; dimmed: boolean; focusInNew: boolean; fading: boolean }
type Record = { t0: number; frames: Frame[]; announced: string[]; keys: Array<{ t: number; where: 'old' | 'new' | 'other' }> }

async function arm(page: Page): Promise<void> {
  await page.evaluate(() => {
    const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
    const oldView = () => document.querySelector('[data-view="code"]')
    const newView = () => [...document.querySelectorAll('[data-view="data"]')].find(visible) ?? null
    const rec: Record = { t0: 0, frames: [], announced: [], keys: [] }
    ;(window as unknown as { __f72: Record }).__f72 = rec
    const button = document.querySelector('button[data-app-mode="data"]')!
    button.addEventListener('pointerdown', () => {
      rec.t0 = performance.now()
      const end = rec.t0 + 3_000
      const sample = () => {
        const t = performance.now() - rec.t0
        const old = oldView(), next = newView()
        const main = document.querySelector('main') ?? document.body
        const inMain = (sel: string) => [...main.querySelectorAll(sel)].some(visible)
        // DIAG (#363 CI, skeleton before 300 ms): which skeleton, and where.
        const sk = [...main.querySelectorAll('[data-skeleton]')].find(visible)
        if (sk && t < 300) (rec as unknown as { early?: string[] }).early = [...((rec as unknown as { early?: string[] }).early ?? []), `${Math.round(t)}:${sk.closest('[data-view]')?.getAttribute('data-view') ?? 'none'}:${sk.closest('[data-testid]')?.getAttribute('data-testid') ?? ''}:${(sk.parentElement?.className ?? '').toString().slice(0, 60)}`].slice(0, 6)
        rec.frames.push({
          t, pressed: button.getAttribute('aria-pressed') === 'true', busy: button.getAttribute('aria-busy') === 'true',
          oldUp: visible(old), newUp: !!next, skeleton: inMain('[data-skeleton]'), brand: inMain('[data-brand-loader]'), spinner: inMain('[class*="spinner"]'),
          dimmed: !!old && Number(getComputedStyle(old).opacity) < 1,
          focusInNew: !!next && !!document.activeElement && next.contains(document.activeElement),
          fading: document.getAnimations().some(a => { const k = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? []; return k.some(f => 'opacity' in f) && !!(a.effect as KeyframeEffect).target?.closest?.('main') && Number((a.effect as KeyframeEffect).getTiming().duration) > 1 })
        })
        if (performance.now() < end) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, { capture: true, once: true })
    new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) { const text = (n.textContent ?? '').trim(); if (text && (n.parentElement?.closest('[aria-live]') || (n as Element).closest?.('[aria-live]'))) rec.announced.push(text) } })
      .observe(document.body, { subtree: true, childList: true, characterData: true })
    document.addEventListener('keydown', e => {
      if (!rec.t0) return
      const target = e.target as Element
      rec.keys.push({ t: performance.now() - rec.t0, where: target.closest('[data-view="code"]') ? 'old' : target.closest('[data-view="data"]') ? 'new' : 'other' })
    }, true)
  })
}

const commitAt = (r: Record) => r.frames.find(f => f.newUp)?.t ?? Infinity

// `keys`: typing into the old view continues across the switch (keys in flight); the idle case presses with the terminal
// quiet, so app work put before the first paint shows (TECH LEAD on #363).
for (const variant of [
  { name: 'normal speed', cpu: 1, motion: 'full', keys: true },
  { name: 'slow CPU ×6', cpu: 6, motion: 'full', keys: true },
  { name: 'slow CPU ×6, terminal idle', cpu: 6, motion: 'full', keys: false },
  { name: 'reduced motion', cpu: 1, motion: 'reduce', keys: true }
] as const) {
  test(`F7.2: a cold switch to OxeQuery follows the view-switch rules (${variant.name})`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot } = await launchApp({ locale: 'en-US' })
    try {
      await resizeWindow(app, 1280, 860)
      // The switch must be cold: the idle preload warms the most recent view (src/lib/idlePreload.ts), which an earlier
      // run in this profile may have left as OxeQuery (#363 CI, Linux: the chunk was loaded and the switch was warm). The
      // warm path is covered in tests/view-switch.test.tsx.
      await page.evaluate(() => { localStorage.setItem('oxe.preload', 'off'); localStorage.removeItem('oxe.recent-view') })
      await page.reload()
      await openDemoWorkspace(page, workspaceRoot)
      await expect(page.locator('[data-testid="pane-container"]').first()).toBeVisible({ timeout: 15_000 })
      if (variant.motion === 'reduce') await page.evaluate(() => { document.documentElement.dataset.motion = 'reduce' })
      const cdp = await page.context().newCDPSession(page)
      if (variant.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: variant.cpu })
      // Typing into the old view starts before the click, so keys are in flight across the switch.
      await page.locator('[data-testid="pane-container"] .xterm').first().click()
      await arm(page)
      // No hover first: hovering would prefetch the chunk (rule 4) and the switch would no longer be cold.
      await page.locator('button[data-app-mode="data"]').dispatchEvent('pointerdown')
      await page.locator('button[data-app-mode="data"]').dispatchEvent('click')
      if (variant.keys) await page.keyboard.type('f72', { delay: 5 })
      await page.waitForTimeout(3_500)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      const rec = await page.evaluate(() => (window as unknown as { __f72: Record }).__f72)
      const commit = commitAt(rec)
      console.log(`[F72-DIAG] ${variant.name}: commit ${commit.toFixed(0)} ms, selected ${rec.frames.find(f => f.pressed)?.t.toFixed(0)} ms, busy ${rec.frames.find(f => f.busy)?.t.toFixed(0)} ms, first frame ${rec.frames[0]?.t.toFixed(0)} ms, early skeletons ${JSON.stringify((rec as unknown as { early?: string[] }).early ?? [])}`)
      // Content at: the new view up without its skeleton; past 300 ms React's fallback hold can push it to ~600 ms (#363 review L3).
      const contentAt = rec.frames.find(f => f.newUp && !f.skeleton)?.t ?? Infinity
      test.info().annotations.push({ type: 'timings', description: `selected at ${rec.frames.find(f => f.pressed)?.t.toFixed(0)} ms, commit at ${commit.toFixed(0)} ms, content at ${contentAt.toFixed(0)} ms, ${rec.frames.length} frames` })

      expect(commit, 'the new view commits').toBeLessThan(Infinity)
      // 1. Acknowledged by the control within 50 ms.
      const ack = rec.frames.find(f => f.pressed && (f.busy || f.newUp))
      const firstFrame = rec.frames[0]
      if (variant.cpu === 1) expect.soft(ack?.t ?? Infinity, 'selected and busy within 50 ms').toBeLessThanOrEqual(50)
      else if (variant.keys) {
        // CPU ×6 with keys in flight: the terminal is handling input already queued before the first paint, so the rule
        // is the first painted frame, with a cap so a regression cannot hide (docs/design/motion.md, F7.2, TECH LEAD).
        expect.soft(Boolean(firstFrame?.pressed && (firstFrame.busy || firstFrame.newUp)), 'selected and busy in the first frame after the press').toBe(true)
        expect.soft(firstFrame?.t ?? Infinity, 'the first frame after the press within 800 ms').toBeLessThanOrEqual(800)
      } else expect.soft(ack?.t ?? Infinity, 'selected and busy within 300 ms (50 ms at CPU ×6), terminal idle').toBeLessThanOrEqual(300)
      // 2. The old view stays until the commit, never dimmed; no spinner or brand loader at any frame.
      const before = rec.frames.filter(f => f.t < commit)
      expect.soft(before.every(f => f.oldUp), 'the old view stays up until the commit').toBe(true)
      expect.soft(before.some(f => f.dimmed), 'the old view is never dimmed').toBe(false)
      expect.soft(rec.frames.some(f => f.brand), 'no brand loader on a view switch').toBe(false)
      expect.soft(rec.frames.some(f => f.spinner && !f.newUp), 'no bare spinner over the old view').toBe(false)
      // 3. A skeleton only from 300 ms on.
      expect.soft(rec.frames.filter(f => f.skeleton && f.t < 300).map(f => Math.round(f.t)), 'no skeleton before 300 ms').toEqual([])
      // Busy clears once the view is in.
      expect.soft(rec.frames.at(-1)?.busy, 'busy clears after the commit').toBe(false)
      // 5. Focus and announcement at the commit.
      expect.soft(rec.frames.filter(f => f.focusInNew && f.t < commit).length, 'focus does not move before the commit').toBe(0)
      expect.soft(rec.frames.at(-1)?.focusInNew, 'focus lands in the new view').toBe(true)
      expect.soft(rec.announced.filter(a => /OxeQuery/.test(a)).length, 'the mode name is announced once').toBe(1)
      const early = rec.keys.filter(k => k.t < commit)
      expect.soft(early.filter(k => k.where !== 'old').map(k => `${k.where}@${Math.round(k.t)}`), 'keys typed before the commit stay in the old view').toEqual([])
      // 6. Reduced motion: no cross-fade at any frame. With data-motion="reduce" every animation runs once for 0.01ms
      // (docs/design/motion.md, src/styles/base.css); only an animation that lasts is a fade (#363 CI).
      if (variant.motion === 'reduce') expect.soft(rec.frames.some(f => f.fading), 'no cross-fade with reduced motion').toBe(false)
    } finally { await app.close() }
  })
}
