// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-234, PS-08·3, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0) in pt-BR.
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·3 in the app: the terminal preview header in pt-BR says Prévia do terminal with no --intent solid colours', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', locale: 'pt-BR', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openSettings(page, 'Abrir configurações')
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog).toBeVisible()
    const nav = dialog.getByRole('navigation', { name: 'Categorias das configurações' })
    await nav.getByRole('button', { name: /^Terminal\b/ }).first().click()

    const chrome = dialog.locator('.settings-term-preview-chrome')
    await expect(chrome).toBeVisible()
    const label = chrome.locator('em')
    await expect(label).toHaveText('Prévia do terminal')
    await expect(chrome.locator('span')).toHaveCount(0)

    const { textTransform, intentMatches } = await chrome.evaluate(el => {
      const em = el.querySelector('em')
      const textTransformValue = em ? getComputedStyle(em).textTransform : ''
      const tokens = ['--intent-danger-solid', '--intent-warning-solid', '--intent-success-solid']
      const probe = document.createElement('span')
      el.append(probe)
      const solidColors = tokens.map(t => {
        probe.style.backgroundColor = `var(${t})`
        return getComputedStyle(probe).backgroundColor
      })
      probe.remove()
      const descendants = [el, ...Array.from(el.querySelectorAll('*'))]
      const matches = descendants.filter(node => {
        const bg = getComputedStyle(node).backgroundColor
        return solidColors.includes(bg)
      }).length
      return { textTransform: textTransformValue, intentMatches: matches }
    })
    expect(textTransform).toBe('none')
    expect(intentMatches).toBe(0)
  } finally {
    await app.close()
  }
})
