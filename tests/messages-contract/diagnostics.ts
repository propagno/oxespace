import type { DiagnosticsMessageParams } from '../../shared/messages/diagnostics'

/** The parameter names each diagnostics code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const DIAGNOSTICS_PARAMETERS: Record<keyof DiagnosticsMessageParams, string[]> = {
  'incident.window.crashed': [],
  'incident.window.rendererGone': [],
  'incident.ipc.handlerFailed': [],
  'incident.ipc.validationRejected': [],
  'incident.agent.startFailed': [],
  'incident.mcp.quarantined': [],
  'incident.database.busy': [],
  'incident.oxequery.timeout': [],
  'incident.oxequery.restartDeferred': [],
  'incident.updater.failed': [],
  'incident.interaction.overBudget': [],
  'incident.app.journalReset': [],
  'incident.app.closeUnanswered': [],
  'incident.app.closeRendererGone': [],
  'incident.app.closeGuardFailed': [],
  'incident.window.externalRefused': [],
  'incident.window.externalRateLimited': [],
  'incident.window.externalOpenFailed': [],
  'incident.window.openDenied': [],
  'incident.window.navigationDenied': [],
  'diagnostics.bundle.fileTooLarge': [],
  'diagnostics.bundle.tooLarge': [],
  'bundle.file.snapshot': [],
  'bundle.file.incidents': [],
  'bundle.file.logTail': [],
  'bundle.file.runtime': [],
  'bundle.file.versions': [],
  'bundle.file.configuration': []
}
