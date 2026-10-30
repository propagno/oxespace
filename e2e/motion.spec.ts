import { expect, test, type Page } from '@playwright/test'
import { launchApp, resizeWindow } from './helpers/launch'

/**
 * Motion (docs/design/motion.md), checked in the running app on the design system viewer's Motion section, which
 * holds every loop and a real dialog. Full plays the three keyframes and the dialog's entrance; Reduced leaves no
 * animation longer than 0ms except the one spin, which turns slowly.
 */
const KEYFRAMES = ['oxe-pulse', 'oxe-shimmer', 'oxe-spin']

/** Every CSS animation running in the document: its keyframes and how long one iteration lasts, in ms. */
const running = (page: Page) => page.evaluate(() => document.getAnimations()
  .filter((animation): animation is CSSAnimation => 'animationName' in animation)
  .map(animation => ({ name: animation.animationName, duration: Number(animation.effect?.getComputedTiming().duration ?? 0) })))

/** The dialog's entrance: the longest transition duration on it, in ms. */
const dialogTransition = (page: Page) => page.getByRole('dialog', { name: 'A dialog enters' }).evaluate(element =>
  Math.max(...getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000))))

const done = async (page: Page) => {
  await page.getByRole('dialog', { name: 'A dialog enters' }).getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('dialog', { name: 'A dialog enters' })).toBeHidden()
}

test('motion: full plays the brand keyframes and entrances; reduced keeps only a slow spin', async () => {
  test.setTimeout(120_000)
  const { app, page, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 900)
    await page.evaluate(() => { document.documentElement.dataset.motion = 'full' })
    await page.keyboard.press('Control+k')
    await expect(page.locator('[cmdk-root]')).toBeVisible()
    await page.keyboard.insertText('Design System')
    await page.locator('[cmdk-item]', { hasText: 'Design System: Open Viewer' }).click()
    const viewer = page.getByRole('dialog', { name: 'Design system' })
    await viewer.getByRole('navigation', { name: 'Design system sections' }).getByRole('button', { name: 'Motion', exact: true }).click()
    await expect(viewer.getByRole('heading', { level: 2, name: 'Loops' })).toBeVisible()
    await expect(viewer.getByRole('status', { name: 'Loading the view' }).first()).toBeVisible()

    // Full: only the three keyframes run, the loader beats at --duration-pulse and a dialog rises in.
    const full = await running(page)
    expect(full.length).toBeGreaterThan(0)
    expect([...new Set(full.map(animation => animation.name))].sort()).toEqual(KEYFRAMES)
    expect(full.filter(animation => animation.name === 'oxe-pulse').every(animation => animation.duration === 1600)).toBe(true)
    expect(full.filter(animation => animation.name === 'oxe-spin').every(animation => animation.duration === 800)).toBe(true)
    await viewer.getByRole('button', { name: 'Open a dialog' }).click()
    expect(await dialogTransition(page)).toBe(200)
    await done(page)

    // Reduced: nothing travels, the dialog appears at once, and every animation but the spin is over in 0ms.
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduce' })
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-shift').trim())).toMatch(/^0(px)?$/)
    await viewer.getByRole('button', { name: 'Open a dialog' }).click()
    expect(await dialogTransition(page)).toBeLessThan(1)
    const reduced = await running(page)
    expect(reduced.filter(animation => animation.duration >= 1).map(animation => animation.name).every(name => name === 'oxe-spin')).toBe(true)
    expect(reduced.filter(animation => animation.name === 'oxe-spin').every(animation => animation.duration === 2400)).toBe(true)
    await done(page)

    // Back to Full: the loops come back.
    await page.evaluate(() => { document.documentElement.dataset.motion = 'full' })
    await expect.poll(async () => (await running(page)).filter(animation => animation.name === 'oxe-pulse' && animation.duration === 1600).length).toBeGreaterThan(0)
    expect(consoleErrors).toEqual([])
  } finally {
    await app.close()
  }
})
