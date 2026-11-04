/**
 * S7.1 · The agents overview for the E2E runs (spec §14). Rows come from OXESPACE_E2E_AGENTS (a JSON array of AgentRow),
 * kept in memory; "seen" follows the same shared rule as main (a finished agent is idle once seen). Never in a packaged
 * build: mock-ipc.ts is only loaded behind e2eMocksEnabled.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { AGENT_SOURCES, isAgentKind, type AgentRow, type AgentSource, type AgentSourceStatus, type AgentsOverview } from '../../../shared/types/agents'

function fixture(raw: string | undefined): AgentRow[] {
  if (!raw) return []
  try {
    const rows = JSON.parse(raw) as unknown
    return Array.isArray(rows) ? rows.filter((row): row is AgentRow => !!row && isAgentKind((row as AgentRow).kind) && typeof (row as AgentRow).id === 'string') : []
  } catch { return [] }
}

export function registerAgentsMock(env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now): void {
  const rows = fixture(env.OXESPACE_E2E_AGENTS)
  let seq = 0
  const sources = (): Record<AgentSource, AgentSourceStatus> => {
    seq += 1
    return Object.fromEntries(AGENT_SOURCES.map(source => [source, { ok: true, seq }])) as Record<AgentSource, AgentSourceStatus>
  }
  ipcMain.handle(IPC_CHANNELS.agents.overview, (): AgentsOverview => structuredClone({ agents: rows, sources: sources() }))
  ipcMain.handle(IPC_CHANNELS.agents.markSeen, (_event, key: unknown) => {
    const { kind, id } = (key ?? {}) as { kind?: unknown; id?: unknown }
    const row = rows.find(entry => entry.kind === kind && entry.id === id)
    if (!row) return
    row.seenAt = now()
    if (row.state === 'finished') row.state = 'idle'
    const change = structuredClone({ upsert: [row], removed: [], sources: sources() })
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agents.onChanged, change)
  })
}
