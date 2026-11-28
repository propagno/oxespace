import { KeyRound, Unlink } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServer } from '../../../shared/types/mcp'
import { useMcpStore } from '../../store/mcp.store'
import { Button, toast } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

export interface McpOAuthActionProps {
  server: McpServer
  disabled?: boolean
}

/**
 * OAuth 2.1 keychain sign-in / disconnect action for remote HTTP/SSE MCP servers.
 * Tokens live exclusively in OS keychain (`safeStorage`) in main — never in renderer or `.mcp.json`.
 */
function patchServerOAuth(serverId: string, oauthConnected: boolean): void {
  useMcpStore.setState(state => {
    const next: Record<string, McpServer[]> = {}
    for (const [k, list] of Object.entries(state.serversByWorkspace)) {
      next[k] = list.map(srv => srv.id === serverId ? { ...srv, oauthConnected } : srv)
    }
    return { serversByWorkspace: next }
  })
}

export function McpOAuthAction({ server, disabled = false }: McpOAuthActionProps): ReactElement | null {
  const { t } = useTranslation('code')
  const testServer = useMcpStore(state => state.test)
  const [busy, setBusy] = useState(false)

  if (server.transport === 'stdio') return null
  if (!window.oxe?.mcp?.connectOAuth) return null

  const connected = server.oauthConnected === true

  const handleConnect = async (): Promise<void> => {
    const connect = window.oxe?.mcp?.connectOAuth
    if (!connect) return
    setBusy(true)
    try {
      const result = await connect(server.id)
      patchServerOAuth(server.id, result.status.connected)
      if (!result.ok) {
        toast({ title: result.error ?? t('mcp.oauth.connectFailed'), intent: 'danger' })
        return
      }
      toast({ title: t('mcp.oauth.connectedToast', { name: server.name }), intent: 'info' })
      if (server.trusted) void testServer(server.id).catch(() => undefined)
    } catch (err) {
      toast({ title: humanizeError(err, t('mcp.oauth.connectFailed')), intent: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    const disconnect = window.oxe?.mcp?.disconnectOAuth
    if (!disconnect) return
    setBusy(true)
    try {
      const status = await disconnect(server.id)
      patchServerOAuth(server.id, status.connected)
      toast({ title: t('mcp.oauth.disconnectedToast', { name: server.name }), intent: 'info' })
    } catch (err) {
      toast({ title: humanizeError(err, t('mcp.oauth.disconnectFailed')), intent: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return connected ? (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || busy}
      data-testid="mcp-oauth-disconnect"
      title={t('mcp.oauth.disconnectTitle')}
      onClick={() => void handleDisconnect()}
      icon={<Unlink size={12} aria-hidden="true" />}
    >
      {t('mcp.oauth.disconnect')}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || busy}
      data-testid="mcp-oauth-connect"
      title={t('mcp.oauth.connectTitle')}
      onClick={() => void handleConnect()}
      icon={<KeyRound size={12} aria-hidden="true" />}
    >
      {busy ? t('mcp.oauth.connecting') : t('mcp.oauth.connect')}
    </Button>
  )
}
