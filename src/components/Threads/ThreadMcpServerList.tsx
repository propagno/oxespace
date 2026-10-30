import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadMcpServerStatus } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { EmptyState } from '../../ui'
import { ThreadMcpDiagnose } from './ThreadMcpDiagnose'
import './ThreadMcpServerList.css'

type Group = { key: string; title: string; hint?: string; servers: ThreadMcpServerStatus[] }

/** claude.ai connectors are account-level options; one that is not signed in is not a broken server. */
export const isAccountConnector = (name: string): boolean => name.startsWith('claude.ai ')

/** Servers the person configured that did not start: the only ones worth a warning. */
export function brokenMcpServers(servers: ThreadMcpServerStatus[]): ThreadMcpServerStatus[] {
  return servers.filter(server => server.status === 'failed' || (server.status === 'needs-auth' && !isAccountConnector(server.name)))
}

export function groupMcpServers(servers: ThreadMcpServerStatus[]): Group[] {
  const by = (test: (server: ThreadMcpServerStatus) => boolean) => servers.filter(test).sort((a, b) => a.name.localeCompare(b.name))
  const t = i18n.t.bind(i18n)
  return [
    { key: 'failed', title: t('thread:mcpList.failed.title'), hint: t('thread:mcpList.failed.hint'), servers: by(server => server.status === 'failed') },
    { key: 'connected', title: t('thread:mcpList.connected.title'), servers: by(server => server.status === 'connected') },
    { key: 'starting', title: t('thread:mcpList.starting.title'), servers: by(server => server.status === 'pending') },
    { key: 'needs-auth', title: t('thread:mcpList.needsAuth.title'), hint: t('thread:mcpList.needsAuth.hint'), servers: by(server => server.status === 'needs-auth') },
    { key: 'other', title: t('thread:mcpList.other.title'), servers: by(server => server.status === 'disabled' || server.status === 'unknown') }
  ].filter(group => group.servers.length > 0)
}

/**
 * MCP servers as the provider reported them when this conversation's session started, grouped by state.
 * With `workspaceId`, a failed server can be diagnosed.
 */
export function ThreadMcpServerList({ servers, workspaceId }: { servers: ThreadMcpServerStatus[]; workspaceId?: string }): ReactElement {
  const { t } = useTranslation('thread')
  const groups = groupMcpServers(servers)
  if (!groups.length) return <EmptyState compact title={t('mcpList.empty')} />
  return <div className="thread-mcp-list">
    {groups.map(group => <section key={group.key} className={`thread-mcp-group is-${group.key}`} aria-label={t('mcpList.group', { title: group.title, count: group.servers.length })}>
      <h4><span className="thread-mcp-dot" aria-hidden="true" />{group.title}<small>{group.servers.length}</small></h4>
      {group.hint && <p>{group.hint}</p>}
      <ul>{group.servers.map(server => <li key={server.name} title={server.name}>{isAccountConnector(server.name) ? <><span className="thread-mcp-source">claude.ai</span>{server.name.slice('claude.ai '.length)}</> : server.name}
        {group.key === 'failed' && workspaceId && !isAccountConnector(server.name) && <ThreadMcpDiagnose name={server.name} workspaceId={workspaceId} />}</li>)}</ul>
    </section>)}
  </div>
}
