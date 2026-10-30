import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/launch'

// The other specs run in English (e2e/electron-main.cjs pins it); this one starts on a Brazilian Portuguese system.
test('opens in Brazilian Portuguese on a Portuguese system and switches to English from Settings', async () => {
  const { app, page } = await launchApp({ locale: 'pt-BR' })
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    const views = page.getByRole('navigation', { name: 'Visão do aplicativo' })
    await expect(views.getByRole('button', { name: 'Code', exact: true })).toBeVisible()
    await expect(views.getByRole('button', { name: 'Thread', exact: true })).toHaveAttribute('title', /^Thread: conversas com um agente \(.+\)$/)

    await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Configurações', exact: true })).toBeVisible()
    // The dialog is renamed when the language changes, so it is found by role alone.
    const settings = page.getByRole('dialog')
    await settings.getByRole('group', { name: 'Escopo das configurações' }).getByRole('button', { name: 'Aplicativo', exact: true }).click()
    const categories = settings.getByRole('navigation', { name: 'Categorias das configurações' })
    await categories.getByRole('button', { name: /^Agentes/ }).click()
    await expect(settings.getByRole('heading', { name: 'Agentes', exact: true })).toBeVisible()
    await expect(settings.getByTestId('btn-discover-agents')).toHaveAccessibleName('Verificar agentes')
    await categories.getByRole('button', { name: /^Atualizações/ }).click()
    await expect(settings.getByRole('button', { name: 'Procurar atualizações', exact: true })).toBeVisible()
    await categories.getByRole('button', { name: /^Aparência/ }).click()
    await expect(settings.getByRole('heading', { name: 'Aparência', exact: true })).toBeVisible()
    await expect(settings.getByRole('radiogroup', { name: 'Modo' }).getByRole('radio', { name: /^Escuro/ })).toBeVisible()

    const language = settings.getByLabel('Idioma', { exact: true })
    await expect(language).toHaveValue('system')
    await expect(language.locator('option[value="system"]')).toHaveText('Sistema (Português (Brasil))')
    await language.selectOption('en')

    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(settings.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(settings.getByLabel('Language', { exact: true })).toHaveValue('en')
    await expect(settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Updates/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(page.getByRole('navigation', { name: 'Application view' })).toBeVisible()

    // The choice survives a restart of the window.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('navigation', { name: 'Application view' })).toBeVisible()
  } finally {
    await app.close()
  }
})
