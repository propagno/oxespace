import { ipcMain } from 'electron'
import type { ThreadManager } from '../services/conversation/thread-manager'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { THREAD_PLACE_DRIFT_ANSWERS, type ThreadPlaceDriftAnswer, type ThreadPlaceUndoInput } from '../../../shared/types/thread-places'
import { MainRefusal } from '../services/main-refusal'

/**
 * CR-F4-7 (ccr-f4-places-pr.md §Contract, §A14 Undo): ThreadOrchestrator's place calls over IPC. `ipcMain` carries the
 * installed sender guard, so a call from anything but the app's window is refused before it gets here. Every argument
 * is checked before the manager is awaited; a bad one is refused with the C3 `thread.invalidInput`. The manager's
 * answer goes back unchanged. MCP (shared/mcp-coverage.ts): the read models are `excluded` (thread.places); the
 * person-only writes and the place read, which reaches outside the workspace roots, are `forbidden` (thread.place_actions).
 */
const invalid = (): MainRefusal<'thread.invalidInput'> => new MainRefusal('thread.invalidInput', {})

/** An id, place id, path or token: a non-empty string without NUL, at most 64K characters. */
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536 || value.includes('\0')) throw invalid()
  return value
}

/** A plain object with only the named keys. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  if (Object.keys(value).some(key => !keys.includes(key))) throw invalid()
  return value as Record<string, unknown>
}

/** A15: the closed list of answers to a branch drift. */
function driftAnswer(value: unknown): ThreadPlaceDriftAnswer {
  if (typeof value !== 'string' || !(THREAD_PLACE_DRIFT_ANSWERS as readonly string[]).includes(value)) throw invalid()
  return value as ThreadPlaceDriftAnswer
}

/** A14 Undo: one file, or one hunk by its header, with the mtime the diff showed (null when it had none). */
function undoInput(value: unknown): ThreadPlaceUndoInput {
  const input = record(value, ['path', 'hunk', 'seenMtime'])
  const seenMtime = input.seenMtime
  if (seenMtime !== null && (typeof seenMtime !== 'number' || !Number.isFinite(seenMtime))) throw invalid()
  return { path: text(input.path), ...(input.hunk === undefined ? {} : { hunk: text(input.hunk) }), seenMtime }
}

/** A14 Discard: the channel passes `confirmed` as given; main itself refuses an unconfirmed discard. */
function discardInput(value: unknown): { confirmed?: boolean } {
  const input = record(value, ['confirmed'])
  if (input.confirmed === undefined) return {}
  if (typeof input.confirmed !== 'boolean') throw invalid()
  return { confirmed: input.confirmed }
}

/** A16: which turn's cwd the path is read against; absent means the newest turn. Never a folder from the window. */
function resolveAt(value: unknown): { turnId?: string } {
  if (value === undefined) return {}
  const input = record(value, ['turnId'])
  return input.turnId === undefined ? {} : { turnId: text(input.turnId) }
}

export function registerThreadPlacesIpc({ manager }: { manager: Promise<ThreadManager> }): void {
  const channels = IPC_CHANNELS.thread
  ipcMain.handle(channels.places, async (_event, id: unknown) => {
    const threadId = text(id)
    return (await manager).places(threadId)
  })
  ipcMain.handle(channels.placeDiff, async (_event, id: unknown, placeId: unknown) => {
    const args = [text(id), text(placeId)] as const
    return (await manager).placeDiff(...args)
  })
  ipcMain.handle(channels.placeRead, async (_event, id: unknown, placeId: unknown, relativePath: unknown) => {
    const args = [text(id), text(placeId), text(relativePath)] as const
    return (await manager).readPlaceFile(...args)
  })
  ipcMain.handle(channels.resolvePath, async (_event, id: unknown, raw: unknown, at: unknown) => {
    const args = [text(id), text(raw), resolveAt(at)] as const
    return (await manager).resolvePath(...args)
  })
  ipcMain.handle(channels.placeDriftAnswer, async (_event, id: unknown, placeId: unknown, answer: unknown) => {
    const args = [text(id), text(placeId), driftAnswer(answer)] as const
    return (await manager).answerPlaceDrift(...args)
  })
  ipcMain.handle(channels.placeUndo, async (_event, id: unknown, placeId: unknown, input: unknown) => {
    const args = [text(id), text(placeId), undoInput(input)] as const
    return (await manager).placeUndo(...args)
  })
  ipcMain.handle(channels.placeRestore, async (_event, id: unknown, token: unknown) => {
    const args = [text(id), text(token)] as const
    return (await manager).placeRestore(...args)
  })
  ipcMain.handle(channels.placeDiscard, async (_event, id: unknown, placeId: unknown, input: unknown) => {
    const args = [text(id), text(placeId), discardInput(input)] as const
    return (await manager).placeDiscard(...args)
  })
  ipcMain.handle(channels.panes, async (_event, id: unknown) => {
    const threadId = text(id)
    return (await manager).panes(threadId)
  })
  ipcMain.handle(channels.collisions, async (_event, id: unknown) => {
    const threadId = text(id)
    return (await manager).collisions(threadId)
  })
}
