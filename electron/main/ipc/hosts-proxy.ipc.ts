import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AppDatabase } from '../db/index'
import type {
  HostsProxy,
  HostsProxyGrant,
  HostsProxyLogger,
  HostsProxyOrigin
} from '../services/hosts-proxy/hosts-proxy'

/** What main holds at boot: grants for agents and a stop at quit, over the one proxy loaded on first use. */
export interface HostsProxyHandle {
  grant(origin: HostsProxyOrigin): HostsProxyGrant
  stop(): Promise<void>
}

const NO_GRANT = (): HostsProxyGrant => ({ env: {}, revoke: () => undefined })

function savedEnabled(db: AppDatabase): boolean {
  try {
    const saved = db.prepare('SELECT enabled FROM outgoing_hosts_settings WHERE id = 1').get() as { enabled: number } | undefined
    return saved?.enabled === 1
  } catch { return false }
}

const isProxy = (value: HostsProxy | AppDatabase): value is HostsProxy =>
  typeof (value as Partial<HostsProxy>).grant === 'function' && typeof (value as Partial<HostsProxy>).status === 'function'

/**
 * Renderer-facing IPC for the loopback outgoing-hosts proxy (1.5.0 A68 / H4).
 * Never reachable over MCP (`settings.hosts_proxy` is forbidden).
 * OXE-358: the proxy module loads on first use (await import()), one instance per app run. When the saved setting is
 * on, it loads right away, so the proxy starts at boot as it always did; otherwise the first IPC call loads it. Until
 * it is loaded a grant is empty, which is what the proxy itself gives while it is not running.
 */
export function registerHostsProxyIpc(
  proxyOrDb: HostsProxy | AppDatabase,
  logger?: HostsProxyLogger
): HostsProxyHandle {
  let proxy: HostsProxy | null = null
  let loading: Promise<HostsProxy> | null = null
  let stopped = false

  const attach = (instance: HostsProxy): HostsProxy => {
    proxy = instance
    instance.onChanged(() => {
      const snapshot = instance.status()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.hostsProxy.changed, snapshot)
        }
      }
    })
    if (stopped) void instance.stop()
    return instance
  }

  const load = (): Promise<HostsProxy> => {
    if (proxy) return Promise.resolve(proxy)
    loading ??= isProxy(proxyOrDb)
      ? Promise.resolve(attach(proxyOrDb))
      : import('../services/hosts-proxy/hosts-proxy').then(({ HostsProxy: Proxy }) =>
          attach(new Proxy(proxyOrDb, { env: process.env, logger })))
    return loading
  }

  ipcMain.handle(IPC_CHANNELS.hostsProxy.state, async () => (await load()).status())

  ipcMain.handle(IPC_CHANNELS.hostsProxy.setEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('hostsProxy.setEnabled requires a boolean argument')
    }
    return (await load()).setEnabled(enabled)
  })

  ipcMain.handle(IPC_CHANNELS.hostsProxy.clear, async () => (await load()).clear())

  ipcMain.handle(IPC_CHANNELS.hostsProxy.retry, async () => (await load()).retry())

  if (isProxy(proxyOrDb) || savedEnabled(proxyOrDb)) {
    void load().catch(error => logger?.warn('[hosts-proxy] could not load the proxy:', error))
  }

  return {
    grant: origin => proxy ? proxy.grant(origin) : NO_GRANT(),
    stop: async () => {
      stopped = true
      if (proxy) await proxy.stop()
      else if (loading) await (await loading.catch(() => null))?.stop()
    }
  }
}
