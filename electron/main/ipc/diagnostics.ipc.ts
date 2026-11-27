import { parseRecord } from './ipc-guards'
import { IPC_SENDER_REFUSED, measureIpcWith } from './ipc-sender-guard'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveAppDatabasePath, type AppDatabase } from '../db'
import type { InternalMcpHandle } from '../mcp-internal/bootstrap'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DIAGNOSTICS_LIMITS, RENDERER_ERROR_BOUNDARIES, RENDERER_ERROR_CODE, RENDERER_ERROR_IDENTIFIER, RENDERER_ERROR_KINDS, RENDERER_ERROR_STACK_HASH, type AgentProcessControlRequest, type AgentProcessGovernancePolicy, type AgentProcessPriority, type RendererErrorBoundary, type RendererErrorInput, type RendererErrorKind } from '../../../shared/types/diagnostics'
import { DiagnosticsService } from '../services/diagnostics.service'
import { exportRuntimeDiagnostics, recordFirstAnswer } from '../services/runtime-diagnostics'
import { connectIncidentJournal, flushIncidents, incidentRecorder, recordIncident } from '../services/diagnostics/incident-sink'
import type { DiagnosticsDependencies, DiagnosticsRuntime } from '../services/diagnostics/runtime'
import type { IncidentJournal } from '../services/diagnostics/incident-journal'

/** What the B8.3 measurements read from the rest of the app; each is optional, and missing ones read as zero. */
export interface DiagnosticsSources {
  terminals?: { counts(): { running: number; agents: number } }
  mcp?: { healthCounts(): { total: number; healthy: number; quarantined: number; failing: number } }
  agentProcessSampler?: DiagnosticsDependencies['agentProcessSampler']
  agentProcessRegistry?: DiagnosticsDependencies['agentProcessRegistry']
  hibernateManagedAgent?: DiagnosticsDependencies['hibernateManagedAgent']
  enableAgentProcesses?: boolean
  enableIdleReaperTimer?: boolean
}

let runtime: Promise<DiagnosticsRuntime> | null = null
let loader: (() => Promise<DiagnosticsRuntime>) | null = null

/** The diagnostics behind the channels and `oxespace_diagnostics`, loaded on first use; null off the native path. */
export function diagnosticsRuntime(): Promise<DiagnosticsRuntime> | null { return loader?.() ?? null }

