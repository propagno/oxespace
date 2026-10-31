import { useEffect } from 'react'
import type { McpServer } from '../../shared/types/mcp'
import { i18n } from '../i18n'
import { isQuarantined } from '../components/MCP/mcpQuarantine'
import { useActivityStore } from '../store/activity.store'
import { useMcpStore } from '../store/mcp.store'

/** Every server the store knows, once each (a global server is listed under every workspace). */
function knownServers(byWorkspace: Record<string, McpServer[]>): Map<string, McpServer> {
  const servers = new Map<string, McpServer>()
  for (const list of Object.values(byWorkspace)) for (const server of list) servers.set(server.id, server)
  return servers
}

/**
 * A quarantined MCP server waits for a person's decision, so it shows in the activity center as "needs you": once
 * per quarantine (a new one, after trusting it again, shows again). It leaves when the server is trusted again or
 * removed. Recording only; trusting stays in the MCP panel, behind its own confirmation.
 */
export function useMcpQuarantineActivity(): void {
  useEffect(() => {
    const shown = new Map<string, number>()
    const sync = (byWorkspace: Record<string, McpServer[]>): void => {
      const servers = knownServers(byWorkspace)
      const activity = useActivityStore.getState()
      for (const [id, server] of servers) {
        const at = server.guard?.quarantine?.at
        if (isQuarantined(server) && at !== undefined && shown.get(id) !== at) {
          shown.set(id, at)
          activity.record({ source: 'mcp', id, kind: 'needs-you', target: { type: 'mcp', serverId: id }, at,
            title: i18n.t('mcp.activityTitle', { ns: 'code', name: server.name }), detail: i18n.t('mcp.activityDetail', { ns: 'code' }) })
        } else if (!isQuarantined(server) && shown.has(id)) {
          shown.delete(id)
          activity.resolve('mcp', id, 'needs-you')
        }
      }
      for (const id of [...shown.keys()]) if (!servers.has(id)) { shown.delete(id); activity.resolve('mcp', id, 'needs-you') }
    }
    sync(useMcpStore.getState().serversByWorkspace)
    return useMcpStore.subscribe((state, previous) => { if (state.serversByWorkspace !== previous.serversByWorkspace) sync(state.serversByWorkspace) })
  }, [])
}
