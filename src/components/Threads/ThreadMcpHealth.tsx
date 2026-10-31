import type { ReactElement } from 'react'
import { Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread } from '../../../shared/types/thread'
import { useUIStore } from '../../store/ui.store'
import { Button, Popover } from '../../ui'
import { ThreadMcpServerList, brokenMcpServers } from './ThreadMcpServerList'

/**
 * The MCP servers this conversation's session loaded. The chip counts the connected ones and turns into a
 * warning only when a server the person configured failed; claude.ai connectors waiting for a sign-in are
 * account options, not failures.
 */
export function ThreadMcpHealth({ thread }: { thread: ConversationThread }): ReactElement | null {
  const { t } = useTranslation('thread')
  const servers = thread.mcpServers?.servers ?? []
  if (!servers.length) return null
  const connected = servers.filter(server => server.status === 'connected').length
  const broken = brokenMcpServers(servers)
  const suspended = Boolean(thread.connection?.suspendedAt)
  const label = suspended ? t('mcpHealth.stoppedLabel')
    : broken.length
    ? t('mcpHealth.unavailable', { count: broken.length, connected })
    : t('mcpHealth.connected', { count: connected })
  return <Popover label={t('mcpHealth.title')} side="top" align="end"
    trigger={<button type="button" className={`thread-mcp-health${broken.length && !suspended ? ' is-warning' : ''}`} aria-label={label} title={label}><Plug size={12} aria-hidden="true" />{t('mcpHealth.chip', { value: suspended ? t('mcpHealth.chipStopped') : broken.length ? t('mcpHealth.chipFailed', { count: broken.length }) : connected })}</button>}>
    <div className="thread-mcp-health-popover">
      <header><strong>{t('mcpHealth.title')}</strong><span>{suspended ? t('mcpHealth.stoppedBody') : t('mcpHealth.reportedBody')}</span></header>
      <ThreadMcpServerList servers={servers} workspaceId={thread.workspaceId} />
      <Button size="sm" onClick={() => useUIStore.getState().openMcpPanel()}>{t('mcpHealth.open')}</Button>
    </div>
  </Popover>
}
