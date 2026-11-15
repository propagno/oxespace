// TEMPORARY debug copy of pm-02-8 (never committed): prints the menu DOM at each step, to see why View › Density ›
// Comfortable is not clickable in the built app.
import { test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'

test('debug: View › Density in OxeChat with no workspace', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', density: 'compact', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  const dump = async (label: string): Promise<void> => {
    const menus = await page.evaluate(() => [...document.querySelectorAll('[role=menu], [role=menubar], nav[aria-label=Menu]')].map(el => `${el.getAttribute('role') ?? el.tagName}[${el.getAttribute('aria-label') ?? ''}] state=${el.getAttribute('data-state') ?? ''}: ` + [...el.querySelectorAll('[role^=menuitem], button')].map(item => `${item.getAttribute('role') ?? 'button'}:"${(item.textContent ?? '').trim().slice(0, 40)}"${item.hasAttribute('data-disabled') || item.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : ''}${item.getAttribute('aria-expanded') ? ` exp=${item.getAttribute('aria-expanded')}` : ''}`).join(' | ')).join('\n  '))
    console.log(`[DEBUG] ${label}:\n  ${menus || '(no menus)'}`)
  }
  try {
    await resizeWindow(app, 1440, 900)
    await page.keyboard.press('Control+2')
    await dump('after Ctrl+2')
    await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'View', exact: true }).click()
    await dump('after View click')
    const density = page.getByRole('menuitem', { name: /^Density/ })
    console.log(`[DEBUG] density count=${await density.count()} enabled=${await density.first().isEnabled().catch(() => 'n/a')}`)
    await density.hover()
    await page.waitForTimeout(600)
    await dump('after hover')
    await density.press('ArrowRight').catch(error => console.log(`[DEBUG] ArrowRight failed: ${(error as Error).message.split('\n')[0]}`))
    await page.waitForTimeout(600)
    await dump('after ArrowRight')
    const comfortable = page.getByRole('menuitem', { name: /Comfortable/ })
    console.log(`[DEBUG] comfortable count=${await comfortable.count()}`)
    for (const role of ['menuitemradio', 'menuitemcheckbox', 'menuitem', 'option']) console.log(`[DEBUG] role ${role} /Comfortable/: ${await page.getByRole(role as 'menuitem', { name: /Comfortable/ }).count()}`)
  } finally {
    await app.close()
  }
})
