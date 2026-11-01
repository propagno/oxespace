import { create } from 'zustand'
import { i18n } from '../i18n'
import type {
  BackgroundJob,
  BackgroundJobOutputEvent,
  BackgroundJobUpdateEvent,
  StartBackgroundJobInput
} from '../../shared/types/background'
import { useActivityStore } from './activity.store'

interface BackgroundStoreState {
  jobsByWorkspace: Record<string, BackgroundJob[]>
  /** Ring buffer of output lines per job (last N) */
  outputByJob: Record<string, string[]>
  /** UI panel state: which job is expanded in the banner */
  expandedJobId: string | null
  loadJobs: (workspaceId: string) => Promise<void>
  startJob: (input: StartBackgroundJobInput) => Promise<BackgroundJob>
  stopJob: (jobId: string) => Promise<void>
  removeJob: (workspaceId: string, jobId: string) => Promise<void>
  loadOutput: (jobId: string) => Promise<void>
  setExpanded: (jobId: string | null) => void
  /** Hook into preload events; returns cleanup. */
  subscribe: () => () => void
}

const OUTPUT_LIMIT = 1000

// Coalesce high-frequency output: verbose jobs (builds/tests) emit 100-1000
// lines/s. Doing a Zustand set() — which spreads the whole outputByJob — per
// line caused a re-render storm. Instead we buffer incoming lines per job and
// flush them in a single set() on a ~50ms timer. setTimeout (not rAF) so output
// still flushes while the OXESpace window is in the background.
const FLUSH_INTERVAL_MS = 50
const pendingOutput = new Map<string, string[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

export const useBackgroundStore = create<BackgroundStoreState>((set, get) => ({
  jobsByWorkspace: {},
  outputByJob: {},
  expandedJobId: null,

  loadJobs: async (workspaceId) => {
    try {
      const jobs = await window.oxe.background.list(workspaceId)
      set((s) => ({ jobsByWorkspace: { ...s.jobsByWorkspace, [workspaceId]: jobs } }))
    } catch {
      // ignore — keep stale data
    }
  },

  startJob: async (input) => {
    const job = await window.oxe.background.start(input)
    set((s) => {
      const list = s.jobsByWorkspace[input.workspaceId] ?? []
      return { jobsByWorkspace: { ...s.jobsByWorkspace, [input.workspaceId]: upsertJob(list, job) } }
    })
    return job
  },

  stopJob: async (jobId) => {
    await window.oxe.background.stop(jobId)
    set((s) => {
      const next: Record<string, BackgroundJob[]> = {}
      for (const [workspaceId, list] of Object.entries(s.jobsByWorkspace)) {
        next[workspaceId] = list.map((job) => job.id === jobId && (job.status === 'running' || job.status === 'pending')
          ? { ...job, status: 'killed', exitCode: null, finishedAtMs: Date.now() }
          : job)
      }
      return { jobsByWorkspace: next }
    })
  },

  removeJob: async (workspaceId, jobId) => {
    await window.oxe.background.remove(jobId)
    // Drop any buffered-but-unflushed output so it can't recreate the entry.
    pendingOutput.delete(jobId)
    set((s) => {
      const list = s.jobsByWorkspace[workspaceId] ?? []
      const nextOutput = { ...s.outputByJob }
      delete nextOutput[jobId]
      return {
        jobsByWorkspace: { ...s.jobsByWorkspace, [workspaceId]: list.filter((j) => j.id !== jobId) },
        outputByJob: nextOutput,
        expandedJobId: s.expandedJobId === jobId ? null : s.expandedJobId
      }
    })
  },

  loadOutput: async (jobId) => {
    try {
      const chunk = await window.oxe.background.getOutput(jobId)
      // Drop any buffered-but-unflushed lines for this job: the snapshot already
      // includes them (it's the authoritative ring buffer from main), so letting
      // a later flush append them would duplicate/reorder lines in the UI.
      pendingOutput.delete(jobId)
      set((s) => ({ outputByJob: { ...s.outputByJob, [jobId]: chunk.lines } }))
    } catch {
      // ignore
    }
  },

  setExpanded: (jobId) => set({ expandedJobId: jobId }),

  subscribe: () => {
    if (!window.oxe?.background?.onOutput || !window.oxe?.background?.onUpdate) return () => undefined

    const flush = (): void => {
      flushTimer = null
      if (pendingOutput.size === 0) return
      const batch = new Map(pendingOutput)
      pendingOutput.clear()
      set((s) => {
        const nextOutput = { ...s.outputByJob }
        for (const [jobId, lines] of batch) {
          const merged = [...(nextOutput[jobId] ?? []), ...lines]
          if (merged.length > OUTPUT_LIMIT) merged.splice(0, merged.length - OUTPUT_LIMIT)
          nextOutput[jobId] = merged
        }
        return { outputByJob: nextOutput }
      })
    }

    const offOutput = window.oxe.background.onOutput((event: BackgroundJobOutputEvent) => {
      const buffered = pendingOutput.get(event.jobId)
      if (buffered) buffered.push(event.data)
      else pendingOutput.set(event.jobId, [event.data])
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS)
    })
    const offUpdate = window.oxe.background.onUpdate((event: BackgroundJobUpdateEvent) => {
      const previous = get().jobsByWorkspace[event.job.workspaceId]?.find((job) => job.id === event.job.id)
      recordJobOutcome(previous, event.job)
      set((s) => {
        const list = s.jobsByWorkspace[event.job.workspaceId] ?? []
        return { jobsByWorkspace: { ...s.jobsByWorkspace, [event.job.workspaceId]: upsertJob(list, event.job) } }
      })
    })
    return () => {
      offOutput()
      offUpdate()
      // Flush any buffered lines before tearing down so a job's final output
      // (which may have arrived in the last <50ms) isn't lost. flush() clears
      // the timer and pendingOutput itself.
      flush()
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      pendingOutput.clear()
    }
  }
}))

