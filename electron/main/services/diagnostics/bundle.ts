import { open } from 'node:fs/promises'
import type { DiagnosticsBundlePreview, DiagnosticsIncident, DiagnosticsMetrics, DiagnosticsSnapshot } from '../../../../shared/types/diagnostics'
import { createRedactor, redactLogTail } from './bundle-redaction'
import type { ZipEntry } from './zip-writer'

/**
 * The problem bundle (B8.3): what the person previews and then saves as a .zip. Every file is built here, already
 * redacted, so the preview and the export show the same bytes. Nothing is sent anywhere.
 */
export interface BundleSources {
  snapshot(): DiagnosticsSnapshot
  metrics(): Promise<DiagnosticsMetrics>
  incidents(): DiagnosticsIncident[]
  runtimeEvents(): string
  /** The app's own log files, oldest first; only their tail is read. */
  logFiles(): string[]
  about(): Record<string, unknown>
  /** Settings that are not secrets: modes, channels, counts and flags. */
  configuration(): Record<string, unknown>
  /** The computer's name and the user name, to remove wherever they appear. */
  names(): string[]
  readTail?(path: string, bytes: number): Promise<string>
}

export interface Bundle { entries: ZipEntry[]; preview: DiagnosticsBundlePreview }

const LOG_TAIL_BYTES = 256 * 1024

export async function buildBundle(sources: BundleSources): Promise<Bundle> {
  const redactor = createRedactor({ names: safe(() => sources.names(), []) })
  const json = (value: unknown) => redactor.text(JSON.stringify(value, null, 2))
  const snapshot = safe(() => sources.snapshot(), null)
  // Check details can carry error text or a path; their id, label and tone say enough.
  const safeSnapshot = snapshot ? { ...snapshot, checks: snapshot.checks.map(({ id, label, tone }) => ({ id, label, tone })) } : null
  const metrics = await sources.metrics().catch(() => null)
  const incidents = safe(() => sources.incidents(), [])
  const readTail = sources.readTail ?? tailOf
  let logText = ''
  for (const file of safe(() => sources.logFiles(), [])) logText += (await readTail(file, LOG_TAIL_BYTES).catch(() => '')) + '\n'

  const files: Array<{ name: string; summary: string; text: string }> = [
    { name: 'snapshot.json', summary: 'Checks, processes, storage, connectivity, CLIs and MCP server counts', text: json({ snapshot: safeSnapshot, metrics }) },
    { name: 'incidents.json', summary: `${incidents.length} incident kind${incidents.length === 1 ? '' : 's'}: codes, areas, counts and times`, text: json(incidents) },
    { name: 'runtime-events.jsonl', summary: 'Compact runtime events: process starts and exits, hashed ids, no arguments', text: redactor.text(safe(() => sources.runtimeEvents(), '')) },
    { name: 'main-log-tail.txt', summary: 'Last lines of the app log: time, level and fixed message words; values dropped', text: redactLogTail(logText, redactor) },
    { name: 'versions.json', summary: 'App, Electron, Chromium, Node.js and system versions', text: json(safe(() => sources.about(), {})) },
    { name: 'configuration.json', summary: 'Settings without secrets: modes, channels and counts', text: json(safe(() => sources.configuration(), {})) }
  ]
  const entries = files.map(file => ({ name: file.name, data: Buffer.from(file.text, 'utf8') }))
  return {
    entries,
    preview: { files: files.map((file, index) => ({ name: file.name, bytes: entries[index].data.length, summary: file.summary })), redactions: redactor.count }
  }
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}

/** The last `bytes` of a file, starting at a whole line. */
async function tailOf(path: string, bytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    return length < size ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}
