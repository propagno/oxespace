import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DIAGNOSTICS_INCIDENT_CODES, DIAGNOSTICS_LIMITS, type DiagnosticsIncident, type DiagnosticsIncidentCode
} from '../../../../shared/types/diagnostics'
import type { IncidentRecorder } from './incident-sink'

/**
 * The incident journal (B8.3): one JSON file in userData. The same code, area and subject add to `count` and move
 * `lastAt`. Kept 30 days, 500 kinds and 256 KiB at most; written to a temporary file and renamed, so a failed write
 * leaves the previous journal whole. An unreadable file starts over and says so with `incident.app.journalReset`.
 */
export interface JournalIo {
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, options: { encoding: 'utf8'; mode: number; flag: string }): void
  renameSync(from: string, to: string): void
  rmSync(path: string, options: { force: true }): void
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown
}

export interface JournalOptions {
  now?: () => number
  io?: JournalIo
  /** Called after a change with the number of kinds; the IPC broadcasts it. */
  onChanged?: (count: number) => void
  /** Milliseconds a change waits before it is written, so a burst is one write. 0 writes at once. */
  writeDelayMs?: number
  maxIncidents?: number
  maxBytes?: number
  retentionMs?: number
}

const SUBJECT = /^[0-9a-f]{8}$/
const nodeIo: JournalIo = { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync }

export class IncidentJournal implements IncidentRecorder {
  private incidents: DiagnosticsIncident[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private readonly now: () => number
  private readonly io: JournalIo
  private readonly limits: { max: number; bytes: number; retention: number }

  constructor(private readonly file: string, private readonly options: JournalOptions = {}) {
    this.now = options.now ?? Date.now
    this.io = options.io ?? nodeIo
    this.limits = {
      max: options.maxIncidents ?? DIAGNOSTICS_LIMITS.maxIncidents,
      bytes: options.maxBytes ?? DIAGNOSTICS_LIMITS.maxJournalBytes,
      retention: options.retentionMs ?? DIAGNOSTICS_LIMITS.incidentRetentionMs
    }
    this.load()
  }

  record(code: DiagnosticsIncidentCode, subject?: string): void {
    if (!Object.hasOwn(DIAGNOSTICS_INCIDENT_CODES, code)) return
    const safeSubject = subject !== undefined && SUBJECT.test(subject) ? subject : undefined
    const at = this.now()
    const existing = this.incidents.find(item => item.code === code && item.subject === safeSubject)
    if (existing) { existing.count = Math.min(existing.count + 1, Number.MAX_SAFE_INTEGER); existing.lastAt = Math.max(existing.lastAt, at) }
    else this.incidents.push({ id: randomUUID(), code, area: DIAGNOSTICS_INCIDENT_CODES[code], firstAt: at, lastAt: at, count: 1, ...(safeSubject ? { subject: safeSubject } : {}) })
    this.changed()
  }

  /** Newest first; `since` keeps kinds seen at or after it. */
  list(input: { since?: number; limit?: number } = {}): DiagnosticsIncident[] {
    this.prune()
    const since = input.since ?? 0
    const limit = Math.min(Math.max(1, input.limit ?? DIAGNOSTICS_LIMITS.maxIncidentsPage), DIAGNOSTICS_LIMITS.maxIncidentsPage)
    return this.incidents.filter(item => item.lastAt >= since).sort((a, b) => b.lastAt - a.lastAt).slice(0, limit).map(item => ({ ...item }))
  }

  clear(): void {
    this.incidents = []
    this.changed()
  }

  get count(): number { return this.incidents.length }

  /** Writes a pending change now (on quit, and in tests). */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty) return
    this.dirty = false
    this.prune()
    this.write()
  }

  private changed(): void {
    this.prune()
    this.dirty = true
    try { this.options.onChanged?.(this.incidents.length) } catch { /* a window that went away */ }
    const delay = this.options.writeDelayMs ?? 1000
    if (delay <= 0) { this.flush(); return }
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), delay); this.timer.unref?.() }
  }

  private load(): void {
    let text: string
    try { text = this.io.readFileSync(this.file, 'utf8') } catch { return } // no journal yet
    const parsed = parseJournal(text)
    if (parsed) { this.incidents = parsed; this.prune(); return }
    this.incidents = []
    this.record('incident.app.journalReset')
  }

  private prune(): void {
    const oldest = this.now() - this.limits.retention
    let kept = this.incidents.filter(item => item.lastAt >= oldest)
    if (kept.length > this.limits.max) kept = kept.sort((a, b) => b.lastAt - a.lastAt).slice(0, this.limits.max)
    while (kept.length && Buffer.byteLength(serialize(kept)) > this.limits.bytes) {
      kept = kept.sort((a, b) => b.lastAt - a.lastAt).slice(0, -1)
    }
    this.incidents = kept
  }

  private write(): void {
    const temporary = `${this.file}.${randomUUID().slice(0, 8)}.tmp`
    try {
      this.io.mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      this.io.writeFileSync(temporary, serialize(this.incidents), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      this.io.renameSync(temporary, this.file)
    } catch {
      // Disk full or locked: the previous journal stays as it was, and the change waits for the next write.
      try { this.io.rmSync(temporary, { force: true }) } catch { /* nothing more to do */ }
      this.dirty = true
    }
  }
}

function serialize(incidents: DiagnosticsIncident[]): string {
  return JSON.stringify({ version: 1, incidents })
}

/** The stored journal, or null when anything in it is not what this code writes. */
export function parseJournal(text: string): DiagnosticsIncident[] | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
  const list = (value as { incidents?: unknown }).incidents
  if (!Array.isArray(list)) return null
  const result: DiagnosticsIncident[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') return null
    const { id, code, area, firstAt, lastAt, count, subject } = item as Record<string, unknown>
    if (typeof id !== 'string' || !/^[0-9a-f-]{8,36}$/.test(id)) return null
    if (typeof code !== 'string' || !Object.hasOwn(DIAGNOSTICS_INCIDENT_CODES, code)) return null
    if (area !== DIAGNOSTICS_INCIDENT_CODES[code as DiagnosticsIncidentCode]) return null
    if (![firstAt, lastAt, count].every(number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0)) return null
    if (subject !== undefined && (typeof subject !== 'string' || !SUBJECT.test(subject))) return null
    result.push({ id, code: code as DiagnosticsIncidentCode, area: area as DiagnosticsIncident['area'], firstAt: firstAt as number, lastAt: lastAt as number, count: count as number, ...(subject ? { subject: subject as string } : {}) })
  }
  return result
}