/** Test-only: clear the module-level output coalescing buffer/timer between tests. */
export function __resetBackgroundOutputBufferForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingOutput.clear()
}

// One shared empty list for selectors: a fresh [] per read makes zustand 5 re-render forever.
const NO_ITEMS: never[] = []

export function selectJobs(workspaceId: string): (state: BackgroundStoreState) => BackgroundJob[] {
  return (state) => state.jobsByWorkspace[workspaceId] ?? NO_ITEMS
}

export function selectOutput(jobId: string): (state: BackgroundStoreState) => string[] {
  return (state) => state.outputByJob[jobId] ?? NO_ITEMS
}

const ACTIVE = new Set<BackgroundJob['status']>(['pending', 'running'])

/**
 * A job that stops on its own goes to the activity center; one the person stopped does not.
 * An unseen job counts as active, since the first update about it may already be the last one.
 */
export function recordJobOutcome(previous: BackgroundJob | undefined, job: BackgroundJob): void {
  if (previous && !ACTIVE.has(previous.status)) return
  if (job.status !== 'exited' && job.status !== 'failed') return
  const failed = job.status === 'failed' || (job.exitCode !== null && job.exitCode !== 0)
  useActivityStore.getState().record({
    source: 'background', id: job.id, kind: failed ? 'failed' : 'finished',
    target: { type: 'background', workspaceId: job.workspaceId, jobId: job.id },
    title: job.label || job.command,
    detail: failed ? (job.exitCode !== null ? i18n.t('background.jobFailedCode', { ns: 'code', code: job.exitCode }) : i18n.t('background.jobFailed', { ns: 'code' })) : i18n.t('background.jobFinished', { ns: 'code' })
  })
}

function upsertJob(list: BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  const existingIndex = list.findIndex((item) => item.id === job.id)
  if (existingIndex === -1) return [job, ...list]
  return list.map((item, index) => index === existingIndex ? job : item)
}

// bisect only (F7.3): which fields change during a cold switch
useBackgroundStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]) w.__stores['Background.' + key] = (w.__stores['Background.' + key] ?? 0) + 1 })
