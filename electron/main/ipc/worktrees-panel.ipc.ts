/**
 * A63 / N9: the Worktrees panel's two channels. The window lists a repository's worktrees and asks for a guarded
 * Remove; every check (main checkout on its real path, busy, locked, dirty, default branch, branch in use, unmerged
 * without confirmation) runs in WorktreesPanel, and each Remove and branch delete writes one person audit row there.
 * The renderer supplies a repository root it already has open; a root the app does not know is refused.
 */
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { WorktreesPanel, WorktreesPanelRemoveInput, WorktreesPanelRemoveResult, WorktreesPanelRow } from '../services/github/worktrees-panel'

const PATH_MAX = 4096

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid worktrees panel input.')
  return value as Record<string, unknown>
}

function text(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.trim() === '' || value.length > PATH_MAX || value.includes('\0')) {
    throw new Error(`Invalid ${field}.`)
  }
  return value
}

function flag(input: Record<string, unknown>, field: string, required: boolean): boolean | undefined {
  const value = input[field]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}.`)
  return value
}

export function parseWorktreesPanelListInput(value: unknown): { rootPath: string } {
  const input = record(value)
  const extra = Object.keys(input).filter(key => key !== 'rootPath')
  if (extra.length) throw new Error('Invalid worktrees panel input.')
  return { rootPath: text(input, 'rootPath') }
}

export function parseWorktreesPanelRemoveInput(value: unknown): Omit<WorktreesPanelRemoveInput, 'via'> {
  const input = record(value)
  const allowed = new Set(['rootPath', 'path', 'deleteBranch', 'confirmUnmerged'])
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Invalid worktrees panel input.')
  const confirmUnmerged = flag(input, 'confirmUnmerged', false)
  return {
    rootPath: text(input, 'rootPath'),
    path: text(input, 'path'),
    deleteBranch: flag(input, 'deleteBranch', true) as boolean,
    ...(confirmUnmerged === undefined ? {} : { confirmUnmerged })
  }
}

export interface WorktreesPanelIpcDeps {
  /** Whether the window may name this repository root (an open workspace or Thread project). */
  knownRoot?: (rootPath: string) => boolean
  /** Told after a removal, so the window's worktree lists refresh. */
  changed?: (rootPath: string) => void
}

export function registerWorktreesPanelIpc(panel: WorktreesPanel, deps: WorktreesPanelIpcDeps = {}): void {
  const guard = (rootPath: string): void => {
    if (deps.knownRoot && !deps.knownRoot(rootPath)) throw new Error('This repository is not open in OXESpace.')
  }
  ipcMain.handle(IPC_CHANNELS.worktreesPanel.list, async (_event, value: unknown): Promise<WorktreesPanelRow[]> => {
    const input = parseWorktreesPanelListInput(value)
    guard(input.rootPath)
    return panel.list(input)
  })
  ipcMain.handle(IPC_CHANNELS.worktreesPanel.remove, async (_event, value: unknown): Promise<WorktreesPanelRemoveResult> => {
    const input = parseWorktreesPanelRemoveInput(value)
    guard(input.rootPath)
    const result = await panel.remove({ ...input, via: 'person' })
    if (result.ok) deps.changed?.(input.rootPath)
    return result
  })
}
