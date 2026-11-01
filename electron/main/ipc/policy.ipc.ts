import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PolicyView } from '../../../shared/policy'
import { policyStore } from '../services/policy'

/** Read only: Settings shows the policy files; nothing in the app writes them. */
export function registerPolicyIpc(rootOf: (workspaceId: string) => string | undefined): void {
  ipcMain.handle(IPC_CHANNELS.policy.get, (event, workspaceId: unknown): PolicyView => {
    const root = typeof workspaceId === 'string' && workspaceId ? rootOf(workspaceId) : undefined
    const store = policyStore()
    if (!store) return { sources: [], problems: [], locations: [] }
    return { ...store.load(root), locations: store.locations(root) }
  })
}
