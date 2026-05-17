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
}

export interface BackgroundJobOutputChunk {
  jobId: string
  startSequence: number
  lines: string[]
}

export interface BackgroundJobOutputEvent {
  jobId: string
  data: string
  sequence: number
}

export interface BackgroundJobUpdateEvent {
  job: BackgroundJob
}
