import { create } from 'zustand'
import type { OxeDashboardHandle, OxeStatusResult, OxeSummaryResult } from '../../shared/types/oxe'

/**
 * Renderer-side cache of OXE state per workspace rootPath. Two tiers:
 *   - `summaryByRoot` — the cheap `status --json --summary` hot path, refreshed
 *     live whenever the workspace's .oxe/ changes (see `subscribe`).
 *   - `byRoot` — the full `status --json`, fetched on demand for the detailed
 *     view (diagnostics, per-agent skill issues, artifacts).
 * All data comes from the external `oxe-cc` CLI via IPC, and degrades when an
 * older oxe-cc lacks a capability.
 */
interface OxeDashboardState extends OxeDashboardHandle {
  busy: boolean
}

interface OxeStoreState {
  byRoot: Record<string, OxeStatusResult>
  summaryByRoot: Record<string, OxeSummaryResult>
  loading: Record<string, boolean>
  summaryLoading: Record<string, boolean>
  dashboardByRoot: Record<string, OxeDashboardState>
  /** Timestamp of the last successful summary refresh — drives the "live" pulse. */
  lastUpdatedAt: Record<string, number>

  /** Full status (detailed view). `force` bypasses the version cache. */
  refresh: (rootPath: string, force?: boolean) => Promise<void>
  /** Cheap summary (hot path). Falls back to full status on older oxe-cc. */
  refreshSummary: (rootPath: string, force?: boolean) => Promise<void>
  /** Begin reacting to .oxe/ changes for a workspace (panel mount). */
  subscribe: (rootPath: string) => Promise<void>
  /** Stop reacting (panel unmount). */
  unsubscribe: (rootPath: string) => Promise<void>
  /** Start/reuse the embedded dashboard server for a workspace. */
  startDashboard: (rootPath: string) => Promise<void>
  stopDashboard: (rootPath: string) => Promise<void>
}

// One global push listener fans out to whichever roots are currently subscribed.
const subscribedRoots = new Set<string>()
let globalUnsub: (() => void) | null = null

export const useOxeStore = create<OxeStoreState>((set, get) => ({
  byRoot: {},
  summaryByRoot: {},
  loading: {},
  summaryLoading: {},
  dashboardByRoot: {},
  lastUpdatedAt: {},

  refresh: async (rootPath, force = false) => {
    if (!rootPath || get().loading[rootPath]) return
    set((s) => ({ loading: { ...s.loading, [rootPath]: true } }))
    try {
      const result = await window.oxe.oxe.status(rootPath, force)
      set((s) => ({ byRoot: { ...s.byRoot, [rootPath]: result }, loading: { ...s.loading, [rootPath]: false } }))
    } catch (err) {
      set((s) => ({
        byRoot: {
          ...s.byRoot,
          [rootPath]: { installed: false, version: null, isOxeProject: false, status: null, error: err instanceof Error ? err.message : String(err) }
        },
        loading: { ...s.loading, [rootPath]: false }
      }))
    }
  },

  refreshSummary: async (rootPath, force = false) => {
    if (!rootPath) return
    set((s) => ({ summaryLoading: { ...s.summaryLoading, [rootPath]: true } }))
    try {
      const result = await window.oxe.oxe.statusSummary(rootPath, force)
      set((s) => ({
        summaryByRoot: { ...s.summaryByRoot, [rootPath]: result },
        summaryLoading: { ...s.summaryLoading, [rootPath]: false },
        lastUpdatedAt: { ...s.lastUpdatedAt, [rootPath]: Date.now() }
      }))
      // Older oxe-cc without --summary: keep the detailed status authoritative.
      if (!result.supportsSummary && result.installed && result.isOxeProject) {
        void get().refresh(rootPath, force)
      }
    } catch (err) {
      set((s) => ({
        summaryByRoot: {
          ...s.summaryByRoot,
          [rootPath]: { installed: false, version: null, isOxeProject: false, summary: null, supportsSummary: false, error: err instanceof Error ? err.message : String(err) }
        },
        summaryLoading: { ...s.summaryLoading, [rootPath]: false }
      }))
    }
  },

  subscribe: async (rootPath) => {
    if (!rootPath) return
    subscribedRoots.add(rootPath)
    if (!globalUnsub) {
      globalUnsub = window.oxe.oxe.onEventsChanged(({ rootPath: changed }) => {
        if (subscribedRoots.has(changed)) void get().refreshSummary(changed, true)
      })
    }
    await get().refreshSummary(rootPath, true)
    void window.oxe.oxe.watchEvents(rootPath)
  },

  unsubscribe: async (rootPath) => {
    if (!rootPath) return
    subscribedRoots.delete(rootPath)
    void window.oxe.oxe.unwatchEvents(rootPath)
    if (subscribedRoots.size === 0 && globalUnsub) {
      globalUnsub()
      globalUnsub = null
    }
  },

  startDashboard: async (rootPath) => {
    if (!rootPath) return
    set((s) => ({
      dashboardByRoot: {
        ...s.dashboardByRoot,
        [rootPath]: { ...(s.dashboardByRoot[rootPath] ?? { ok: false, url: null, port: null, mode: null, error: null }), busy: true }
      }
    }))
    try {
      const handle = await window.oxe.oxe.startDashboard(rootPath)
      set((s) => ({ dashboardByRoot: { ...s.dashboardByRoot, [rootPath]: { ...handle, busy: false } } }))
    } catch (err) {
      set((s) => ({
        dashboardByRoot: {
          ...s.dashboardByRoot,
          [rootPath]: { ok: false, url: null, port: null, mode: null, error: err instanceof Error ? err.message : String(err), busy: false }
        }
      }))
    }
  },

  stopDashboard: async (rootPath) => {
    if (!rootPath) return
    void window.oxe.oxe.stopDashboard(rootPath)
    set((s) => {
      const next = { ...s.dashboardByRoot }
      delete next[rootPath]
      return { dashboardByRoot: next }
    })
  }
}))

export function selectOxe(rootPath: string): (state: OxeStoreState) => OxeStatusResult | undefined {
  return (state) => state.byRoot[rootPath]
}

export function selectOxeSummary(rootPath: string): (state: OxeStoreState) => OxeSummaryResult | undefined {
  return (state) => state.summaryByRoot[rootPath]
}
