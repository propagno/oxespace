import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, type LaunchedApp } from './helpers/launch'

/**
 * Settings › Devices against the pretend gateway (electron/main/e2e/remote-mock.ts): the firewall note before the first
 * start, the QR and its code, a phone asking to pair, removing it, the computer's name and a terminal a phone may type in.
 */
test('Settings › Devices pairs a phone by QR and removes it', async () => {
  test.setTimeout(120_000)
  // The mock has "Pixel 8" paired; with this flag a "Pixel 8 Pro" asks to pair once a code is on screen.
  process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT = '1'
  let launched: LaunchedApp | undefined
  try {
    launched = await launchApp()
    const { page } = launched
    await openDemoWorkspace(page, launched.workspaceRoot)

    // Off by default: a terminal does not offer typing from the phone yet.
    await page.getByRole('button', { name: 'More pane actions' }).first().click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Allow typing from the phone' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
    await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Devices/ }).click()
    const devices = settings.getByTestId('devices-settings')
    await expect(devices.getByTestId('devices-gateway-state')).toHaveText('Off. No port is open.')
    await expect(devices.getByRole('button', { name: 'Show pairing code' })).toBeDisabled()
    await expect(devices.getByRole('textbox', { name: 'Name phones see' })).toHaveValue('OXESpace')
    await expect(devices.getByTestId('devices-scope-cannot')).toContainText('Approve OxeQuery changes')

    // The firewall note comes first, and only the first time.
    await devices.getByRole('switch', { name: 'Let phones on this network connect' }).click()
    const firewall = page.getByRole('dialog', { name: 'Before phones can connect' })
    await expect(firewall).toContainText('Nothing is exposed to the internet')
    await firewall.getByRole('button', { name: 'Turn on' }).click()
    await expect(devices.getByTestId('devices-gateway-state')).toHaveText('Listening on 192.168.0.10, port 47321')
    await devices.getByRole('switch', { name: 'Let phones on this network connect' }).click()
    await expect(devices.getByTestId('devices-gateway-state')).toHaveText('Off. No port is open.')
    await devices.getByRole('switch', { name: 'Let phones on this network connect' }).click()
    await expect(firewall).toHaveCount(0)
    await expect(devices.getByTestId('devices-gateway-state')).toHaveText('Listening on 192.168.0.10, port 47321')

    // The computer's name: what phones see, saved through the gateway.
    const name = devices.getByRole('textbox', { name: 'Name phones see' })
    await name.fill('Studio')
    await devices.getByRole('button', { name: 'Save name' }).click()
    await expect(devices.getByRole('button', { name: 'Use "OXESpace"' })).toBeVisible()

    // The QR, its text alternative, then the phone that scanned it asks to pair.
    await devices.getByRole('button', { name: 'Show pairing code' }).click()
    await expect(devices.getByRole('img', { name: /Pairing QR code/ })).toBeVisible()
    await expect(devices.getByTestId('devices-pairing-code')).toHaveText('e2e-pairing-code-00000')
    await expect(devices.getByTestId('devices-pairing-fingerprint')).toContainText('ABAB ABAB')
    const prompt = page.getByRole('dialog', { name: 'Pair Pixel 8 Pro?' })
    await expect(prompt.getByTestId('devices-pairing-verification')).toHaveText('28T5CY')
    await prompt.getByRole('button', { name: 'Pair', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    const list = devices.getByRole('list', { name: 'Paired phones' })
    await expect(list.getByTestId('devices-device')).toHaveCount(2)
    await expect(list).toContainText('Pixel 8 Pro')

    // Removing asks first, then the phone is gone.
    await devices.getByRole('button', { name: 'Remove Pixel 8 Pro' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove Pixel 8 Pro?' })
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await expect(list.getByTestId('devices-device')).toHaveCount(1)
    await expect(list).not.toContainText('Pixel 8 Pro')

    // With the connection on, a terminal offers typing from the phone, off until chosen, with a sign on the pane.
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(settings).toHaveCount(0)
    await page.getByRole('button', { name: 'More pane actions' }).first().click()
    const item = page.getByRole('menuitemcheckbox', { name: 'Allow typing from the phone' })
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await item.click()
    await expect(page.getByTestId('pane-phone-write').first()).toHaveText('Phone can type')
    await page.getByRole('button', { name: 'More pane actions' }).first().click()
    await page.getByRole('menuitemcheckbox', { name: 'Allow typing from the phone' }).click()
    await expect(page.getByTestId('pane-phone-write')).toHaveCount(0)
  } finally {
    delete process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT
    if (launched) await launched.app.close()
  }
})
