import { create } from 'zustand'
import type {
  GitHubBranch,
  GitHubCheckpoint,
  GitHubCommit,
  GitHubCommitDetails,
  GitHubConnectedRepository,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubPullRequest,
  GitHubRelease,
  GitHubWorkflow,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetails,
  GitHubWorkspaceInput,
  GitHubWorkspaceStatus
} from '../../shared/types/github'

interface GitHubWorkspaceState {
  status: GitHubWorkspaceStatus | null
  branches: GitHubBranch[]
  pullRequests: GitHubPullRequest[]
  commits: GitHubCommit[]
  commitDetails: Record<string, GitHubCommitDetails>
  releases: GitHubRelease[]
  workflows: GitHubWorkflow[]
  workflowRuns: GitHubWorkflowRun[]
  workflowRunDetails: Record<number, GitHubWorkflowRunDetails>
  checkpoints: GitHubCheckpoint[]
  connectedRepositories: GitHubConnectedRepository[]
  loadedTabs: Record<string, boolean>
  loading: boolean
  refreshing: boolean
  error: string | null
  lastMessage: string | null
}

interface GitHubStoreState {
  byWorkspace: Record<string, GitHubWorkspaceState>
  loadStatus: (input: GitHubWorkspaceInput) => Promise<void>
  loadTab: (input: GitHubWorkspaceInput, tab: string) => Promise<void>
  prefetchOnOpen: (input: GitHubWorkspaceInput) => Promise<void>
  fetch: (input: GitHubWorkspaceInput) => Promise<void>
  pullFfOnly: (input: GitHubWorkspaceInput) => Promise<void>
  stageAll: (input: GitHubWorkspaceInput) => Promise<void>
  commit: (input: GitHubWorkspaceInput & { message: string }) => Promise<void>
  generateCommitMessage: (input: GitHubWorkspaceInput) => Promise<string>
  push: (input: GitHubWorkspaceInput) => Promise<void>
  commitAndPush: (input: GitHubWorkspaceInput & { message: string }) => Promise<void>
  createBranch: (input: GitHubWorkspaceInput & { name: string; checkout?: boolean }) => Promise<void>
  checkoutBranch: (input: GitHubWorkspaceInput & { name: string; force?: boolean }) => Promise<void>
  createPullRequest: (input: GitHubCreatePullRequestInput) => Promise<void>
  createRelease: (input: GitHubCreateReleaseInput) => Promise<void>
  runWorkflow: (input: GitHubWorkspaceInput & { workflowId: string; ref?: string; fields?: Record<string, string> }) => Promise<void>
  rerunRun: (input: GitHubWorkspaceInput & { runId: number; failedOnly: boolean }) => Promise<void>
  createCheckpoint: (input: GitHubWorkspaceInput & { name: string; description?: string }) => Promise<void>
  restoreCheckpoint: (input: GitHubWorkspaceInput & { checkpointId: string }) => Promise<void>
  deleteCheckpoint: (workspaceId: string, checkpointId: string) => Promise<void>
  connectRepository: (input: GitHubWorkspaceInput & { fullName: string; url?: string | null }) => Promise<void>
  loadCommitDetails: (input: GitHubWorkspaceInput & { oid: string }) => Promise<GitHubCommitDetails>
  loadWorkflowRunDetails: (input: GitHubWorkspaceInput & { runId: number }) => Promise<GitHubWorkflowRunDetails>
  clearError: (workspaceId: string) => void
}

const EMPTY: GitHubWorkspaceState = {
  status: null,
  branches: [],
  pullRequests: [],
  commits: [],
  commitDetails: {},
  releases: [],
  workflows: [],
  workflowRuns: [],
  workflowRunDetails: {},
  checkpoints: [],
  connectedRepositories: [],
  loadedTabs: {},
  loading: false,
  refreshing: false,
  error: null,
  lastMessage: null
}

// Module-level trackers — NOT in store state to avoid extra re-renders.
const statusFetchedAt = new Map<string, number>()
const STATUS_STALE_MS = 10_000

// Per-workspace+tab AbortController. Parallel prefetches can run without
// cancelling each other, while repeated loads of the same tab still cancel stale work.
const tabAbortControllers = new Map<string, AbortController>()

// Track tabs already prefetched for a workspace to avoid duplicate prefetch on remount.
const prefetchedWorkspaces = new Set<string>()

