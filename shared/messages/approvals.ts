/** C3 message codes of the approvals domain (`approvals.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface ApprovalsMessageParams {
  // B10 · Approvals (shared/types/approvals.ts). Titles, summaries, requesters, options and the app's notes.
  'approvals.title.agent': Record<string, never>
  'approvals.title.oxequery': Record<string, never>
  'approvals.title.previewAutomation': Record<string, never>
  'approvals.title.crash': Record<string, never>
  /**
   * A `confirm`-level MCP tool; `tool` and `action` are the tool's identifiers (`oxespace_git`, `push`), not sentences, and
   * `target` is what it applies to from the app's records (a project path, a server, a resource).
   */
  'approvals.summary.mcpConfirm': { tool: string; action: string; target: string }
  'approvals.summary.oxequery.read': Record<string, never>
  'approvals.summary.oxequery.write': Record<string, never>
  'approvals.summary.oxequery.action': Record<string, never>
  'approvals.summary.preview.closeTab': Record<string, never>
  'approvals.summary.preview.click': Record<string, never>
  'approvals.summary.preview.fill': Record<string, never>
  'approvals.summary.preview.navigate': Record<string, never>
  'approvals.summary.preview.scroll': Record<string, never>
  'approvals.summary.preview.other': { action: string }
  'approvals.summary.crash': Record<string, never>
  /** The app's name for who asks: the agent's provider and the pane's position, never the pane's chosen name. */
  'approvals.requester.pane': { agent: string; pane: number }
  /** A conversation, by provider and a short id the app assigned. */
  'approvals.requester.conversation': { agent: string; conversation: string }
  /** The provider is not known to the app: never a provider name, so it cannot pass for a trusted one. */
  'approvals.requester.unknownPane': { pane: number }
  'approvals.requester.unknownConversation': { conversation: string }
  'approvals.requester.mcpServer': { server: string }
  'approvals.requester.app': Record<string, never>
  /** A Web Preview automation call with no pane or conversation behind it. */
  'approvals.requester.preview': Record<string, never>
  'approvals.option.deny': Record<string, never>
  'approvals.option.allowOnce': Record<string, never>
  'approvals.option.allowSessionReads': Record<string, never>
  'approvals.option.closeTab': Record<string, never>
  'approvals.option.restart': Record<string, never>
  'approvals.option.keepWorking': Record<string, never>
  /** `statement` is the SQL keyword the classifier saw (`DROP`, `DELETE`). */
  'approvals.note.sql.removes': { statement: string }
  'approvals.note.sql.noWhere': { statement: string }
  'approvals.note.sql.alterDrop': Record<string, never>
  'approvals.note.sql.withNoWhere': { statement: string }
  'approvals.note.sql.explainAnalyze': Record<string, never>
  'approvals.note.sql.selectInto': Record<string, never>
  'approvals.note.sql.notReadOnly': { statement: string }
  'approvals.note.sql.outsideReach': { calls: string[] }
  'approvals.note.production': Record<string, never>
  'approvals.note.mongo.deletes': { count: number }
  'approvals.note.mongo.changes': { count: number }
  'approvals.note.mongo.emptyFilter': Record<string, never>
  'approvals.note.agent.actsOnPrompt': Record<string, never>
  'approvals.note.agent.turnStopped': Record<string, never>
  'approvals.note.thread.actsOnMessage': Record<string, never>
  'approvals.note.skill.followed': Record<string, never>
  'approvals.note.automation.runsAlone': Record<string, never>
  /** B15: an agent asks to open a page that is not on this computer's loopback. */
  'approvals.note.preview.notLocal': Record<string, never>
  'approvals.note.worktree.folderDeleted': Record<string, never>
  'approvals.note.worktree.forceDiscards': Record<string, never>
  'approvals.note.git.branchShared': Record<string, never>
  'approvals.note.checkpoint.replaces': Record<string, never>
  'approvals.note.github.autoMerge': Record<string, never>
  'approvals.note.github.releasePublic': Record<string, never>
  /** The requester's text was longer than the window shows; only deny is offered. */
  'approvals.note.textCut': { max: number }
  'approvals.note.crash': Record<string, never>
  /** R2: the requester's text holds bidi controls or invisible characters; the risk is at least high. */
  'approvals.note.hiddenCharacters': Record<string, never>
  /** The system dialog cannot hold Allow back for 2 s, so a critical request is deny-only there. */
  'approvals.note.nativeCriticalDenyOnly': Record<string, never>
  /** R3: the OS notification when a request waits and the window is not focused. Fixed text, never request content. */
  'approvals.notify.waiting': Record<string, never>
  /** The window could not show the modal for a request, so it opened in a system dialog. */
  'approvals.unavailable': Record<string, never>
  /** Nobody answered in time; the request was denied. */
  'approvals.expired': Record<string, never>
  /** Refusals of `approvals.respond`, `ack` and `unavailable` (APPROVAL_REFUSALS). */
  'approvals.refused.notPending': Record<string, never>
  'approvals.refused.staleGeneration': Record<string, never>
  'approvals.refused.alreadyAnswered': Record<string, never>
  'approvals.refused.unknownOption': Record<string, never>
  'approvals.refused.alreadyReported': Record<string, never>
  /** An allow at critical risk before the modal had been shown for APPROVAL_CRITICAL_ALLOW_DELAY_MS. */
  'approvals.refused.tooSoon': Record<string, never>
  /** R1: an allow before the window acknowledged showing the request, at any risk. */
  'approvals.refused.notShown': Record<string, never>
  /** Denied before it was shown: APPROVAL_QUEUE_MAX requests were already waiting. */
  'approvals.denied.queueFull': { max: number }
  'approvals.denied.timeout': Record<string, never>
  'approvals.denied.cancelled': Record<string, never>
  /** Denied before it was shown: the text to approve is longer than a person reviews. */
  'approvals.denied.tooLong': { max: number }
}

