import { release, version as osVersion } from 'node:os'
import type { DiagnosticsSnapshot } from '../../../shared/types/diagnostics'
import type { IssueReport } from '../../../shared/issue-report'
import { sanitizeDiagnosticText } from './diagnostics.service'

/** Recent runtime events kept in the report: enough to see what happened last, small enough to read. */
const MAX_EVENT_LINES = 40
const MAX_EVENT_CHARS = 5_000

export interface IssueReportInput {
  snapshot: DiagnosticsSnapshot
  /** The runtime log as exported by the Diagnostics page (already local metadata only). */
  runtimeEvents: string
  /** OS description; defaults to this machine. */
  osDescription?: string
}

/** The last lines of the runtime log, redacted, with a cap on both lines and characters. */
export function recentRuntimeEvents(log: string): string[] {
  const lines = sanitizeDiagnosticText(log).split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean)
  const recent = lines.slice(-MAX_EVENT_LINES)
  // Keep the newest lines when the cap bites.
  while (recent.length > 1 && recent.join('\n').length > MAX_EVENT_CHARS) recent.shift()
  return recent.map(line => line.slice(0, 400))
}

/**
 * Builds the issue the person previews: version, system, the health checks (names and tone only, like the
 * exported diagnostics), the recent runtime events with secrets and the home directory removed, and the steps
 * template. The text is English because the maintainers read it; the dialog around it is translated.
 */
export function buildIssueReport({ snapshot, runtimeEvents, osDescription }: IssueReportInput): IssueReport {
  const events = recentRuntimeEvents(runtimeEvents)
  const system = osDescription ?? `${osVersion()} ${release()}`
  const checks = snapshot.checks.map(check => `- ${check.label}: ${check.tone}`)
  const body = [
    '## What happened',
    '',
    '<!-- Describe the problem in a sentence or two. -->',
    '',
    '## Steps to reproduce',
    '',
    '1. ',
    '2. ',
    '3. ',
    '',
    '## What you expected',
    '',
    '',
    '## Environment',
    '',
    `- OXESpace: ${snapshot.appVersion}`,
    `- System: ${system} (${snapshot.platform} ${snapshot.arch})`,
    `- Electron ${snapshot.electronVersion}, Node ${snapshot.nodeVersion}`,
    '',
    '## Diagnostics (redacted, from this computer)',
    '',
    ...(checks.length ? checks : ['- No health checks reported']),
    '',
    `<details><summary>Recent runtime events (${events.length})</summary>`,
    '',
    '```text',
    ...(events.length ? events : ['(none)']),
    '```',
    '',
    '</details>',
    ''
  ].join('\n')
  return { title: '[Bug] ', body, diagnosticLines: events.length }
}
