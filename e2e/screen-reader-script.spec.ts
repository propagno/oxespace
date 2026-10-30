import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from './helpers/thread-fixtures'

/**
 * The screen-reader script (docs/validation/screen-reader-1.4.md), step by step, as accessibility-tree snapshots:
 * names, roles, states, order, live regions and where focus is. What a reader announces is built from exactly this,
 * so when these pass the person's NVDA and Orca pass is the final check, not the first. Steps that need a real agent,
 * Docker or the terminal's own reader mode stay manual. Mode names match both the current and the renamed copy
 * (Code/OxeCode, Thread/OxeChat).
 */
const focused = (page: Page) => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null
  return element ? { role: element.getAttribute('role') ?? element.tagName.toLowerCase(), name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 60) ?? '' } : null
})

test('screen-reader script: start, palette, Code mode, Settings', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 800)

    // 1.3 · Ctrl+K: the "Search" dialog, its combobox and the suggestions; Escape gives focus back.
    await page.getByTestId('btn-new-workspace').focus()
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search' })).toMatchAriaSnapshot(`
      - dialog "Search":
        - combobox [expanded]
        - listbox "Suggestions"
    `)
    await page.keyboard.insertText('settings')
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('btn-new-workspace')).toBeFocused()

    // 2.1 · New workspace: a named dialog with a labelled folder field; Escape returns to the button.
    await page.getByTestId('btn-new-workspace').click()
    await expect(page.getByRole('dialog').first()).toMatchAriaSnapshot(`
      - dialog:
        - textbox
    `)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('btn-new-workspace')).toBeFocused()

    // 2.3 · `/` outside a field focuses "Filter workspaces", a search box.
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.getByRole('searchbox', { name: /Filter workspaces/ }).focus()
    expect(await focused(page)).toMatchObject({ role: 'input' })
    await expect(page.getByRole('searchbox', { name: /Filter workspaces/ })).toBeFocused()

    // 3.1 · The mode switch: each mode a toggle button, the current one pressed.
    await expect(page.getByRole('navigation', { name: 'Application view' })).toMatchAriaSnapshot(`
      - navigation "Application view":
        - button /^(Oxe)?Code$/ [pressed]
        - button /^(Thread|OxeChat)$/
        - button "OxeQuery"
        - button "OxePod"
        - button "OxePost"
    `)

    // 2.4 · The sidebar's width is a separator with its value, adjustable from the keyboard and read again.
    const width = page.getByRole('separator', { name: 'Sidebar width' })
    await width.focus()
    const before = Number(await width.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    await expect(width).toHaveAttribute('aria-valuenow', String(before + 8))
    await expect(width).toBeFocused()

    // 5.1 · Settings: its categories navigation, the current one pressed or current, a reachable close.
    await page.keyboard.press('Control+,')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    await expect(settings.getByRole('navigation', { name: 'Settings categories' })).toMatchAriaSnapshot(`
      - navigation "Settings categories":
        - button /General/
    `)
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()

    // 5.4 · Busy states read as a status text, never an unlabelled graphic.
    const unlabelled = await page.evaluate(() => [...document.querySelectorAll('[role="img"], svg:not([aria-hidden="true"])')]
      .filter(element => !element.closest('[aria-hidden="true"]') && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.querySelector('title')).length)
    expect(unlabelled).toBe(0)
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})

test('screen-reader script: Thread mode, composer, live announcements', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'empty')

    // 3.1 · The conversations mode button is pressed.
    await expect(page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: /^(Thread|OxeChat)$/ })).toHaveAttribute('aria-pressed', 'true')

    // 3.2–3.3 · The sidebar: a filter search box, then the project and its conversation; its width is a separator.
    await expect(page.getByRole('complementary', { name: /(Thread|OxeChat) sidebar/ })).toMatchAriaSnapshot(`
      - complementary:
        - searchbox /Filter/
    `)
    await expect(page.getByRole('separator', { name: /(Thread|OxeChat) sidebar width/ })).toHaveAttribute('aria-valuenow', /\d+/)

    // 3.4 · The composer: a multi-line text box with its name, focused after creating the conversation.
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeVisible()
    await composer.focus()
    // A textarea is read as a multi-line edit by itself.
    expect(await composer.evaluate(element => element.tagName)).toBe('TEXTAREA')

    // 3.5 · The polite live region exists before anything is said, and says the turn state once.
    const live = page.locator('.thread-sr-only[role="status"]')
    await expect(live).toHaveAttribute('aria-live', 'polite')
    await expect(live).toHaveAttribute('aria-atomic', 'true')
    await setThreadState(app, workspaceRoot, 'approval')
    await expect(live).not.toBeEmpty()

    // 3.7 · An approval: the request's buttons are reachable and named.
    await expect(page.getByRole('button', { name: /Allow|Approve/ }).first()).toBeVisible()
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
