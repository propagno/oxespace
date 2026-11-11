import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AppDatabase } from '../db/index'
import { HostsProxy, type HostsProxyLogger } from '../services/hosts-proxy/hosts-proxy'

/**
 * Renderer-facing IPC for the loopback outgoing-hosts proxy (1.5.0 A68 / H4).
 * Never reachable over MCP (`settings.hosts_proxy` is forbidden).
 */
export function registerHostsProxyIpc(
  proxyOrDb: HostsProxy | AppDatabase,
  logger?: HostsProxyLogger
): HostsProxy {
  const proxy =
    proxyOrDb instanceof HostsProxy
      ? proxyOrDb
      : new HostsProxy(proxyOrDb, { env: process.env, logger })

  ipcMain.handle(IPC_CHANNELS.hostsProxy.state, () => proxy.status())

  ipcMain.handle(IPC_CHANNELS.hostsProxy.setEnabled, (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('hostsProxy.setEnabled requires a boolean argument')
    }
    return proxy.setEnabled(enabled)
  })

  ipcMain.handle(IPC_CHANNELS.hostsProxy.clear, () => proxy.clear())

  ipcMain.handle(IPC_CHANNELS.hostsProxy.retry, () => proxy.retry())

  proxy.onChanged(() => {
    const snapshot = proxy.status()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.hostsProxy.changed, snapshot)
      }
    }
  })

  return proxy
}
