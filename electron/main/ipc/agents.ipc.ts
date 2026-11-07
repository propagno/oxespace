import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentsReadModel } from '../services/agents/agents-read-model'
import { onAgentsChanged } from '../services/agents/agents-notifier'

/** S7.1 · The agents overview for the window (CCR #513). Not an MCP surface: see `code.agents_overview` in mcp-coverage. */
export function registerAgentsIpc(model: AgentsReadModel): () => void {
  ipcMain.handle(IPC_CHANNELS.agents.overview, () => model.overview())
  ipcMain.handle(IPC_CHANNELS.agents.markSeen, (_event, key: unknown) => {
    // Malformed input is a plain Error (C3); only the window calls this, with a key it was given.
    if (!model.markSeen(key)) throw new Error('agents:mark-seen takes { kind, id }')
    push()
  })
  // The baseline for the first diff, so the first push carries only what changed.
  model.changes()
  function push(): void {
    const change = model.changes()
    if (!change) return
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agents.onChanged, change)
  }
  return onAgentsChanged(push)
}
