import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AppDatabase } from '../db/index'
import { killProcess } from '../utils/process-cleanup'
import type {
  BackgroundJob,
  BackgroundJobOutputChunk,
  BackgroundJobOutputEvent,
  BackgroundJobStatus,
  BackgroundJobUpdateEvent,
  StartBackgroundJobInput
} from '../../../shared/types/background'

interface JobRow {
  id: string
  workspace_id: string
  label: string
  command: string
  cwd: string
  status: BackgroundJobStatus
  exit_code: number | null
  started_at: number
  finished_at: number | null
}

interface RuntimeJob {
  job: BackgroundJob
  process: ChildProcessWithoutNullStreams | null
  /** Ring buffer of the last N lines of stdout/stderr. */
  ringBuffer: string[]
  /** Total lines emitted (monotonic), used for sequence numbers. */
  totalLines: number
}

interface BackgroundManagerOptions {
  emitOutput?: (event: BackgroundJobOutputEvent) => void
  emitUpdate?: (event: BackgroundJobUpdateEvent) => void
}

const RING_BUFFER_LIMIT = 1000
// Per-line cap: a single line (e.g. a base64/binary dump with no newline) could
// be megabytes, blowing up the ring buffer's memory and the IPC payload. Truncate
// at ingestion; the ring-buffer LINE COUNT cap doesn't bound per-line length.
const MAX_LINE_LENGTH = 8 * 1024

/**
 * Runs commands in the background, decoupled from any terminal pane.
 * Useful for builds, watchers, test runs, deploy scripts — anything the user
 * wants to start once and monitor passively. Output is buffered in memory
 * (last 1000 lines per job) and streamed to renderers via IPC events.
 */
export class BackgroundManager {
  private readonly jobs = new Map<string, RuntimeJob>()
  private readonly emitOutput: (event: BackgroundJobOutputEvent) => void
  private readonly emitUpdate: (event: BackgroundJobUpdateEvent) => void

  constructor(private readonly db: AppDatabase, options: BackgroundManagerOptions = {}) {
    this.emitOutput = options.emitOutput ?? (() => undefined)
    this.emitUpdate = options.emitUpdate ?? (() => undefined)
    // Orphan cleanup is deferred to init() so the UPDATE doesn't run on the
    // critical boot path. background:list shows the prior state for a beat —
    // cosmetic and acceptable.
  }

  /** Deferred from the constructor: mark jobs left 'pending'/'running' by a
   *  previous run as failed. Called from the deferred startup hook. */
  init(): void {
    this.markOrphansAsFailed()
  }

  list(workspaceId: string): BackgroundJob[] {
    const rows = this.db
      .prepare('SELECT * FROM background_jobs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 50')
      .all(workspaceId) as JobRow[]
    return rows.map(mapJobRow)
  }

  getOutput(jobId: string): BackgroundJobOutputChunk {
    const runtime = this.jobs.get(jobId)
    if (!runtime) return { jobId, startSequence: 0, lines: [] }
    return {
      jobId,
      startSequence: Math.max(0, runtime.totalLines - runtime.ringBuffer.length),
      lines: [...runtime.ringBuffer]
    }
  }

