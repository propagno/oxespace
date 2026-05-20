import { create } from 'zustand'
import type {
  BackgroundJob,
  BackgroundJobOutputEvent,
  BackgroundJobUpdateEvent,
  StartBackgroundJobInput
} from '../../shared/types/background'

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
      set((s) => ({ outputByJob: { ...s.outputByJob, [jobId]: chunk.lines } }))
    } catch {
      // ignore
    }
  },

  setExpanded: (jobId) => set({ expandedJobId: jobId }),

  subscribe: () => {
    const offOutput = window.oxe.background.onOutput((event: BackgroundJobOutputEvent) => {
      set((s) => {
        const current = s.outputByJob[event.jobId] ?? []
        const next = [...current, event.data]
        if (next.length > OUTPUT_LIMIT) next.splice(0, next.length - OUTPUT_LIMIT)
        return { outputByJob: { ...s.outputByJob, [event.jobId]: next } }
      })
    })
    const offUpdate = window.oxe.background.onUpdate((event: BackgroundJobUpdateEvent) => {
      set((s) => {
        const list = s.jobsByWorkspace[event.job.workspaceId] ?? []
        return { jobsByWorkspace: { ...s.jobsByWorkspace, [event.job.workspaceId]: upsertJob(list, event.job) } }
      })
    })
    return () => {
      offOutput()
      offUpdate()
    }
  }
}))

export function selectJobs(workspaceId: string): (state: BackgroundStoreState) => BackgroundJob[] {
  return (state) => state.jobsByWorkspace[workspaceId] ?? []
}

export function selectOutput(jobId: string): (state: BackgroundStoreState) => string[] {
  return (state) => state.outputByJob[jobId] ?? []
}

function upsertJob(list: BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  const existingIndex = list.findIndex((item) => item.id === job.id)
  if (existingIndex === -1) return [job, ...list]
  return list.map((item, index) => index === existingIndex ? job : item)
}
