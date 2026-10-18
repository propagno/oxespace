import type { ThreadTurnVerdict } from '../threadTurnVerdict'

/** A supervising Thread's plan: tasks that each run in their own worker Thread. */
export type WorkRunStatus = 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'
export type WorkTaskStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'

export interface WorkTaskResult {
  /** The worker's closing message, bounded. */
  summary: string
  verdict: ThreadTurnVerdict['status']
  filesChanged: string[]
  toolCalls: number
  failedToolCalls: number
  failure?: ThreadTurnVerdict['failure']
}

export interface WorkTask {
  id: string
  runId: string
  key: string
  title: string
  prompt: string
  provider: 'claude' | 'codex'
  access: 'read-only' | 'workspace-write'
  status: WorkTaskStatus
  dependsOn: string[]
  threadId?: string
  /** Why the task is blocked, failed or cancelled. */
  reason?: string
  result?: WorkTaskResult
  startedAt?: number
  finishedAt?: number
}

export interface WorkRun {
  id: string
  supervisorThreadId: string
  projectRoot: string
  title: string
  status: WorkRunStatus
  depth: number
  budget: { usd?: number; turns?: number }
  /** Spending of the run's workers so far, from the usage ledger. */
  spent: { usd: number; turns: number }
  autoWake: boolean
  createdAt: number
  updatedAt: number
  tasks: WorkTask[]
}

export interface WorkEvent { id: number; runId: string; taskId?: string; at: number; kind: string; detail: string }

export interface WorkPlanInput {
  key: string
  title: string
  tasks: Array<{ key: string; title: string; prompt: string; dependsOn?: string[]; access?: WorkTask['access']; provider?: WorkTask['provider'] }>
  budget?: { usd?: number; turns?: number }
  autoWake?: boolean
}