  start(input: StartBackgroundJobInput): BackgroundJob {
    if (input.confirmed !== true) {
      throw new Error('Background jobs require explicit user confirmation.')
    }
    const id = randomUUID()
    const workspace = this.db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(input.workspaceId) as { root_path: string } | undefined
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    const workspaceRoot = resolve(workspace.root_path)
    const requestedPaneRoot = input.paneRootPath ? resolve(input.paneRootPath) : null
    const cwd = requestedPaneRoot && existsSync(requestedPaneRoot) && isInsideOrEqual(requestedPaneRoot, workspaceRoot)
      ? requestedPaneRoot
      : workspaceRoot
    const label = input.label?.trim() || deriveLabel(input.command)
    const startedAt = Date.now()

    this.db
      .prepare('INSERT INTO background_jobs (id, workspace_id, label, command, cwd, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.workspaceId, label, input.command, cwd, 'pending', startedAt)

    const job: BackgroundJob = {
      id,
      workspaceId: input.workspaceId,
      label,
      command: input.command,
      cwd,
      status: 'pending',
      exitCode: null,
      startedAtMs: startedAt,
      finishedAtMs: null
    }

    let child: ChildProcessWithoutNullStreams | null = null
    try {
      child = spawn(input.command, [], {
        cwd,
        shell: true,
        windowsHide: true
      })
    } catch (err) {
      this.transitionJob(id, 'failed', null)
      throw new Error(`Falha ao iniciar background job: ${err instanceof Error ? err.message : String(err)}`)
    }

    const runtime: RuntimeJob = {
      job: { ...job, status: 'running' },
      process: child,
      ringBuffer: [],
      totalLines: 0
    }
    this.jobs.set(id, runtime)

    this.transitionJob(id, 'running', null)

    const handleData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      const lines = text.split(/\r?\n/)
      for (const rawLine of lines) {
        if (rawLine.length === 0) continue
        const line = rawLine.length > MAX_LINE_LENGTH
          ? rawLine.slice(0, MAX_LINE_LENGTH) + ' … (linha truncada)'
          : rawLine
        runtime.totalLines += 1
        runtime.ringBuffer.push(line)
        if (runtime.ringBuffer.length > RING_BUFFER_LIMIT) runtime.ringBuffer.shift()
        this.emitOutput({ jobId: id, data: line, sequence: runtime.totalLines })
      }
    }

    child.stdout.on('data', handleData)
    child.stderr.on('data', handleData)
    child.on('error', (err) => {
      runtime.totalLines += 1
      const errLine = `[error] ${err.message}`
      runtime.ringBuffer.push(errLine)
      if (runtime.ringBuffer.length > RING_BUFFER_LIMIT) runtime.ringBuffer.shift()
      this.emitOutput({ jobId: id, data: errLine, sequence: runtime.totalLines })
      this.transitionJob(id, 'failed', null)
    })
    child.on('close', (code) => {
      const status: BackgroundJobStatus = code === 0 ? 'exited' : code === null ? 'killed' : 'failed'
      this.transitionJob(id, status, code)
    })

    return runtime.job
  }

  stop(jobId: string): void {
    const runtime = this.jobs.get(jobId)
    if (!runtime || !runtime.process) return
    try {
      killProcess(runtime.process)
    } catch {
      // ignore — process may already be dead
    }
    this.transitionJob(jobId, 'killed', null)
  }

  /**
   * Removes a non-running job from history. Refuses to remove a job that is
   * still running — the caller must `stop()` it first. Deletes the DB row and
   * the in-memory runtime. The renderer drops the row by re-reading list().
   */
  remove(jobId: string): void {
    const runtime = this.jobs.get(jobId)
    const status = runtime?.job.status
    if (status === 'running' || status === 'pending') {
      throw new Error('Stop the job before removing it.')
    }
    this.jobs.delete(jobId)
    this.db.prepare('DELETE FROM background_jobs WHERE id = ?').run(jobId)
  }

  stopAll(): void {
    for (const id of this.jobs.keys()) this.stop(id)
  }

  stopWorkspace(workspaceId: string): void {
    for (const [id, runtime] of this.jobs) {
      if (runtime.job.workspaceId === workspaceId) this.stop(id)
    }
  }

  private transitionJob(id: string, status: BackgroundJobStatus, exitCode: number | null): void {
    const finishedAt = status === 'running' ? null : Date.now()
    this.db
      .prepare('UPDATE background_jobs SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?')
      .run(status, exitCode, finishedAt, id)
    const runtime = this.jobs.get(id)
    if (runtime) {
      runtime.job = { ...runtime.job, status, exitCode, finishedAtMs: finishedAt }
      this.emitUpdate({ job: runtime.job })
    } else {
      // Fetch fresh from DB to emit
      const row = this.db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(id) as JobRow | undefined
      if (row) this.emitUpdate({ job: mapJobRow(row) })
    }
  }

  /** On startup, mark any jobs left in 'running'/'pending' from a previous session as failed. */
  private markOrphansAsFailed(): void {
    this.db
      .prepare("UPDATE background_jobs SET status = 'failed', finished_at = ? WHERE status IN ('pending', 'running')")
      .run(Date.now())
  }
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.toLowerCase()
  const normalizedRoot = root.toLowerCase()
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}\\`) || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function mapJobRow(row: JobRow): BackgroundJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    command: row.command,
    cwd: row.cwd,
    status: row.status,
    exitCode: row.exit_code,
    startedAtMs: row.started_at,
    finishedAtMs: row.finished_at
  }
}

function deriveLabel(command: string): string {
  const trimmed = command.trim()
  if (trimmed.length <= 40) return trimmed
  return `${trimmed.slice(0, 37)}…`
}
