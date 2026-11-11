import type { ThreadEvent } from '../../../../shared/types/thread'
import type { ThreadAgentSummary } from '../../../../shared/types/thread-places'
import type { AgentActivity } from './read-model'

export interface ThreadAgentSummaryInput {
  activity: Pick<AgentActivity, 'summary'>
  threadId: string
  agentPaneIds: readonly string[]
  files: number | null
  events: readonly ThreadEvent[]
  extraFailedSources?: readonly string[]
}

/**
 * A62 / N5: what the agent did in one conversation and its agent panes, for the Pull request tab.
 * Files come from the task's places, approvals from the conversation's resolved requests, and
 * databases, containers and HTTP calls (with production hosts) from AgentActivity.
 */
export function threadAgentSummary(input: ThreadAgentSummaryInput): ThreadAgentSummary {
  const actors = [`thread:${input.threadId}`, ...input.agentPaneIds.map(id => `pane:${id}`)]
  const counts = input.activity.summary({ actors })
  const approvals = input.events.filter(event => event.type === 'request-resolved' && event.resolution === 'approved').length
  const failedSources: string[] = [...counts.failedSources]
  if (input.extraFailedSources) {
    for (const source of input.extraFailedSources) {
      if (!failedSources.includes(source)) failedSources.push(source)
    }
  }
  return {
    files: input.files,
    databases: counts.databases,
    http: counts.http,
    httpProduction: counts.httpProduction,
    containers: counts.containers,
    approvals,
    failedSources
  }
}
