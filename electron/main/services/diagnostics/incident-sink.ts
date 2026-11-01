import { createHash } from 'node:crypto'
import type { DiagnosticsIncidentCode } from '../../../../shared/types/diagnostics'

/**
 * Where recording points report an incident (B8.3). Small on purpose: services import only this. The journal itself
 * is loaded the first time something is recorded or the panel asks, never at start-up. A recording point passes a
 * code and, optionally, a value naming what failed (a channel, a server id); only an 8-character hash of that value
 * goes further. Never message text, arguments or error messages. Recording never throws.
 */
export interface IncidentRecorder {
  record(code: DiagnosticsIncidentCode, subject?: string): void
  flush(): void
}

type Loader = () => Promise<IncidentRecorder>

const QUEUE_MAX = 64
let loader: Loader | null = null
let recorder: IncidentRecorder | null = null
let loading: Promise<void> | null = null
const queued: Array<[DiagnosticsIncidentCode, string | undefined]> = []

/** An id as the journal keeps it: 8 hex characters of its SHA-256, as runtime-diagnostics hashes ids. */
export function incidentSubject(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

export function recordIncident(code: DiagnosticsIncidentCode, subject?: string): void {
  try {
    const hashed = subject === undefined || subject === '' ? undefined : incidentSubject(subject)
    if (recorder) { recorder.record(code, hashed); return }
    if (queued.length < QUEUE_MAX) queued.push([code, hashed])
    void load()
  } catch { /* a diagnostics failure must never break the caller */ }
}

/**
 * The entry point for F7's interaction budgets, which have no main-process hook yet: the caller names the
 * interaction (an id of ours, such as `thread.send`), and only its hash is kept.
 */
export function recordInteractionOverBudget(interaction: string): void {
  recordIncident('incident.interaction.overBudget', interaction)
}

/** The journal, loading it on first use; null where diagnostics are not connected (tests, E2E, native failure). */
export async function incidentRecorder(): Promise<IncidentRecorder | null> {
  await load()
  return recorder
}

export function flushIncidents(): void {
  try { recorder?.flush() } catch { /* see recordIncident */ }
}

/** Called once by the diagnostics IPC on the native path. `null` disconnects (tests). */
export function connectIncidentJournal(next: Loader | null): void {
  flushIncidents() // a pending write lands before the journal is let go, not later in a folder that may be gone
  loader = next
  recorder = null
  loading = null
  if (!next) queued.splice(0)
  else if (queued.length) void load() // incidents from before the journal was connected (a busy database at start)
}

function load(): Promise<void> {
  if (recorder || !loader) return Promise.resolve()
  const current = loader
  loading ??= current().then(value => {
    if (loader !== current) return
    recorder = value
    for (const [code, subject] of queued.splice(0)) value.record(code, subject)
  }).catch(() => { loading = null })
  return loading
}
