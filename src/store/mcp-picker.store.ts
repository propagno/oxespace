import { create } from 'zustand'
import type { McpReadResourceResult, McpResourceAttachment, McpResourceDescriptor } from '../../shared/types/mcp'

interface McpPickerStoreState {
  /** Per-conversation disabled MCP tool patterns (`<serverKey>/*` or `<serverKey>/<toolName>`). */
  disabledToolsByThread: Record<string, string[]>
  /** Cached MCP resources per server id for quick composer attachment. */
  resourcesByServer: Record<string, McpResourceDescriptor[]>
  /** Attached MCP resources per conversation draft (bounded & secret-redacted). */
  mcpResourcesByThread: Record<string, McpResourceAttachment[]>
  listResources: (serverId: string) => Promise<McpResourceDescriptor[]>
  readResource: (serverId: string, uri: string) => Promise<McpReadResourceResult>
  setThreadDisabledTools: (threadId: string, disabled: string[]) => void
  addMcpResource: (threadId: string, resource: McpResourceAttachment) => void
  removeMcpResource: (threadId: string, resourceId: string) => void
  clearMcpResources: (threadId: string) => void
}

/**
 * Lazy-loaded store for the composer MCP Tool Picker & Resources browser.
 * Kept separate from `mcp.store.ts` and `thread.store.ts` so it never enters the renderer boot bundle.
 */
export const useMcpPickerStore = create<McpPickerStoreState>((set) => ({
  disabledToolsByThread: {},
  resourcesByServer: {},
  mcpResourcesByThread: {},

  listResources: async (serverId) => {
    const api = window.oxe?.mcp?.listResources
    if (!api) return []
    const resources = await api(serverId)
    set((s) => ({ resourcesByServer: { ...s.resourcesByServer, [serverId]: resources } }))
    return resources
  },

  readResource: async (serverId, uri) => {
    const api = window.oxe?.mcp?.readResource
    if (!api) throw new Error('MCP resource reading is unavailable.')
    return api({ serverId, uri })
  },

  setThreadDisabledTools: (threadId, disabled) => {
    set((s) => ({
      disabledToolsByThread: { ...s.disabledToolsByThread, [threadId]: [...new Set(disabled)] }
    }))
  },

  addMcpResource: (threadId, resource) => {
    set((s) => ({
      mcpResourcesByThread: {
        ...s.mcpResourcesByThread,
        [threadId]: [...(s.mcpResourcesByThread[threadId] ?? []).filter(value => value.id !== resource.id), resource].slice(-6)
      }
    }))
  },

  removeMcpResource: (threadId, resourceId) => {
    set((s) => ({
      mcpResourcesByThread: {
        ...s.mcpResourcesByThread,
        [threadId]: (s.mcpResourcesByThread[threadId] ?? []).filter(value => value.id !== resourceId)
      }
    }))
  },

  clearMcpResources: (threadId) => {
    set((s) => ({
      mcpResourcesByThread: { ...s.mcpResourcesByThread, [threadId]: [] }
    }))
  }
}))
