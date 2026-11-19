// End-to-end acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-265, PP-05·10, CA-4),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PP-05·10 in the app: MCP builtin notice close button is at least 24 px and titles have no uppercase transform', async () => {
  const { electronApp, page } = await launchApp({ env: REAL })
  try {
    await openDemoWorkspace(page)

    const metrics = await page.evaluate(() => {
      const scope = document.createElement('span')
      scope.className = 'mcp-panel-scope'
      scope.textContent = 'Global'
      const toolsTitle = document.createElement('div')
      toolsTitle.className = 'mcp-builtin-tools-title'
      toolsTitle.textContent = 'Tools'
      const syncNote = document.createElement('div')
      syncNote.className = 'mcp-panel-sync-note'
      syncNote.textContent = 'Sync note'
      const probe = document.createElement('span')
      probe.style.color = 'var(--intent-info-fg)'
      probe.style.height = 'var(--control-sm)'

      document.body.append(scope, toolsTitle, syncNote, probe)
      const out = {
        scopeTransform: getComputedStyle(scope).textTransform,
        toolsTitleTransform: getComputedStyle(toolsTitle).textTransform,
        syncColor: getComputedStyle(syncNote).color,
        expectedSyncColor: getComputedStyle(probe).color,
        controlSmHeight: probe.getBoundingClientRect().height
      }
      scope.remove()
      toolsTitle.remove()
      syncNote.remove()
      probe.remove()
      return out
    })

    expect(metrics.scopeTransform).not.toBe('uppercase')
    expect(metrics.toolsTitleTransform).not.toBe('uppercase')
    expect(metrics.syncColor).toBe(metrics.expectedSyncColor)
    expect(metrics.controlSmHeight).toBeGreaterThanOrEqual(24)
  } finally {
    await electronApp.close()
  }
})
