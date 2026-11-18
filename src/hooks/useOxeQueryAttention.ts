import { useEffect } from 'react'
import { threadAgentName } from '../../shared/threadProviders'
import type { ApprovalRequest } from '../../shared/types/approvals'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { i18n } from '../i18n'
import { useApprovalsStore } from '../components/Approvals/approvals.store'
import { useActivityStore, type ActivityInput, type ActivityTarget } from '../store/activity.store'
import { useThreadStore } from '../store/thread.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { noticeLabel } from './useAgentNotifications'
import { threadPlace } from './useThreadAttention'

const REQUESTER = /^(pane|thread):(.+)$/

/**
 * A waiting OxeQuery approval is a needs-you entry ("{project} · OxeQuery" in the panel). The title names the
 * agent from the app's own records, never the SQL or the request text. When the request leaves the queue it
 * stays in the history, read, with outcome answered — the same path as a decision answered elsewhere.
 */
export function useOxeQueryAttention(): void {
  useEffect(() => {
    const open = new Map<string, ActivityInput>()
    const sync = (queue: ApprovalRequest[]): void => {
      const activity = useActivityStore.getState()
      const ids = new Set<string>()
      for (const request of queue) {
        if (request.kind !== 'oxequery') continue
        ids.add(request.id)
        if (open.has(request.id)) continue
        const input = entryFor(request)
        if (!input) continue
        open.set(request.id, input)
        activity.record(input)
      }
      for (const [id, input] of open) {
        if (ids.has(id)) continue
        open.delete(id)
        activity.record({ ...input, outcome: 'answered', read: true, at: Date.now() })
      }
    }
    sync(useApprovalsStore.getState().queue)
    return useApprovalsStore.subscribe((state, previous) => {
      if (state.queue !== previous.queue) sync(state.queue)
    })
  }, [])
}

function queryTitle(agent: string): string {
  return i18n.t('pane.decisionAnnounce', {
    ns: 'code',
    agent,
    reason: i18n.t('approvals.title.oxequery', { ns: 'main' })
  })
}

function entryFor(request: ApprovalRequest): ActivityInput | null {
  const match = REQUESTER.exec(request.requester?.id ?? '')
  if (!match) return null
  const located = match[1] === 'pane' ? fromPane(match[2]) : fromThread(match[2])
  if (!located) return null
  return {
    source: 'query',
    id: request.id,
    kind: 'needs-you',
    target: located.target,
    title: queryTitle(located.agent),
    place: { project: located.project, mode: 'query' }
  }
}

function fromPane(paneId: string): { project: string; agent: string; target: ActivityTarget } | null {
  for (const workspace of useWorkspaceStore.getState().workspaces) {
    const pane = workspace.panes.find(item => item.id === paneId)
    if (!pane) continue
    return {
      project: workspace.name,
      agent: paneAgent(pane, workspace),
      target: { type: 'pane', workspaceId: workspace.id, paneId: pane.id }
    }
  }
  return null
}

function paneAgent(pane: WorkspacePane, workspace: Workspace): string {
  const profileId = pane.shellProfileId ?? workspace.defaultShellProfileId
  const name = useWorkspaceStore.getState().shellProfiles.find(profile => profile.id === profileId)?.name ?? null
  return noticeLabel(pane, name)
}

function fromThread(threadId: string): { project: string; agent: string; target: ActivityTarget } | null {
  const thread = useThreadStore.getState().threads.find(item => item.id === threadId)
  if (!thread) return null
  return {
    project: threadPlace(thread),
    agent: threadAgentName(thread.provider),
    target: { type: 'thread', threadId: thread.id, ...(thread.workspaceId ? { workspaceId: thread.workspaceId } : {}) }
  }
}
