import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isFeatureUsageKey } from '../../../shared/feature-usage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AppDatabase } from '../db/index'
import { UsageCount } from '../services/usage/usage-count'

/**
 * Renderer-facing IPC for the local-only feature usage counter (1.5.0 A65 / N7).
 * Never reachable over MCP (`settings.feature_usage` is forbidden).
 */
export function registerFeatureUsageIpc(usageOrDb: UsageCount | AppDatabase): UsageCount {
  const usage = usageOrDb instanceof UsageCount ? usageOrDb : new UsageCount(usageOrDb)

  ipcMain.handle(IPC_CHANNELS.featureUsage.state, () => usage.status())

  ipcMain.handle(IPC_CHANNELS.featureUsage.setEnabled, (_event, input: unknown) => {
    const payload = (input ?? {}) as { enabled?: unknown; clear?: unknown }
    if (typeof payload.enabled !== 'boolean') {
      throw new Error('featureUsage.setEnabled requires a boolean enabled field')
    }
    return usage.setEnabled(payload.enabled, { clear: Boolean(payload.clear) })
  })

  ipcMain.handle(IPC_CHANNELS.featureUsage.export, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options = {
      title: 'Export feature usage',
      defaultPath: `oxespace-feature-usage-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    usage.export(result.filePath)
    return { path: result.filePath }
  })

  ipcMain.handle(IPC_CHANNELS.featureUsage.clear, () => usage.clear())

  ipcMain.handle(IPC_CHANNELS.featureUsage.record, (_event, feature: unknown) => {
    if (isFeatureUsageKey(feature)) usage.record(feature)
  })

  usage.onChanged(() => {
    const snapshot = usage.status()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.featureUsage.changed, snapshot)
      }
    }
  })

  return usage
}
