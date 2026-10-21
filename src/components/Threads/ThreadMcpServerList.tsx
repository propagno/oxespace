import type { ReactElement } from 'react'
import type { ThreadMcpServerStatus } from '../../../shared/types/thread'
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
  return [
    { key: 'failed', title: 'Failed to start', hint: 'Diagnose tests the server and says why it does not start. After fixing it, start a new conversation.', servers: by(server => server.status === 'failed') },
    { key: 'connected', title: 'Connected', servers: by(server => server.status === 'connected') },
    { key: 'starting', title: 'Starting', servers: by(server => server.status === 'pending') },
    { key: 'needs-auth', title: 'Needs sign-in', hint: 'claude.ai connectors sign in at claude.ai, under Settings › Connectors.', servers: by(server => server.status === 'needs-auth') },
    { key: 'other', title: 'Disabled or unknown', servers: by(server => server.status === 'disabled' || server.status === 'unknown') }
  ].filter(group => group.servers.length > 0)
}

/**
 * MCP servers as the provider reported them when this conversation's session started, grouped by state.
 * With `workspaceId`, a failed server can be diagnosed.
 */
export function ThreadMcpServerList({ servers, workspaceId }: { servers: ThreadMcpServerStatus[]; workspaceId?: string }): ReactElement {
  const groups = groupMcpServers(servers)
  if (!groups.length) return <p className="thread-mcp-list-empty">The provider reported no MCP servers for this conversation.</p>
  return <div className="thread-mcp-list">
    {groups.map(group => <section key={group.key} className={`thread-mcp-group is-${group.key}`} aria-label={`${group.title}: ${group.servers.length}`}>
      <h4><span className="thread-mcp-dot" aria-hidden="true" />{group.title}<small>{group.servers.length}</small></h4>
      {group.hint && <p>{group.hint}</p>}
      <ul>{group.servers.map(server => <li key={server.name} title={server.name}>{isAccountConnector(server.name) ? <><span className="thread-mcp-source">claude.ai</span>{server.name.slice('claude.ai '.length)}</> : server.name}
        {group.key === 'failed' && workspaceId && !isAccountConnector(server.name) && <ThreadMcpDiagnose name={server.name} workspaceId={workspaceId} />}</li>)}</ul>
    </section>)}
  </div>
}