export const useGitHubStore = create<GitHubStoreState>((set, get) => ({
  byWorkspace: {},

  loadStatus: async (input) => {
    const current = get().byWorkspace[input.workspaceId]
    const hasCachedStatus = current?.status != null
    // Stale-while-revalidate: if we already have status, do not flip `loading`;
    // signal a background refresh instead. UI keeps rendering the existing status.
    setWorkspace(set, input.workspaceId, hasCachedStatus
      ? { refreshing: true, error: null }
      : { loading: true, error: null })

    try {
      const status = await window.oxe.github.getWorkspaceStatus(input)
      statusFetchedAt.set(input.workspaceId, Date.now())
      setWorkspace(set, input.workspaceId, { status, loading: false, refreshing: false })
    } catch (error) {
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, error: sanitizeIpcError(error) })
    }
  },

  loadTab: async (input, tab) => {
    const controllerKey = `${input.workspaceId}:${tab}`
    const previousAbort = tabAbortControllers.get(controllerKey)
    if (previousAbort) previousAbort.abort()
    const controller = new AbortController()
    tabAbortControllers.set(controllerKey, controller)
    const { signal } = controller

    const current = get().byWorkspace[input.workspaceId] ?? EMPTY
    const tabAlreadyLoaded = current.loadedTabs[tab] === true
    const hasCachedStatus = current.status != null

    // First-time load for this tab → show skeleton via `loading`.
    // Subsequent loads → keep showing existing data, flag `refreshing`.
    setWorkspace(set, input.workspaceId, tabAlreadyLoaded
      ? { refreshing: true, error: null }
      : { loading: true, error: null })

    try {
      // Reuse status if fresh; else refetch (and update timestamp).
      const now = Date.now()
      const lastStatusAt = statusFetchedAt.get(input.workspaceId) ?? 0
      const needsFreshStatus = !hasCachedStatus || (now - lastStatusAt) > STATUS_STALE_MS

      let status = current.status
      if (needsFreshStatus) {
        status = await window.oxe.github.getWorkspaceStatus(input)
        if (signal.aborted) return
        statusFetchedAt.set(input.workspaceId, now)
        setWorkspace(set, input.workspaceId, { status })
      }

      // Tab-specific fetch
      const patch = await fetchTabData(input, tab, status)
      if (signal.aborted) return

      setWorkspace(set, input.workspaceId, {
        ...patch,
        loadedTabs: { ...current.loadedTabs, [tab]: true },
        loading: false,
        refreshing: false,
        error: null
      })
    } catch (error) {
      if (signal.aborted) return
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, error: sanitizeIpcError(error) })
    } finally {
      // Clear the controller reference if it's still the current one.
      if (tabAbortControllers.get(controllerKey) === controller) {
        tabAbortControllers.delete(controllerKey)
      }
    }
  },

  prefetchOnOpen: async (input) => {
    if (prefetchedWorkspaces.has(input.workspaceId)) return
    prefetchedWorkspaces.add(input.workspaceId)

    // Fire-and-forget background prefetch for cheap, non-network tabs only.
    // PRs and Releases are intentionally NOT prefetched — they require `gh` network calls
    // and respecting the API rate limit means only fetching them on user demand.
    const tabs = ['branches', 'commits', 'checkpoints', 'repos']
    // Don't await the whole Promise.all — let the loadTab calls run independently.
    // Each one handles its own loading state and AbortController collisions are fine
    // because subsequent user clicks will abort lingering prefetches.
    Promise.allSettled(tabs.map((tab) => get().loadTab(input, tab))).catch(() => { /* swallowed */ })
  },

  fetch: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.fetch(input), () => get().loadStatus(input)),
  pullFfOnly: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.pullFfOnly(input), () => get().loadStatus(input)),
  stageAll: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.stageAll(input), () => get().loadStatus(input)),
  commit: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.commit(input), () => get().loadStatus(input)),
  generateCommitMessage: async (input) => {
    const hasCached = get().byWorkspace[input.workspaceId]?.status != null
    setWorkspace(set, input.workspaceId, hasCached
      ? { refreshing: true, error: null, lastMessage: null }
      : { loading: true, error: null, lastMessage: null })
    try {
      const result = await window.oxe.github.generateCommitMessage(input)
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, lastMessage: 'Mensagem de commit gerada.' })
      return result.message
    } catch (error) {
      const message = sanitizeIpcError(error)
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, error: message })
      throw new Error(message)
    }
  },
  push: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.push(input), () => get().loadStatus(input)),
  commitAndPush: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.commitAndPush(input), () => get().loadStatus(input)),
  createBranch: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.createBranch(input), () => get().loadTab(input, 'branches')),
  checkoutBranch: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.checkoutBranch(input), () => Promise.all([get().loadStatus(input), get().loadTab(input, 'branches')]).then(() => undefined)),
  createPullRequest: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.createPullRequest(input), () => get().loadTab(input, 'prs')),
  createRelease: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.createRelease(input), () => get().loadTab(input, 'releases')),
  runWorkflow: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.runWorkflow(input), () => get().loadTab(input, 'actions')),
  rerunRun: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.rerunRun({ rootPath: input.rootPath, runId: input.runId, failedOnly: input.failedOnly }), () => get().loadTab(input, 'actions')),
  createCheckpoint: async (input) => runMutation(set, input.workspaceId, async () => {
    await window.oxe.github.createCheckpoint(input)
    return { ok: true, message: 'Checkpoint criado.' }
  }, () => get().loadTab(input, 'checkpoints')),
  restoreCheckpoint: async (input) => runMutation(set, input.workspaceId, () => window.oxe.github.restoreCheckpoint(input), () => get().loadStatus(input)),
  deleteCheckpoint: async (workspaceId, checkpointId) => runMutation(set, workspaceId, () => window.oxe.github.deleteCheckpoint({ checkpointId }), async () => {
    const state = get().byWorkspace[workspaceId]
    setWorkspace(set, workspaceId, { checkpoints: (state?.checkpoints ?? []).filter((item) => item.id !== checkpointId) })
  }),
  connectRepository: async (input) => runMutation(set, input.workspaceId, async () => {
    await window.oxe.github.connectRepository(input)
    return { ok: true, message: 'Repository connected.' }
  }, () => get().loadTab(input, 'repos')),
  loadCommitDetails: async (input) => {
    const hasCached = get().byWorkspace[input.workspaceId]?.commitDetails?.[input.oid] != null
    setWorkspace(set, input.workspaceId, hasCached
      ? { refreshing: true, error: null }
      : { loading: true, error: null })
    try {
      const details = await window.oxe.github.getCommitDetails(input)
      const current = get().byWorkspace[input.workspaceId]?.commitDetails ?? {}
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, commitDetails: { ...current, [input.oid]: details } })
      return details
    } catch (error) {
      const message = sanitizeIpcError(error)
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, error: message })
      throw new Error(message)
    }
  },
  loadWorkflowRunDetails: async (input) => {
    const hasCached = get().byWorkspace[input.workspaceId]?.workflowRunDetails?.[input.runId] != null
    setWorkspace(set, input.workspaceId, hasCached
      ? { refreshing: true, error: null }
      : { loading: true, error: null })
    try {
      const details = await window.oxe.github.getWorkflowRunDetails({ rootPath: input.rootPath, runId: input.runId })
      const current = get().byWorkspace[input.workspaceId]?.workflowRunDetails ?? {}
      setWorkspace(set, input.workspaceId, {
        loading: false,
        refreshing: false,
        workflowRunDetails: { ...current, [input.runId]: details }
      })
      return details
    } catch (error) {
      const message = sanitizeIpcError(error)
      setWorkspace(set, input.workspaceId, { loading: false, refreshing: false, error: message })
      throw new Error(message)
    }
  },
  clearError: (workspaceId) => setWorkspace(set, workspaceId, { error: null })
}))

