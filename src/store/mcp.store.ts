import { create } from 'zustand'
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

export function selectMcpServers(workspaceId: string | null): (state: McpStoreState) => McpServer[] {
  return (state) => state.serversByWorkspace[key(workspaceId)] ?? []
}

function sanitizeMcpError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}