export const APPROVALS_MESSAGE_CODES = [
  'approvals.title.agent',
  'approvals.title.oxequery',
  'approvals.title.previewAutomation',
  'approvals.title.crash',
  'approvals.summary.mcpConfirm',
  'approvals.summary.oxequery.read',
  'approvals.summary.oxequery.write',
  'approvals.summary.oxequery.action',
  'approvals.summary.preview.closeTab',
  'approvals.summary.preview.click',
  'approvals.summary.preview.fill',
  'approvals.summary.preview.navigate',
  'approvals.summary.preview.scroll',
  'approvals.summary.preview.other',
  'approvals.summary.crash',
  'approvals.requester.pane',
  'approvals.requester.conversation',
  'approvals.requester.unknownPane',
  'approvals.requester.unknownConversation',
  'approvals.requester.mcpServer',
  'approvals.requester.app',
  'approvals.requester.preview',
  'approvals.option.deny',
  'approvals.option.allowOnce',
  'approvals.option.allowSessionReads',
  'approvals.option.closeTab',
  'approvals.option.restart',
  'approvals.option.keepWorking',
  'approvals.note.sql.removes',
  'approvals.note.sql.noWhere',
  'approvals.note.sql.alterDrop',
  'approvals.note.sql.withNoWhere',
  'approvals.note.sql.explainAnalyze',
  'approvals.note.sql.selectInto',
  'approvals.note.sql.notReadOnly',
  'approvals.note.sql.outsideReach',
  'approvals.note.production',
  'approvals.note.mongo.deletes',
  'approvals.note.mongo.changes',
  'approvals.note.mongo.emptyFilter',
  'approvals.note.agent.actsOnPrompt',
  'approvals.note.agent.turnStopped',
  'approvals.note.thread.actsOnMessage',
  'approvals.note.skill.followed',
  'approvals.note.automation.runsAlone',
  'approvals.note.preview.notLocal',
  'approvals.note.worktree.folderDeleted',
  'approvals.note.worktree.forceDiscards',
  'approvals.note.git.branchShared',
  'approvals.note.checkpoint.replaces',
  'approvals.note.github.autoMerge',
  'approvals.note.github.releasePublic',
  'approvals.note.textCut',
  'approvals.note.crash',
  'approvals.note.hiddenCharacters',
  'approvals.note.nativeCriticalDenyOnly',
  'approvals.notify.waiting',
  'approvals.unavailable',
  'approvals.expired',
  'approvals.refused.notPending',
  'approvals.refused.staleGeneration',
  'approvals.refused.alreadyAnswered',
  'approvals.refused.unknownOption',
  'approvals.refused.alreadyReported',
  'approvals.refused.tooSoon',
  'approvals.refused.notShown',
  'approvals.denied.queueFull',
  'approvals.denied.timeout',
  'approvals.denied.cancelled',
  'approvals.denied.tooLong'
] as const satisfies readonly (keyof ApprovalsMessageParams)[]
