// @vitest-environment node
import unzipper from 'unzipper'
import { describe, expect, it } from 'vitest'
import { buildBundle, type BundleSources } from '../electron/main/services/diagnostics/bundle'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRedactor, LOG_MESSAGE_ALLOWLIST, redactLogTail } from '../electron/main/services/diagnostics/bundle-redaction'
import { buildAnalysisSummary } from '../electron/main/services/diagnostics/summary'
import { writeZip } from '../electron/main/services/diagnostics/zip-writer'
import { DIAGNOSTICS_INCIDENT_CODES, DIAGNOSTICS_LIMITS, type DiagnosticsIncident, type DiagnosticsMetrics } from '../shared/types/diagnostics'

const TOKEN = 'sk-ant-api03-' + 'Q7'.repeat(24)
const GITHUB = 'ghp_' + 'a1B2c3D4e5'.repeat(4)
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----'
const EMAIL = 'maria.silva@acme-example.com'
const WINDOWS_PATH = 'C:\\Users\\maria\\Documents\\clients\\acme-contract.docx'
const POSIX_PATH = '/home/maria/private/notes.txt'
const CONVERSATION = 'Please refactor the payroll module before the board meeting'
const MACHINE = 'MARIA-LAPTOP-7'
const HOST = 'build-box-17.corp.acme-example.net'
const PLANTED = [TOKEN, GITHUB, 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ', 'PRIVATE KEY', EMAIL, 'maria', 'Documents', 'acme-contract', 'private/notes', 'payroll', 'board meeting', MACHINE, HOST, 'corp.acme']

const metrics: DiagnosticsMetrics = {
  at: 1, processes: [{ kind: 'main', pid: 10, cpuPercent: 2, memoryBytes: 150 * 1024 * 1024 }, { kind: 'renderer', pid: 11, cpuPercent: 4, memoryBytes: 220 * 1024 * 1024 }],
  terminals: { running: 2, agents: 1 }, storage: { freeBytes: 100 * 1024 ** 3, databaseBytes: 8 * 1024 * 1024, logsBytes: 2 * 1024 * 1024 },
  connectivity: { state: 'online', checkedAt: 1 }, gateway: null, clis: [{ id: 'claude', found: true, version: '2.1.0' }, { id: 'codex', found: false }],
  accounts: [{ provider: 'claude', signedIn: true }], mcpServers: { total: 3, healthy: 2, quarantined: 1, failing: 0 }
}

const log = [
  `[2026-10-30 10:00:00.000] [info] [main] PATH recovered from login shell: +${POSIX_PATH}`,
  `[2026-10-30 10:00:01.000] [error] Thread turn failed { prompt: '${CONVERSATION}', user: '${EMAIL}' }`,
  `[2026-10-30 10:00:02.000] [warn] [mcp] quarantined "${CONVERSATION}": tools changed`,
  `[2026-10-30 10:00:03.000] [error] Renderer failed to load ${WINDOWS_PATH} (${HOST})`,
  `[2026-10-30 10:00:04.000] [error] Unable to start agent ANTHROPIC_API_KEY=${TOKEN} token=${GITHUB}`,
  `    at Object.<anonymous> (${WINDOWS_PATH}:10:5)`,
  KEY,
  `[2026-10-30 10:00:05.000] [info] Opened ${MACHINE} for ${EMAIL}`,
  `[2026-10-30 10:00:06.000] [info] Uploading to https://${HOST}/upload?key=${TOKEN}`,
  `  "${CONVERSATION}"`
].join('\n')

const sources: BundleSources = {
  snapshot: () => ({ generatedAt: 1, appVersion: '1.4.0', platform: 'win32', arch: 'x64', nodeVersion: '22', electronVersion: '44', workspaceCount: 2,
    checks: [{ id: 'database', label: 'SQLite', tone: 'error', detail: `${CONVERSATION} at ${WINDOWS_PATH}` }] }),
  metrics: async () => metrics,
  incidents: () => [{ id: '1', code: 'incident.mcp.quarantined', area: 'mcp', firstAt: 1, lastAt: 2, count: 2, subject: '3fa9c1d2' }],
  runtimeEvents: () => `{"at":1,"event":"process-error","executable":"${WINDOWS_PATH}","note":"${TOKEN} ${EMAIL}"}`,
  logFiles: () => ['main.old.log', 'main.log'],
  readTail: async file => file === 'main.log' ? log : `[2026-10-29 09:00:00.000] [info] cwd ${POSIX_PATH}\n${KEY}`,
  about: () => ({ version: '1.4.0', host: HOST, user: MACHINE }),
  configuration: () => ({ updates: { mode: 'auto', channel: 'stable' }, lastFolder: WINDOWS_PATH, proxy: `http://${EMAIL}:${TOKEN}@${HOST}:8080` }),
  names: () => [MACHINE, 'maria']
}

describe('diagnostics bundle', () => {
  it('contains none of the planted secrets in any file of the zip', async () => {
    const bundle = await buildBundle(sources)
    const directory = await unzipper.Open.buffer(writeZip(bundle.entries))
    expect(directory.files.map(file => file.path).sort()).toEqual(['configuration.json', 'incidents.json', 'main-log-tail.txt', 'runtime-events.jsonl', 'snapshot.json', 'versions.json'])
    for (const file of directory.files) {
      const text = (await file.buffer()).toString('utf8')
      for (const secret of PLANTED) expect(text.toLowerCase(), `${file.path} contains ${secret}`).not.toContain(secret.toLowerCase())
    }
    expect(bundle.preview.redactions).toBeGreaterThan(10)
    // The preview describes the same bytes the zip holds.
    expect(bundle.preview.files.map(file => [file.name, file.bytes])).toEqual(bundle.entries.map(entry => [entry.name, entry.data.length]))
  })

  it('keeps what a diagnosis needs: times, levels, fixed words, codes and counts', async () => {
    const bundle = await buildBundle(sources)
    const text = (name: string) => bundle.entries.find(entry => entry.name === name)!.data.toString('utf8')
    const tail = text('main-log-tail.txt')
    // Only the app's own fixed messages, without what follows them; free-text lines are left out whole.
    expect(tail.split('\n')).toEqual(['[2026-10-30 10:00:00.000] [info] [main] PATH recovered from login shell …', '[2026-10-30 10:00:02.000] [warn] [mcp] quarantined …'])
    expect(tail).not.toContain('Thread turn failed')
    expect(tail).not.toContain('Opened')
    expect(tail).not.toMatch(/^\s+at /m)
    expect(JSON.parse(text('incidents.json'))[0]).toMatchObject({ code: 'incident.mcp.quarantined', count: 2 })
    expect(JSON.parse(text('snapshot.json')).snapshot.checks).toEqual([{ id: 'database', label: 'SQLite', tone: 'error' }])
    expect(JSON.parse(text('snapshot.json')).metrics.mcpServers).toEqual(metrics.mcpServers)
    expect(JSON.parse(text('configuration.json')).updates).toEqual({ mode: 'auto', channel: 'stable' })
  })

  it('counts each replaced value', () => {
    const redactor = createRedactor({ names: [MACHINE] })
    expect(redactor.text(`${EMAIL} ${WINDOWS_PATH} ${MACHINE} ${TOKEN}`)).toBe('[email] [path] [name] [redacted]')
    expect(redactor.count).toBe(4)
    redactLogTail('[2026-10-30 10:00:00.000] [info] Started: secret words\n  continuation', redactor)
    expect(redactor.count).toBe(6)
  })

  it('leaves out a line a person wrote, even with no quote or value in it, and keeps only allowlisted messages', () => {
    const redactor = createRedactor()
    const tail = redactLogTail([
      '[2026-10-30 10:00:00.000] [info] [thread] my bank password is hunter two',
      '[2026-10-30 10:00:01.000] [info] [main] uncaughtException TypeError at payroll',
      '[2026-10-30 10:00:02.000] [info] [updater] up to date',
      '[2026-10-30 10:00:03.000] [info] [mainX] uncaughtException',
      '[2026-10-30 10:00:04.000] [info] [main] uncaughtExceptionsmuggled text'
    ].join('\n'), redactor)
    expect(tail.split('\n')).toEqual(['[2026-10-30 10:00:01.000] [info] [main] uncaughtException …', '[2026-10-30 10:00:02.000] [info] [updater] up to date'])
    expect(tail).not.toContain('password')
    expect(tail).not.toContain('payroll')
    expect(redactor.count).toBe(4)
  })

  it('keeps every allowlisted log message present in the code', { timeout: 30_000 }, () => {
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? (entry.name === 'vendor' || entry.name === 'e2e' ? [] : sources(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [readFileSync(join(dir, entry.name), 'utf8')] : [])
    const code = sources(join('electron', 'main')).join('\n')
    expect(LOG_MESSAGE_ALLOWLIST.filter(entry => !code.includes(entry))).toEqual([])
  })
})

describe('analysis summary', () => {
  const base = { metrics, version: '1.4.0', platform: 'win32', arch: 'x64', now: Date.UTC(2026, 9, 30) }

  it('lists codes, areas and counts with aggregate processes and storage', () => {
    const summary = buildAnalysisSummary({ ...base, incidents: [{ id: '1', code: 'incident.mcp.quarantined', area: 'mcp', firstAt: 1, lastAt: Date.UTC(2026, 9, 29), count: 2, subject: '3fa9c1d2' }] })
    expect(summary).toContain('- incident.mcp.quarantined (mcp): 2 times, last 2026-10-29')
    expect(summary).toContain('- main: 1 process, CPU 2.0%, 150 MB')
    expect(summary).toContain('- free on the data volume: 100.0 GB')
    expect(summary).toContain('3 total, 2 healthy, 1 quarantined, 0 failing')
    expect(summary).not.toContain('3fa9c1d2')
  })

  it('stays within 4,000 characters however many incidents there are, keeping the totals', () => {
    const codes = Object.keys(DIAGNOSTICS_INCIDENT_CODES) as Array<keyof typeof DIAGNOSTICS_INCIDENT_CODES>
    const incidents: DiagnosticsIncident[] = Array.from({ length: 500 }, (_, index) => ({ id: String(index), code: codes[index % codes.length], area: DIAGNOSTICS_INCIDENT_CODES[codes[index % codes.length]], firstAt: index, lastAt: index, count: index + 1, subject: index.toString(16).padStart(8, '0') }))
    const summary = buildAnalysisSummary({ ...base, incidents })
    expect(summary.length).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.maxSummaryChars)
    expect(summary).toMatch(/- … \d+ more kinds/)
    expect(summary).toContain('## Storage')
    expect(summary).toContain('MCP servers: 3 total')
  })
})
