import { HttpCallsPanel } from '../HttpCalls/HttpCallsPanel'

export function ThreadNetworkPanel({ threadId, workspaceId }: { threadId: string; workspaceId: string }) {
  return <HttpCallsPanel workspaceId={workspaceId} actor={`thread:${threadId}`} />
}
