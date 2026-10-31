/**
 * Scheduled automations: run an agent with a prompt in a fresh worktree on a
 * schedule. Times are the machine's local time.
 */
export type AutomationAgent = 'claude' | 'codex'

export type AutomationSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; hour: number; minute: number }
  /** `days` are 0 (Sunday) to 6 (Saturday). */
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }
  /** Five fields: minute hour day-of-month month day-of-week. */
  | { kind: 'cron'; expression: string }

export interface Automation {
  id: string
  name: string
  prompt: string
  /** The repository's primary checkout; each run gets its own worktree from it. */
  rootPath: string
  agent: AutomationAgent
  /** Start point for the run's branch; the repo default (origin/main...) when null. */
  baseBranch: string | null
  schedule: AutomationSchedule
  /** Shell command run in the root first; the run is skipped unless it exits 0. */
  precheck: string | null
  /** Extra CLI arguments appended to the agent command (e.g. a permission mode). */
  extraArgs: string
  timeoutMinutes: number
  /** A due run older than this when the app wakes is skipped, not run late. */
  graceMinutes: number
  enabled: boolean
  createdAt: number
  lastRunAt: number | null
  nextRunAt: number | null
}

export interface AutomationInput {
  name: string
  prompt: string
  rootPath: string
  agent: AutomationAgent
  baseBranch?: string | null
  schedule: AutomationSchedule
  precheck?: string | null
  extraArgs?: string
  timeoutMinutes?: number
  graceMinutes?: number
  enabled?: boolean
}

export type AutomationRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dispatch_failed'
  | 'skipped_precheck'
  | 'skipped_missed'
  | 'skipped_busy'

export interface AutomationRun {
  /** The sentence above as a message code the window translates (C3); the text stays for logs and older clients. */
  messageCode?: import('../messages').MainMessage
  id: string
  automationId: string
  scheduledFor: number
  status: AutomationRunStatus
  startedAt: number | null
  finishedAt: number | null
  worktreePath: string | null
  branch: string | null
  exitCode: number | null
  /** Tail of the agent's output (bounded). */
  outputTail: string
  message: string | null
}
