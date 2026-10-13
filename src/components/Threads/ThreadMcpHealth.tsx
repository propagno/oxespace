import type { ReactElement } from 'react'
import { Plug } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { ConversationThread, ThreadMcpServerStatus } from '../../../shared/types/thread'
import { useUIStore } from '../../store/ui.store'

const LABEL: Record<ThreadMcpServerStatus['status'], string> = {
  connected: 'Connected', failed: 'Failed to start', 'needs-auth': 'Needs sign-in', pending: 'Starting', disabled: 'Disabled', unknown: 'Unknown'
}

/**
 * MCP servers that did not start for this conversation. Silent while all is
 * well; a warning chip with the details otherwise, since a missing server
 * means the agent quietly lacks the tools it was expected to use.
 */
export function ThreadMcpHealth({ thread }: { thread: ConversationThread }): ReactElement | null {
  const servers = thread.mcpServers?.servers ?? []
  const broken = servers.filter(server => server.status === 'failed' || server.status === 'needs-auth')
  if (!broken.length) return null
  return <Popover.Root>
    <Popover.Trigger asChild><button type="button" className="thread-mcp-health" aria-label={`${broken.length} MCP ${broken.length === 1 ? 'server' : 'servers'} unavailable`}><Plug size={12} aria-hidden="true" />MCP · {broken.length}</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="thread-mcp-health-popover" side="top" align="end" sideOffset={8}>
      <strong>MCP servers</strong>
      <span>As reported when this conversation's session started.</span>
      <ul>{servers.map(server => <li key={server.name} className={`is-${server.status}`}><code>{server.name}</code><small>{LABEL[server.status]}</small></li>)}</ul>
      <button type="button" onClick={() => useUIStore.getState().openMcpPanel()}>Open MCP connections</button>
      <Popover.Arrow className="thread-font-arrow" />
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
