import { create } from 'zustand'
import { i18n } from '../i18n'
import { humanizeError } from '../utils/humanizeError'
import type {
  CreateMcpServerInput,
  McpHealthStatus,
  McpServer,
  McpServerHealthEvent,
  UpdateMcpServerInput
} from '../../shared/types/mcp'

interface McpStoreState {
  serversByWorkspace: Record<string, McpServer[]>
  loading: boolean
  error: string | null
  load: (workspaceId: string | null) => Promise<void>
  create: (input: CreateMcpServerInput) => Promise<McpServer>
  update: (input: UpdateMcpServerInput) => Promise<McpServer>
  remove: (id: string) => Promise<void>
  start: (id: string) => Promise<void>
  /** Checks the server answers and lists its tools; OXESpace does not keep it running. */
  test: (id: string) => Promise<McpServer>
  stop: (id: string) => Promise<void>
  applyHealth: (event: McpServerHealthEvent) => void
  subscribe: () => () => void
}

const key = (workspaceId: string | null): string => workspaceId ?? '__global__'

export const useMcpStore = create<McpStoreState>((set, get) => ({
  serversByWorkspace: {},
  loading: false,
  error: null,

  load: async (workspaceId) => {
    set({ loading: true, error: null })
    try {
      const servers = await window.oxe.mcp.list(workspaceId)
      set((s) => ({
        serversByWorkspace: { ...s.serversByWorkspace, [key(workspaceId)]: servers },
        loading: false
      }))
    } catch (err) {
      set({ loading: false, error: sanitizeMcpError(err) })
    }
  },

  create: async (input) => {
    const server = await window.oxe.mcp.create(input)
    const k = key(input.workspaceId)
    set((s) => ({
      serversByWorkspace: { ...s.serversByWorkspace, [k]: [server, ...(s.serversByWorkspace[k] ?? [])] }
    }))
    return server
  },

  update: async (input) => {
    const server = await window.oxe.mcp.update(input)
    set((s) => {
      const k = key(server.workspaceId)
      const list = s.serversByWorkspace[k] ?? []
      return { serversByWorkspace: { ...s.serversByWorkspace, [k]: list.map((srv) => srv.id === server.id ? server : srv) } }
    })
    return server
  },

  remove: async (id) => {
    await window.oxe.mcp.delete(id)
    set((s) => {
      const next: Record<string, McpServer[]> = {}
      for (const [k, list] of Object.entries(s.serversByWorkspace)) {
        next[k] = list.filter((srv) => srv.id !== id)
      }
      return { serversByWorkspace: next }
    })
  },

  start: async (id) => {
    try {
      const tools = await window.oxe.mcp.start(id)
      // Patch the server in store with fresh tools and 'healthy' status
      set((s) => {
        const next: Record<string, McpServer[]> = {}
        for (const [k, list] of Object.entries(s.serversByWorkspace)) {
          next[k] = list.map((srv) => srv.id === id ? { ...srv, tools, health: 'healthy' as McpHealthStatus, healthMessage: null } : srv)
        }
        return { serversByWorkspace: next }
      })
    } catch (err) {
      const message = sanitizeMcpError(err)
      set((s) => {
        const next: Record<string, McpServer[]> = {}
        for (const [k, list] of Object.entries(s.serversByWorkspace)) {
          next[k] = list.map((srv) => srv.id === id ? { ...srv, health: 'unhealthy' as McpHealthStatus, healthMessage: message } : srv)
        }
        return { serversByWorkspace: next }
      })
      throw err
    }
  },

  test: async (id) => {
    let server: McpServer
    try {
      server = await window.oxe.mcp.test(id)
    } catch (err) {
      set({ error: sanitizeMcpError(err) })
      throw err
    }
    set((s) => {
      const next: Record<string, McpServer[]> = {}
      for (const [k, list] of Object.entries(s.serversByWorkspace)) {
        next[k] = list.map((srv) => srv.id === id ? server : srv)
      }
      return { serversByWorkspace: next }
    })
    return server
  },

  stop: async (id) => {
    await window.oxe.mcp.stop(id)
    set((s) => {
      const next: Record<string, McpServer[]> = {}
      for (const [k, list] of Object.entries(s.serversByWorkspace)) {
        next[k] = list.map((srv) => srv.id === id ? { ...srv, health: 'unknown' as McpHealthStatus, healthMessage: null } : srv)
      }
      return { serversByWorkspace: next }
    })
  },

  applyHealth: (event) => {
    set((s) => {
      const next: Record<string, McpServer[]> = {}
      for (const [k, list] of Object.entries(s.serversByWorkspace)) {
        next[k] = list.map((srv) => srv.id === event.serverId
          ? { ...srv, health: event.status, healthMessage: event.message }
          : srv)
      }
      return { serversByWorkspace: next }
    })
  },

  subscribe: () => {
    if (!window.oxe?.mcp?.onHealth) return () => undefined
    return window.oxe.mcp.onHealth((event) => {
      get().applyHealth(event)
    })
  }
}))

// One empty list for every workspace without servers: a fresh [] per read makes zustand 5 re-render forever.
const NO_SERVERS: McpServer[] = []

export function selectMcpServers(workspaceId: string | null): (state: McpStoreState) => McpServer[] {
  return (state) => state.serversByWorkspace[key(workspaceId)] ?? NO_SERVERS
}

function sanitizeMcpError(err: unknown): string {
  return humanizeError(err, i18n.t('failures.unexpected.mcp'))
}

// bisect only (F7.3): which fields change during a cold switch
useMcpStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]) w.__stores['Mcp.' + key] = (w.__stores['Mcp.' + key] ?? 0) + 1 })
