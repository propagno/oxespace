import type { ReactElement } from 'react'
import { Plug } from 'lucide-react'
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
  const servers = thread.mcpServers?.servers ?? []
  if (!servers.length) return null
  const connected = servers.filter(server => server.status === 'connected').length
  const broken = brokenMcpServers(servers)
  const suspended = Boolean(thread.connection?.suspendedAt)
  const label = suspended ? 'MCP servers stopped while the conversation is idle; they start again with your next message'
    : broken.length
    ? `${broken.length} MCP ${broken.length === 1 ? 'server' : 'servers'} unavailable, ${connected} connected`
    : `${connected} MCP ${connected === 1 ? 'server' : 'servers'} connected`
  return <Popover label="MCP servers" side="top" align="end"
    trigger={<button type="button" className={`thread-mcp-health${broken.length && !suspended ? ' is-warning' : ''}`} aria-label={label} title={label}><Plug size={12} aria-hidden="true" />MCP · {suspended ? 'stopped' : broken.length ? `${broken.length} failed` : connected}</button>}>
    <div className="thread-mcp-health-popover">
      <header><strong>MCP servers</strong><span>{suspended ? 'Stopped while the conversation is idle. This is the list from its last session; your next message starts them again.' : "As this conversation's session reported them when it started."}</span></header>
      <ThreadMcpServerList servers={servers} workspaceId={thread.workspaceId} />
      <Button size="sm" onClick={() => useUIStore.getState().openMcpPanel()}>Open connections</Button>
    </div>
  </Popover>
}
