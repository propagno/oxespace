/**
 * F7 · A56 / N6 (SECURITY S5): System notification for pending approvals.
 *
 * Shows at once when the window is not focused and the setting is enabled, with only one action (`open` — never Allow).
 * Body carries only the pane/conversation label and risk word, never the command, path, SQL or URL.
 * A third request within 10 s replaces the open ones with one grouped notification; Open focuses the window and opens
 * the first pending request.
 */
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type { ApprovalRisk } from '../../../../shared/types/approvals'

export const APPROVAL_GROUP_WINDOW_MS = 10_000

export interface ApprovalNotification {
  title: MainMessage
  body: MainMessage
  actions: string[]
  onAction: (action: string) => void
}

export interface ApprovalNotificationHandle {
  close(): void
}

export interface ApprovalNotifierDeps {
  show(notification: ApprovalNotification): ApprovalNotificationHandle
  focused(): boolean
  enabled(): boolean
  focusWindow(): void
  openRequest(requestId: string): void
  now?(): number
}

export interface ApprovalPendingNotification {
  requestId: string
  threadId?: string
  agent: string
  pane: string
  risk: ApprovalRisk
  title?: string
}

interface IndividualEntry {
  request: ApprovalPendingNotification
  at: number
  handle: ApprovalNotificationHandle
}

interface GroupEntry {
  requests: Array<{ request: ApprovalPendingNotification; at: number }>
  lastAt: number
  handle: ApprovalNotificationHandle
}

export class ApprovalNotifier {
  private readonly individual = new Map<string, IndividualEntry>()
  private readonly archivedGroups: GroupEntry[] = []
  private activeGroup: GroupEntry | null = null

  constructor(private readonly deps: ApprovalNotifierDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  pending(input: ApprovalPendingNotification): void {
    if (this.deps.focused() || !this.deps.enabled()) return
    const now = this.now()
    const clean: ApprovalPendingNotification = {
      requestId: input.requestId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      agent: input.agent,
      pane: input.pane,
      risk: input.risk
    }

    if (this.activeGroup && now - this.activeGroup.lastAt > APPROVAL_GROUP_WINDOW_MS) {
      this.archivedGroups.push(this.activeGroup)
      this.activeGroup = null
    }

    if (this.activeGroup) {
      this.activeGroup.requests = this.activeGroup.requests.filter(item => item.request.requestId !== clean.requestId)
      this.activeGroup.requests.push({ request: clean, at: now })
      this.activeGroup.lastAt = now
      this.activeGroup.handle.close()
      this.activeGroup.handle = this.showGroup(this.activeGroup.requests)
      return
    }

    const recent = [...this.individual.values()].filter(entry => entry.request.requestId !== clean.requestId && now - entry.at <= APPROVAL_GROUP_WINDOW_MS)
    if (recent.length + 1 >= 3) {
      for (const entry of recent) {
        entry.handle.close()
        this.individual.delete(entry.request.requestId)
      }
      const existing = this.individual.get(clean.requestId)
      if (existing) {
        existing.handle.close()
        this.individual.delete(clean.requestId)
      }
      const requests = [...recent.map(entry => ({ request: entry.request, at: entry.at })), { request: clean, at: now }]
      const handle = this.showGroup(requests)
      this.activeGroup = { requests, lastAt: now, handle }
      return
    }

    const existing = this.individual.get(clean.requestId)
    if (existing) existing.handle.close()
    const handle = this.showSingle(clean)
    this.individual.set(clean.requestId, { request: clean, at: now, handle })
  }

  resolved(requestId: string): void {
    const single = this.individual.get(requestId)
    if (single) {
      single.handle.close()
      this.individual.delete(requestId)
    }

    if (this.activeGroup) {
      const before = this.activeGroup.requests.length
      this.activeGroup.requests = this.activeGroup.requests.filter(item => item.request.requestId !== requestId)
      if (this.activeGroup.requests.length === 0) {
        this.activeGroup.handle.close()
        this.activeGroup = null
      } else if (this.activeGroup.requests.length !== before) {
        this.activeGroup.handle.close()
        this.activeGroup.handle = this.showGroup(this.activeGroup.requests)
      }
    }

    for (let index = this.archivedGroups.length - 1; index >= 0; index--) {
      const group = this.archivedGroups[index]
      const before = group.requests.length
      group.requests = group.requests.filter(item => item.request.requestId !== requestId)
      if (group.requests.length === 0) {
        group.handle.close()
        this.archivedGroups.splice(index, 1)
      } else if (group.requests.length !== before) {
        group.handle.close()
        group.handle = this.showGroup(group.requests)
      }
    }
  }

  private showSingle(request: ApprovalPendingNotification): ApprovalNotificationHandle {
    return this.deps.show({
      title: mainMessage('notify.agentNeedsYou', { agent: request.agent }),
      body: mainMessage('notify.requestBody', { pane: request.pane, risk: request.risk }),
      actions: ['open'],
      onAction: action => {
        if (action !== 'open') return
        this.deps.focusWindow()
        this.deps.openRequest(request.requestId)
      }
    })
  }

  private showGroup(requests: Array<{ request: ApprovalPendingNotification; at: number }>): ApprovalNotificationHandle {
    const first = requests[0].request
    return this.deps.show({
      title: mainMessage('notify.requestsNeedYou', { count: requests.length }),
      body: mainMessage('notify.requestBody', { pane: first.pane, risk: first.risk }),
      actions: ['open'],
      onAction: action => {
        if (action !== 'open') return
        this.deps.focusWindow()
        this.deps.openRequest(first.requestId)
      }
    })
  }
}