export function registerDiagnosticsIpc(
  db: AppDatabase,
  internalMcp: InternalMcpHandle,
  sources: DiagnosticsSources = {},
  service = new DiagnosticsService(db, () => internalMcp.getStatus())
): DiagnosticsService {
  const userData = app.getPath('userData')
  const broadcast = (count: number) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.diagnostics.onIncidentsChanged, { count })
  }
  connectIncidentJournal(async () => {
    const { IncidentJournal } = await import('../services/diagnostics/incident-journal')
    return new IncidentJournal(join(userData, 'diagnostics', 'incidents.json'), { onChanged: broadcast })
  })
  const journal = async () => (await incidentRecorder()) as IncidentJournal | null
  const dependencies: DiagnosticsDependencies = {
    snapshot: () => service.getSnapshot(),
    journal,
    terminals: sources.terminals ? () => sources.terminals!.counts() : undefined,
    mcpServers: sources.mcp ? () => sources.mcp!.healthCounts() : undefined,
    agentProcessSampler: sources.agentProcessSampler,
    agentProcessRegistry: sources.agentProcessRegistry,
    hibernateManagedAgent: sources.hibernateManagedAgent,
    enableAgentProcesses: sources.enableAgentProcesses,
    enableIdleReaperTimer: sources.enableIdleReaperTimer,
    databaseFile: resolveAppDatabasePath(),
    userData
  }
  // Loaded on first use: measuring, the bundle and the summary stay out of the main entry.
  const load = (): Promise<DiagnosticsRuntime> => (runtime ??= import('../services/diagnostics/runtime').then(module => new module.DiagnosticsRuntime(dependencies))
    .catch(error => { runtime = null; throw error }))
  loader = load
  // The performance journal (1.5.1): loaded off the startup path; until it is, nothing is measured.
  const perf = import('../services/perf/perf-journal').then(module => { module.startPerfJournal(join(userData, 'diagnostics'), measureIpcWith); return module })
    .catch(() => null)
  app.once('will-quit', () => { flushIncidents(); void runtime?.then(value => value.dispose()); void perf.then(module => module?.stopPerfJournal()) })

  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, (event) => service.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, async (event) => {
    const path = await savePath(event, `oxespace-diagnostics-${new Date().toISOString().slice(0, 10)}.md`, 'Export OXESpace diagnostics', { name: 'Markdown', extensions: ['md'] })
    if (!path) return null
    await writeFile(path, service.buildSanitizedReport(), { encoding: 'utf8', mode: 0o600 })
    return path
  })
  // Built on demand and loaded lazily: the main bundle carries only this handler, not the report builder.
  ipcMain.handle(IPC_CHANNELS.diagnostics.buildIssueReport, async (event) => {
    const { buildIssueReport } = await import('../services/issue-report')
    return buildIssueReport({ snapshot: service.getSnapshot(), runtimeEvents: exportRuntimeDiagnostics() })
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.recordFirstAnswer, (event, input: unknown) => {
    recordFirstAnswer(input)
  })
  // Frame and input times from the window; the journal keeps only known names and well-formed counts.
  ipcMain.handle(IPC_CHANNELS.diagnostics.reportPerf, async (event, input: unknown) => {
    (await perf)?.perfJournal()?.addBatch(input)
  })
  // OXE-366: a React crash in the window, as names and a stack hash. Anything outside the contract is refused, so no
  // message, path or other text can reach the journal; the subject is hashed like every incident's.
  ipcMain.handle(IPC_CHANNELS.diagnostics.reportRendererError, (event, ...args: unknown[]) => {
    const report = rendererErrorInput(args)
    recordIncident('incident.window.rendererError', [report.kind, report.boundary ?? '', report.component ?? '', report.errorName, report.code ?? '', report.stackHash ?? ''].join(':'))
  })

  ipcMain.handle(IPC_CHANNELS.diagnostics.watch, async (event, ...args: unknown[]) => {
    const input = strictInput(args, ['intervalMs'])
    const intervalMs = input.intervalMs ?? DIAGNOSTICS_LIMITS.defaultIntervalMs
    if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs < DIAGNOSTICS_LIMITS.minIntervalMs || intervalMs > DIAGNOSTICS_LIMITS.maxIntervalMs) {
      throw new Error(`intervalMs must be a whole number from ${DIAGNOSTICS_LIMITS.minIntervalMs} to ${DIAGNOSTICS_LIMITS.maxIntervalMs}`)
    }
    return { subscriptionId: (await load()).watcher.watch(event.sender, intervalMs) }
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.unwatch, async (event, ...args: unknown[]) => {
    const { subscriptionId } = strictInput(args, ['subscriptionId'], true)
    if (typeof subscriptionId !== 'string' || !/^[0-9a-f-]{36}$/.test(subscriptionId)) throw new Error('subscriptionId is not a diagnostics subscription')
    // Nothing to stop when nothing was ever watched: the runtime is not loaded for this.
    if (runtime) (await runtime).watcher.unwatch(subscriptionId, event.sender)
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.incidents, async (event, ...args: unknown[]) => {
    const input = strictInput(args, ['since', 'limit'])
    if (input.since !== undefined && (typeof input.since !== 'number' || !Number.isSafeInteger(input.since) || input.since < 0)) throw new Error('since must be a time in milliseconds')
    if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > DIAGNOSTICS_LIMITS.maxIncidentsPage)) {
      throw new Error(`limit must be a whole number from 1 to ${DIAGNOSTICS_LIMITS.maxIncidentsPage}`)
    }
    return (await journal())?.list({ since: input.since as number | undefined, limit: input.limit as number | undefined }) ?? []
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.clearIncidents, async (event, ...args: unknown[]) => {
    noInput(args)
    ;(await journal())?.clear()
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.previewBundle, async (event, ...args: unknown[]) => {
    noInput(args)
    return (await (await load()).bundle()).preview
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportBundle, async (event, ...args: unknown[]) => {
    noInput(args)
    const [{ writeZip }, bundle] = await Promise.all([import('../services/diagnostics/zip-writer'), load().then(value => value.bundle())])
    // Built before the dialog: a bundle over its size cap fails with its code and nothing is written.
    const archive = writeZip(bundle.entries)
    const path = await savePath(event, `oxespace-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`, 'Save OXESpace diagnostics', { name: 'Zip archive', extensions: ['zip'] })
    if (!path) return null
    await writeFile(path, archive, { mode: 0o600 })
    return path
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.analysisSummary, async (event, ...args: unknown[]) => {
    noInput(args)
    return (await load()).analysisSummary()
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.agentProcesses, async (_event, ...args: unknown[]) => {
    const request = agentProcessRequestInput(args)
    return (await load()).handleAgentProcesses(request)
  })
  return service
}

async function savePath(event: IpcMainInvokeEvent, defaultPath: string, title: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const options = { title, defaultPath, filters: [filter] }
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/** One optional object with only the named fields; anything else is refused. */
function strictInput(args: unknown[], allowed: string[], required = false): Record<string, unknown> {
  if (args.length > 1) throw new Error('Diagnostics takes one input object')
  if (args[0] === undefined && !required) return {}
  const input = parseRecord(args[0], 'input')
  const unknown = Object.keys(input).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`Unknown diagnostics input: ${unknown.slice(0, 5).join(', ')}`)
  return input
}

/** The window's crash report, with only the contract's fields, each in its shape; anything else is refused. */
function rendererErrorInput(args: unknown[]): RendererErrorInput {
  const input = strictInput(args, ['kind', 'boundary', 'component', 'errorName', 'code', 'stackHash'], true)
  const kind = (RENDERER_ERROR_KINDS as readonly unknown[]).includes(input.kind) ? input.kind as RendererErrorKind : null
  if (!kind) throw new Error('kind is not a renderer error kind')
  if (typeof input.errorName !== 'string' || !RENDERER_ERROR_IDENTIFIER.test(input.errorName)) throw new Error('errorName is not a class name')
  if (input.boundary !== undefined && (kind !== 'boundary' || !(RENDERER_ERROR_BOUNDARIES as readonly unknown[]).includes(input.boundary))) throw new Error('boundary is not a renderer error boundary')
  if (input.component !== undefined && (typeof input.component !== 'string' || !RENDERER_ERROR_IDENTIFIER.test(input.component))) throw new Error('component is not a component name')
  if (input.code !== undefined && (typeof input.code !== 'string' || input.code.length > 80 || !RENDERER_ERROR_CODE.test(input.code))) throw new Error('code is not a message code')
  if (input.stackHash !== undefined && (typeof input.stackHash !== 'string' || !RENDERER_ERROR_STACK_HASH.test(input.stackHash))) throw new Error('stackHash is not a hash')
  return {
    kind, errorName: input.errorName,
    ...(input.boundary !== undefined ? { boundary: input.boundary as RendererErrorBoundary } : {}),
    ...(input.component !== undefined ? { component: input.component as string } : {}),
    ...(input.code !== undefined ? { code: input.code as string } : {}),
    ...(input.stackHash !== undefined ? { stackHash: input.stackHash as string } : {})
  }
}

function noInput(args: unknown[]): void {
  if (args.length > 0 && !(args.length === 1 && args[0] === undefined)) throw new Error('This diagnostics call takes no input')
}

const AGENT_PROCESS_PRIORITIES = new Set<AgentProcessPriority>(['normal', 'belowNormal', 'low'])

function agentProcessRequestInput(args: unknown[]): AgentProcessControlRequest {
  if (args.length !== 1) throw new Error('Agent process request must be a single object')
  const raw = parseRecord(args[0], 'input')
  const op = raw.op
  if (op === 'snapshot' || op === 'getPolicy' || op === 'reapIdle') {
    const unknown = Object.keys(raw).filter(key => key !== 'op')
    if (unknown.length) throw new Error(`Unknown diagnostics input: ${unknown.slice(0, 5).join(', ')}`)
    return { op }
  }
  if (op === 'setPolicy') {
    const unknown = Object.keys(raw).filter(key => key !== 'op' && key !== 'policy')
    if (unknown.length) throw new Error(`Unknown diagnostics input: ${unknown.slice(0, 5).join(', ')}`)
    const policy = parseRecord(raw.policy, 'policy')
    const badPolicy = Object.keys(policy).filter(key => !['autoEcoBackground', 'idleReaperEnabled', 'idleTtlMinutes', 'maxConcurrentAgents'].includes(key))
    if (badPolicy.length) throw new Error(`Unknown policy field: ${badPolicy.slice(0, 5).join(', ')}`)
    if (policy.autoEcoBackground !== undefined && typeof policy.autoEcoBackground !== 'boolean') throw new Error('autoEcoBackground must be a boolean')
    if (policy.idleReaperEnabled !== undefined && typeof policy.idleReaperEnabled !== 'boolean') throw new Error('idleReaperEnabled must be a boolean')
    if (policy.idleTtlMinutes !== undefined && (typeof policy.idleTtlMinutes !== 'number' || !Number.isInteger(policy.idleTtlMinutes) || policy.idleTtlMinutes < 0 || policy.idleTtlMinutes > 240)) {
      throw new Error('idleTtlMinutes must be a whole number from 0 to 240')
    }
    if (policy.maxConcurrentAgents !== undefined && (typeof policy.maxConcurrentAgents !== 'number' || !Number.isInteger(policy.maxConcurrentAgents) || policy.maxConcurrentAgents < 1 || policy.maxConcurrentAgents > 32)) {
      throw new Error('maxConcurrentAgents must be a whole number from 1 to 32')
    }
    return { op, policy: policy as Partial<AgentProcessGovernancePolicy> }
  }
  if (op === 'setPriority') {
    const unknown = Object.keys(raw).filter(key => !['op', 'rootPid', 'priority'].includes(key))
    if (unknown.length) throw new Error(`Unknown diagnostics input: ${unknown.slice(0, 5).join(', ')}`)
    if (typeof raw.rootPid !== 'number' || !Number.isInteger(raw.rootPid) || raw.rootPid <= 1) throw new Error('rootPid must be a valid process id')
    if (typeof raw.priority !== 'string' || !AGENT_PROCESS_PRIORITIES.has(raw.priority as AgentProcessPriority)) throw new Error('priority must be normal, belowNormal, or low')
    return { op, rootPid: raw.rootPid, priority: raw.priority as AgentProcessPriority }
  }
  if (op === 'hibernate' || op === 'killTree') {
    const unknown = Object.keys(raw).filter(key => key !== 'op' && key !== 'rootPid')
    if (unknown.length) throw new Error(`Unknown diagnostics input: ${unknown.slice(0, 5).join(', ')}`)
    if (typeof raw.rootPid !== 'number' || !Number.isInteger(raw.rootPid) || raw.rootPid <= 1) throw new Error('rootPid must be a valid process id')
    return { op, rootPid: raw.rootPid }
  }
  throw new Error('Unknown agent process operation')
}

let hooksInstalled = false

/**
 * Recording points the whole app shares (B8.3), installed before any handler is registered: an IPC handler that
 * throws (SQLITE_BUSY becomes `incident.database.busy`), and a window's renderer that crashed or went away. Only the
 * channel name or the kind of web contents is hashed into the subject; the error itself never reaches the journal,
 * and is rethrown unchanged.
 */
export function installIncidentHooks(target: Pick<typeof ipcMain, 'handle'> = ipcMain, application: Pick<typeof app, 'on'> = app): void {
  if (hooksInstalled) return
  hooksInstalled = true
  const handle = target.handle.bind(target)
  target.handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => handle(channel, (event, ...args) => {
    const failed = (error: unknown) => { recordIpcFailure(channel, error); throw error }
    let result: unknown
    try { result = listener(event, ...args) } catch (error) { failed(error) }
    return result instanceof Promise ? result.catch(failed) : result
  })
  application.on('render-process-gone', (_event: unknown, contents: WebContents, details: { reason: string }) => {
    if (details.reason === 'clean-exit') return
    const subject = typeof contents?.getType === 'function' ? contents.getType() : 'window'
    recordIncident(details.reason === 'crashed' || details.reason === 'oom' ? 'incident.window.crashed' : 'incident.window.rendererGone', subject)
  })
}

export function recordIpcFailure(channel: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code
  if (code === IPC_SENDER_REFUSED) return // the sender guard recorded it as incident.ipc.senderRefused
  recordIncident(code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' ? 'incident.database.busy'
    : isValidationRefusal(error) ? 'incident.ipc.validationRejected' : 'incident.ipc.handlerFailed', channel)
}

/**
 * A refusal of the request's shape or sender rather than a failure while handling it: the input parsers and frame
 * guards throw `Invalid …` / `Unknown … field` / `… must be …` / `… requires the application main frame`.
 */
export function isValidationRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ValidationError') return true
  // A TypeError is the handler's own bug, whatever its message says.
  if (error.name === 'TypeError') return false
  return /^(Invalid|Unknown|Malformed)\b/.test(error.message) || /\bmust be\b/.test(error.message) || /requires the application main frame/.test(error.message)
}

/** Tests only. */
export function resetDiagnosticsIpcForTests(): void { hooksInstalled = false; runtime = null; loader = null; connectIncidentJournal(null) }
