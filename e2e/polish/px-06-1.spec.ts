// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-270, PX-06·1, CA-5; A9), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. In pt-BR the person
// reads, in Settings › Integrations › Phone and devices, what a phone may do: steering a turn is "Orientar um turno em
// andamento" (settings:devices.scope.commands.threadSteer), never "Direcionar". Red on main f65fa5374. (The card's
// queued-message row needs a live steerable turn that the stand-in agent cannot promise on every runner; the composer
// strings themselves are pinned by tests/i18n/oxechat-glossary.test.ts and the amended u62-u63 frozen test.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const read = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
function pt(ns: string, key: string): string {
  let node: unknown = read(`shared/locales/pt-BR/${ns}.json`)
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the pt-BR ${ns} catalog has no key ${key}`)
  return node
}

test('PX-06·1 in the app: in pt-BR what a phone may do says Orientar um turno em andamento', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await openSettings(page, pt('common', 'nav.openSettings'))
    const settings = page.getByRole('dialog', { name: pt('settings', 'center.title'), exact: true })
    await settings.getByRole('navigation', { name: pt('settings', 'center.categories') }).getByRole('button', { name: pt('settings', 'center.sections.devices.label') }).click()
    const can = settings.getByTestId('devices-scope-can')
    await expect(can).toBeVisible({ timeout: 15_000 })
    await expect(can.getByText('Orientar um turno em andamento', { exact: true })).toBeVisible()
    await expect(settings).not.toContainText(/(?<![\p{L}])direcion/iu)
    await page.screenshot({ path: test.info().outputPath('px-06-1.png') })
  } finally {
    await app.close()
  }
})
