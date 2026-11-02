import { modeButton } from './helpers/modes'
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from './helpers/launch'
import { installThreadFixtures, registerThreadProject, setThreadState, THREAD_STATES, type ThreadStateName } from './helpers/thread-fixtures'

// The other Thread specs run in English (e2e/electron-main.cjs pins it); this one starts on a Brazilian Portuguese system.
test('Thread main flow in Brazilian Portuguese', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await modeButton(page, 'thread').click()

    const sidebar = page.getByRole('complementary', { name: 'Barra lateral do OxeChat' })
    await expect(sidebar.getByText('Conversas', { exact: true })).toBeVisible()
    await sidebar.getByRole('button', { name: 'Nova conversa em repo', exact: true }).click()
    await page.getByRole('button', { name: 'Criar conversa', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Começar a conversa' })).toBeVisible()

    // Slash commands describe what they do here, in Portuguese.
    const message = page.getByRole('textbox', { name: 'Mensagem', exact: true })
    await message.fill('/')
    await expect(page.getByRole('option', { name: /Mostrar os comandos e skills disponíveis/ }).first()).toBeVisible()
    await expect(page.getByRole('option', { name: /Começar uma nova conversa com as mesmas configurações/ }).first()).toBeVisible()
    await message.press('Escape')
    await message.fill('')

    await setThreadState(app, workspaceRoot, 'conversation')
    await expect(page.getByText('Use an HttpOnly cookie.')).toBeVisible()

    // Header ⋯: pin, text size and the transcript views.
    await page.locator('.thread-heading-actions').getByRole('button', { name: 'Mais ações', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Fixar conversa' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Diminuir texto' })).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: /Detalhada/ })).toBeVisible()
    await page.keyboard.press('Escape')

    // Sidebar ⋯ → archive asks first, in Portuguese, and Cancel keeps the conversation.
    await sidebar.getByRole('button', { name: 'Ações de Authentication flow', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Arquivar conversa' }).click()
    const confirm = page.getByRole('dialog', { name: 'Arquivar esta conversa?' })
    await expect(confirm).toContainText('“Authentication flow”')
    await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(sidebar.getByText('Authentication flow', { exact: true })).toBeVisible()

    // A failed sign-in offers the way back in Portuguese.
    await setThreadState(app, workspaceRoot, 'auth-failure')
    await expect(page.getByText('Entre no Claude Code', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconectar', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  } finally {
    await app.close()
  }
})

/**
 * Screenshots of every Thread state for a person to review (truncated labels, alignment), never compared or
 * committed. Runs only with OXESPACE_THREAD_SHOTS=<folder>; OXESPACE_THREAD_SHOTS_LOCALE (pt-BR or en) and
 * OXESPACE_THREAD_SHOTS_MODE (light or dark) pick the language and the appearance.
 */
test('captures the Thread states for review', async () => {
  const folder = process.env.OXESPACE_THREAD_SHOTS
  test.skip(!folder, 'set OXESPACE_THREAD_SHOTS to a folder to capture')
  test.setTimeout(240_000)
  const locale = process.env.OXESPACE_THREAD_SHOTS_LOCALE ?? 'pt-BR'
  const mode = (process.env.OXESPACE_THREAD_SHOTS_MODE ?? 'light') as Appearance
  const { app, page, workspaceRoot } = await launchApp({ locale, appearance: mode })
  const shot = (page: Page, name: string) => page.screenshot({ path: join(folder!, `thread-${name}-${locale}-${mode}.png`) })
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    const pt = locale === 'pt-BR'
    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: pt ? 'Nova conversa em repo' : 'New conversation in repo', exact: true }).click()
    await shot(page, 'create-dialog')
    await page.getByRole('button', { name: pt ? 'Criar conversa' : 'Create conversation', exact: true }).click()
    await page.locator('.thread-timeline').waitFor()
    for (const state of Object.keys(THREAD_STATES) as ThreadStateName[]) {
      await setThreadState(app, workspaceRoot, state)
      await expect(page.locator('.thread-view')).toContainText(THREAD_STATES[state].title.split(' ')[0])
      await shot(page, state)
    }
    await page.locator('.thread-heading-actions .thread-icon-action').first().click()
    await shot(page, 'header-menu')
    await page.keyboard.press('Escape')
    await page.locator('.thread-navigation-row .thread-row-action').last().click()
    await shot(page, 'row-menu')
    await page.keyboard.press('Escape')
    const message = page.getByRole('textbox', { name: pt ? 'Mensagem' : 'Message', exact: true })
    await message.click()
    await message.fill('/')
    await page.getByRole('listbox').first().waitFor()
    await shot(page, 'commands')
  } finally {
    await app.close()
  }
})
