import type { AppView } from '../keyboard/keybindings'
import { useActivitySources } from '../hooks/useActivitySources'

/**
 * The activity center's producers (agents in Code panes, conversations, quota, updates, quarantined MCP servers), loaded
 * right after the first frame instead of in the renderer entry. Each subscribes to its store and reads the current state
 * when it starts, so nothing that happened before it loaded is missed. Renders nothing.
 */
export function ActivitySources({ applicationView }: { applicationView: AppView }): null {
  useActivitySources(applicationView)
  return null
}