export function selectGitHubWorkspace(workspaceId: string): (state: GitHubStoreState) => GitHubWorkspaceState {
  return (state) => state.byWorkspace[workspaceId] ?? EMPTY
}

async function fetchTabData(
  input: GitHubWorkspaceInput,
  tab: string,
  status: GitHubWorkspaceStatus | null
): Promise<Partial<GitHubWorkspaceState>> {
  if (tab === 'branches') return { branches: await window.oxe.github.listBranches(input) }
  if (tab === 'prs') {
    if (!status?.cli.available || !status.cli.authenticated) return { pullRequests: [] }
    return { pullRequests: await window.oxe.github.listPullRequests({ ...input, state: 'open' }) }
  }
  if (tab === 'commits') return { commits: await window.oxe.github.listCommits(input) }
  if (tab === 'releases') {
    if (!status?.cli.available || !status.cli.authenticated) return { releases: [] }
    return { releases: await window.oxe.github.listReleases(input) }
  }
  if (tab === 'actions') {
    if (!status?.cli.available || !status.cli.authenticated) return { workflows: [], workflowRuns: [] }
    const [workflows, workflowRuns] = await Promise.all([
      window.oxe.github.listWorkflows(input),
      window.oxe.github.listWorkflowRuns(input)
    ])
    return { workflows, workflowRuns }
  }
  if (tab === 'checkpoints') return { checkpoints: await window.oxe.github.listCheckpoints(input) }
  if (tab === 'repos' || tab === 'settings') {
    return { connectedRepositories: await window.oxe.github.listConnectedRepositories(input) }
  }
  return {}
}

function setWorkspace(set: (fn: (state: GitHubStoreState) => Partial<GitHubStoreState>) => void, workspaceId: string, patch: Partial<GitHubWorkspaceState>): void {
  set((state) => ({
    byWorkspace: {
      ...state.byWorkspace,
      [workspaceId]: {
        ...(state.byWorkspace[workspaceId] ?? EMPTY),
        ...patch
      }
    }
  }))
}

async function runMutation(
  set: (fn: (state: GitHubStoreState) => Partial<GitHubStoreState>) => void,
  workspaceId: string,
  run: () => Promise<{ ok: boolean; message: string }>,
  refresh: () => Promise<void>
): Promise<void> {
  setWorkspace(set, workspaceId, { loading: true, error: null, lastMessage: null })
  try {
    const result = await run()
    await refresh()
    setWorkspace(set, workspaceId, { loading: false, refreshing: false, error: null, lastMessage: result.message })
  } catch (error) {
    setWorkspace(set, workspaceId, { loading: false, refreshing: false, error: sanitizeIpcError(error) })
  }
}

export function sanitizeIpcError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error || 'Unexpected GitHub error')
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  message = message.replace(/^Error:\s*/i, '')
  message = message.replace(/\s+/g, ' ').trim()
  if (/GitHub CLI not found|gh .*not.*found|spawn gh ENOENT/i.test(message)) {
    return 'GitHub CLI not found. Install it from cli.github.com and run gh auth login.'
  }
  return message || 'Unexpected GitHub error'
}
