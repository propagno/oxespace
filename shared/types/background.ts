export type BackgroundJobStatus = 'pending' | 'running' | 'exited' | 'failed' | 'killed'

export interface BackgroundJob {
  id: string
  workspaceId: string
  label: string
  command: string
  cwd: string
  status: BackgroundJobStatus
  exitCode: number | null
  startedAtMs: number
  finishedAtMs: number | null
}

export interface StartBackgroundJobInput {
  workspaceId: string
  workspaceRootPath: string
  command: string
  label?: string
  paneRootPath?: string | null
  confirmed?: boolean
}

export interface BackgroundJobOutputChunk {
  jobId: string
  startSequence: number
  lines: string[]
  /** Monotonic character offset at the beginning of `lines[0]` (accounts for lines evicted from the ring buffer). */
  startCharOffset?: number
  /** Monotonic total character offset emitted by this job so far. */
  totalChars?: number
}

export interface BackgroundJobOutputEvent {
  jobId: string
  data: string
  sequence: number
}

export interface BackgroundJobUpdateEvent {
  job: BackgroundJob
}
