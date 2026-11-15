// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-85, BRD-16), in the built app with real
// terminals (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T35 lands.
// Contract: the terminal's "More pane actions" menu holds at most 8 own items, none disabled, grouped by separators, with
// any Close/Kill item alone in the last group; Esc closes it.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../../helpers/launch'

test('BRD-16 in the app: the terminal menu is short and ordered', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('[data-testid="pane-container"]').first().getByRole('button', { name: 'More pane actions' }).click()
    const menu = page.getByTestId('pane-actions-menu')
    await expect(menu).toBeVisible()
    const layout = await menu.evaluate(root => [...root.querySelectorAll('[role]')].filter(el => el.closest('[role="menu"]') === root)
      .flatMap(el => /^(menuitem|menuitemcheckbox|menuitemradio)$/.test(el.getAttribute('role') ?? '')
        ? [{ kind: 'item', name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(), disabled: el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true }]
        : el.getAttribute('role') === 'separator' ? [{ kind: 'separator', name: '', disabled: false }] : []))
    const items = layout.filter(row => row.kind === 'item')
    expect(items.length, items.map(item => item.name).join(' | ')).toBeLessThanOrEqual(8)
    expect(items.filter(item => item.disabled).map(item => item.name)).toEqual([])
    expect(layout.some(row => row.kind === 'separator'), 'grouped').toBe(true)
    const last = layout.slice(layout.map(row => row.kind).lastIndexOf('separator') + 1).filter(row => row.kind === 'item')
    const destructive = items.filter(item => /^(close|kill|delete|remove)\b/i.test(item.name))
    for (const item of destructive) expect(last.map(row => row.name)).toContain(item.name)
    for (const item of last) if (destructive.length) expect(item.name).toMatch(/^(close|kill|delete|remove)\b/i)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  } finally {
    await app.close()
  }
})
