import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow, setAppearance } from './helpers/launch'
import { openView } from './helpers/oxepod'

// The running containers' status dots in the OxePod sidebar drew as large ovals: the dot also carried the module's
// bare `.success` class (SuccessState's padding). Every dot is a small circle, whatever its status.
test('OxePod status dots are small circles in every state, light and dark', async () => {
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1024, 800)
    await openDemoWorkspace(page, workspaceRoot)
    const pod = page.getByRole('complementary', { name: /OxePod/ })
    const dots = pod.locator('[data-status-dot]')
    for (const appearance of ['light', 'dark'] as const) {
      // setAppearance reloads the window: open OxePod again and wait for a running container's dot.
      await setAppearance(page, appearance)
      await openView(page, 'OxePod')
      await expect(pod.locator('[data-status-dot="success"]').first()).toBeVisible()
      const boxes = await dots.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect()
        return { status: node.getAttribute('data-status-dot'), width: box.width, height: box.height }
      }))
      expect(boxes.map(box => box.status)).toContain('success')
      for (const box of boxes) {
        expect(box.width, `${box.status} dot width`).toBeLessThanOrEqual(10)
        expect(Math.abs(box.width - box.height), `${box.status} dot is round`).toBeLessThan(0.5)
      }
      await pod.screenshot({ path: `e2e/screenshots/oxepod-status-dot/${appearance}.png` })
    }
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
