/** C3 message codes of the diagnostics domain (`incident.*`, `diagnostics.*`, `bundle.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface DiagnosticsMessageParams {
  /** Diagnostics journal (B8.3): one kind of incident. */
  'incident.window.crashed': Record<string, never>
  'incident.window.rendererGone': Record<string, never>
  'incident.ipc.handlerFailed': Record<string, never>
  'incident.ipc.validationRejected': Record<string, never>
  'incident.agent.startFailed': Record<string, never>
  'incident.mcp.quarantined': Record<string, never>
  'incident.database.busy': Record<string, never>
  'incident.oxequery.timeout': Record<string, never>
  /** The OxeQuery worker stopped answering, and its restart was put off because a person session has a transaction open or a command running (B14). */
  'incident.oxequery.restartDeferred': Record<string, never>
  'incident.updater.failed': Record<string, never>
  'incident.interaction.overBudget': Record<string, never>
  'incident.app.journalReset': Record<string, never>
  /** F26: the window gave no first answer to a close or quit within 3 s; main went ahead. */
  'incident.app.closeUnanswered': Record<string, never>
  /** F26: the window's renderer went away while a close or quit was waiting on it; main went ahead. */
  'incident.app.closeRendererGone': Record<string, never>
  /** F26: the close guard hit an error or an inconsistent state; the close or quit went ahead unasked. */
  'incident.app.closeGuardFailed': Record<string, never>
  /** A link the main window tried to open outside the app was refused (its reason is the incident's subject). */
  'incident.window.externalRefused': Record<string, never>
  'incident.window.externalRateLimited': Record<string, never>
  /** The system refused to open a link the app allowed (no mail app or browser registered for it). */
  'incident.window.externalOpenFailed': Record<string, never>
  /** The main window called window.open; it opens nothing by itself (links leave through app:open-external). */
  'incident.window.openDenied': Record<string, never>
  /** The main window tried to navigate or redirect away from the app; it was kept in place and nothing was opened. */
  'incident.window.navigationDenied': Record<string, never>
  /** Diagnostics bundle (B8.3): one of its files is over the per-file cap; nothing was saved. */
  'diagnostics.bundle.fileTooLarge': Record<string, never>
  /** Diagnostics bundle (B8.3): the whole archive is over its cap; nothing was saved. */
  'diagnostics.bundle.tooLarge': Record<string, never>
  /** What each file of the diagnostics bundle holds (B8.3 preview). */
  'bundle.file.snapshot': Record<string, never>
  'bundle.file.incidents': Record<string, never>
  'bundle.file.logTail': Record<string, never>
  'bundle.file.runtime': Record<string, never>
  'bundle.file.versions': Record<string, never>
  'bundle.file.configuration': Record<string, never>
}

export const DIAGNOSTICS_MESSAGE_CODES = [
  'incident.window.crashed',
  'incident.window.rendererGone',
  'incident.ipc.handlerFailed',
  'incident.ipc.validationRejected',
  'incident.agent.startFailed',
  'incident.mcp.quarantined',
  'incident.database.busy',
  'incident.oxequery.timeout',
  'incident.oxequery.restartDeferred',
  'incident.updater.failed',
  'incident.interaction.overBudget',
  'incident.app.journalReset',
  'incident.app.closeUnanswered',
  'incident.app.closeRendererGone',
  'incident.app.closeGuardFailed',
  'incident.window.externalRefused',
  'incident.window.externalRateLimited',
  'incident.window.externalOpenFailed',
  'incident.window.openDenied',
  'incident.window.navigationDenied',
  'diagnostics.bundle.fileTooLarge',
  'diagnostics.bundle.tooLarge',
  'bundle.file.snapshot',
  'bundle.file.incidents',
  'bundle.file.logTail',
  'bundle.file.runtime',
  'bundle.file.versions',
  'bundle.file.configuration'
] as const satisfies readonly (keyof DiagnosticsMessageParams)[]
