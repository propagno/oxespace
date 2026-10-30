/**
 * B10 · The drafts each door hands to the approval center, kept pure so the routing can be tested without Electron.
 */
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type { ApprovalEnvironment, ApprovalKind, ApprovalOption, ApprovalRequester, ApprovalRisk } from '../../../../shared/types/approvals'
import type { ApprovalDraft } from './approval-center'
import { APP_REQUESTER } from './requester'

export const DENY: ApprovalOption = { id: 'deny', label: mainMessage('approvals.option.deny', {}), intent: 'deny' }
export const ALLOW_ONCE: ApprovalOption = { id: 'allow-once', label: mainMessage('approvals.option.allowOnce', {}), intent: 'allow' }
export const ALLOW_SESSION_READS: ApprovalOption = { id: 'allow-session', label: mainMessage('approvals.option.allowSessionReads', {}), intent: 'allow-session' }

/** What the agent-action and OxeQuery doors put on a broker request for the person to see. */
export interface ApprovalPresentation {
  kind: ApprovalKind
  requester: ApprovalRequester
  /** The risk the person sees, computed by main (riskFromSql, riskFromShell, the tool's declaration). */
  level: ApprovalRisk
  environment?: ApprovalEnvironment
  title: MainMessage
  summary: MainMessage
  target: string
  notes: MainMessage[]
}

/** A broker request (agent action or OxeQuery). "Allow for this run" exists for reads; the center keeps it for low risk only. */
export function brokerDraft(request: ApprovalPresentation & { text: string; risk: 'read' | 'write' | 'action' }): ApprovalDraft {
  return {
    kind: request.kind, requester: request.requester, risk: request.level, ...(request.environment ? { environment: request.environment } : {}),
    title: request.title, summary: request.summary, ...(request.target ? { target: request.target } : {}), appNotes: request.notes, text: request.text,
    options: [DENY, ALLOW_ONCE, ...(request.risk === 'read' ? [ALLOW_SESSION_READS] : [])], defaultOptionId: DENY.id
  }
}

/** A preview automation step. The selector or URL the agent sent is its text; the page is the target. */
export function previewDraft(input: { requester: ApprovalRequester; action: string; page: string; text: string }): ApprovalDraft {
  const summary = input.action === 'closeTab' ? mainMessage('approvals.summary.preview.closeTab', {})
    : input.action === 'click' ? mainMessage('approvals.summary.preview.click', {})
      : input.action === 'fill' ? mainMessage('approvals.summary.preview.fill', {})
        : input.action === 'navigate' ? mainMessage('approvals.summary.preview.navigate', {})
          : input.action === 'scroll' ? mainMessage('approvals.summary.preview.scroll', {})
            : mainMessage('approvals.summary.preview.other', { action: input.action })
  const allow = input.action === 'closeTab' ? { id: 'close-tab', label: mainMessage('approvals.option.closeTab', {}), intent: 'allow' as const } : ALLOW_ONCE
  return {
    kind: 'preview-automation', requester: input.requester, risk: 'medium', title: mainMessage('approvals.title.previewAutomation', {}), summary,
    target: input.page, appNotes: [], text: input.text, options: [DENY, allow], defaultOptionId: DENY.id
  }
}

/** The restart offer after an unexpected main-process error; the only request that needs the window's handshake. */
export function crashDraft(): ApprovalDraft {
  return {
    kind: 'crash', requester: APP_REQUESTER, risk: 'high', title: mainMessage('approvals.title.crash', {}), summary: mainMessage('approvals.summary.crash', {}),
    appNotes: [mainMessage('approvals.note.crash', {})], text: '', ackRequired: true,
    options: [{ id: 'keep-working', label: mainMessage('approvals.option.keepWorking', {}), intent: 'deny' }, { id: 'restart', label: mainMessage('approvals.option.restart', {}), intent: 'allow' }],
    defaultOptionId: 'keep-working'
  }
}

/** The notification title an agent's notice gets: who sent it, as the app names it, then the agent's title. */
export function noticeTitle(requester: ApprovalRequester, title: string): MainMessage {
  const label = requester.label
  if (label.code === 'approvals.requester.conversation') return mainMessage('notify.prefix.conversation', { ...label.params, title })
  if (label.code === 'approvals.requester.pane') return mainMessage('notify.prefix.pane', { ...label.params, title })
  if (label.code === 'approvals.requester.unknownConversation') return mainMessage('notify.prefix.unknownConversation', { ...label.params, title })
  if (label.code === 'approvals.requester.unknownPane') return mainMessage('notify.prefix.unknownPane', { ...label.params, title })
  return mainMessage('notify.prefix.unknownPane', { pane: 0, title })
}
