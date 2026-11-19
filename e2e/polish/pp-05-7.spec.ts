// End-to-end acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-263, PP-05·7, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PP-05·7 in the app: action-scope permission chip renders with computed --attn-fg color', async () => {
  test.setTimeout(180_000)
  const { app: electronApp, page, workspaceRoot } = await launchApp({ realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)

    const result = await page.evaluate(() => {
      const chip = document.createElement('span')
      chip.className = 'agent-browser-scope-chip'
      chip.setAttribute('data-tone', 'attn')
      chip.textContent = 'Asks each time'
      document.body.append(chip)

      const probe = document.createElement('span')
      probe.style.color = 'var(--attn-fg)'
      probe.style.backgroundColor = 'var(--attn-bg)'
      document.body.append(probe)

      const chipStyle = getComputedStyle(chip)
      const probeStyle = getComputedStyle(probe)
      const rect = chip.getBoundingClientRect()
      chip.remove()
      probe.remove()
      return {
        color: chipStyle.color,
        expectedColor: probeStyle.color,
        backgroundColor: chipStyle.backgroundColor,
        expectedBg: probeStyle.backgroundColor,
        height: rect.height
      }
    })

    expect(result.color).toBe(result.expectedColor)
    expect(result.backgroundColor).toBe(result.expectedBg)
    expect(result.height).toBeGreaterThanOrEqual(24)
  } finally {
    await electronApp.close()
  }
})
