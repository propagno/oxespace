import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #221 (F9 Settings › Devices) on main, black box against the pretend gateway (remote-mock): where focus lands on the
 * pairing prompt and whether an immediate Enter pairs; names a person or an agent might try for the computer and for a
 * paired phone; the code withdrawn when leaving the page; the expiry; and, in pt-BR, English left on the page.
 * Output: e2e/screenshots/homologation/check-221/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-221')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 30)}`.trim() : null })

async function openDevices(page: Page, en: boolean) {
  await page.keyboard.press('Control+,')
  const settings = page.locator('.settings-center'); await settings.waitFor({ timeout: 10_000 })
  await settings.getByRole('button', { name: en ? 'Application' : 'Aplicativo', exact: true }).first().click().catch(() => undefined)
  await settings.getByText(en ? 'Devices' : 'Dispositivos', { exact: true }).locator('visible=true').first().click()
  await page.waitForTimeout(500)
  return page.getByTestId('devices-settings')
}

test('Devices, adversarial (en, light)', async () => {
  test.setTimeout(240_000)
  process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT = '1'
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    const devices = await openDevices(page, true)
    await devices.getByRole('switch', { name: 'Let phones on this network connect' }).click()
    const firewall = page.getByRole('dialog', { name: 'Before phones can connect' })
    notes.firewall = { text: (await firewall.innerText().catch(() => '')).slice(0, 500), focus: await focused(page) }
    await page.screenshot({ path: join(OUT, 'firewall.png') })
    await firewall.getByRole('button', { name: 'Turn on' }).click()
    // The computer's name.
    const name = devices.getByRole('textbox', { name: 'Name phones see' })
    const names: Record<string, unknown> = {}
    for (const [label, value] of [['empty', ''], ['65', 'x'.repeat(65)], ['RLO', 'Studio‮exe.txt'], ['system', 'Windows Security'], ['product', 'OXESpace Admin'], ['zero-width', 'Stu​dio']] as const) {
      await name.fill(value)
      const save = devices.getByRole('button', { name: 'Save name' })
      const enabled = await save.isEnabled().catch(() => false)
      if (enabled) await save.click()
      await page.waitForTimeout(400)
      names[label] = { enabled, saved: await name.inputValue(), errors: await devices.locator('[role="alert"], [aria-invalid="true"] ~ *, .error, [class*="error" i]').allInnerTexts().catch(() => []) }
    }
    notes.computerNames = names
    // Pairing: the prompt, its focus and an immediate Enter.
    await devices.getByRole('button', { name: 'Show pairing code' }).click()
    const prompt = page.getByRole('dialog', { name: /Pair .*\?/ })
    await prompt.waitFor({ timeout: 10_000 }).catch(() => undefined)
    notes.prompt = { text: (await prompt.innerText().catch(() => '')).slice(0, 500), buttons: await prompt.getByRole('button').allInnerTexts().catch(() => []), focus: await focused(page) }
    await page.screenshot({ path: join(OUT, 'prompt.png') })
    await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    notes.promptAfterEnter = { open: await prompt.isVisible().catch(() => false), paired: (await devices.getByRole('list', { name: 'Paired phones' }).innerText().catch(() => '')).includes('Pixel 8 Pro') }
    if (await prompt.isVisible().catch(() => false)) await prompt.getByRole('button', { name: 'Pair', exact: true }).click()
    await page.waitForTimeout(500)
    notes.offer = (await devices.getByTestId('devices-pairing-offer').innerText().catch(() => '')).slice(0, 400)
    // Rename the paired phone.
    const renames: Record<string, unknown> = {}
    for (const [label, value] of [['65', 'y'.repeat(65)], ['empty', ''], ['RLO', 'Pixel‮8'], ['HTML', '<b>Pixel</b>'], ['ok', 'Celular do trabalho']] as const) {
      await devices.getByRole('button', { name: /Rename Pixel 8 Pro|Rename Celular/ }).first().click().catch(() => undefined)
      const field = page.getByRole('textbox', { name: /name/i }).last()
      await field.fill(value).catch(() => undefined)
      await page.keyboard.press('Enter'); await page.waitForTimeout(400)
      renames[label] = { list: (await devices.getByRole('list', { name: 'Paired phones' }).innerText().catch(() => '')).replace(/\n/g, ' · ').slice(0, 200), alerts: await page.locator('[role="alert"]').allInnerTexts().catch(() => []) }
      await page.keyboard.press('Escape').catch(() => undefined)
    }
    notes.renames = renames
    // Leave the page and come back: is the code withdrawn?
    await devices.getByRole('button', { name: 'Show pairing code' }).click().catch(() => undefined)
    await page.waitForTimeout(400)
    notes.expiryText = (await devices.innerText()).split('\n').filter(l => /expir|minute|min\b|valid/i.test(l)).slice(0, 4)
    await page.locator('.settings-center').getByText('General', { exact: true }).locator('visible=true').first().click().catch(() => undefined)
    await page.waitForTimeout(300)
    await page.locator('.settings-center').getByText('Devices', { exact: true }).locator('visible=true').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    notes.qrAfterLeaving = await page.getByTestId('devices-pairing-qr').count()
    notes.errors = consoleErrors
  } finally { await app.close(); delete process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT }
})

test('Devices in pt-BR: English left on the page', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    const devices = await openDevices(page, false)
    const text = await devices.innerText().catch(() => '')
    notes.ptText = text.slice(0, 1500)
    notes.ptEnglish = text.split('\n').filter(l => /\b(the|your|phone|pair|turn on|off|port|name|remove|code|allow|devices?)\b/i.test(l) && !/[áéíóúãõçâêô]/i.test(l)).slice(0, 15)
    await page.screenshot({ path: join(OUT, 'pt-devices.png') })
  } finally { await app.close() }
})
