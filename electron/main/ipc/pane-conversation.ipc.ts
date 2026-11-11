import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PaneConversationSource } from '../services/remote/pane-conversation'

export type PaneConversationIpcMain = Pick<IpcMain, 'handle'> & {
  removeHandler?(channel: string): void
}

function parsePaneId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || value.includes('\0') || /[\r\n]/.test(value)) {
    throw new Error('Invalid paneId')
  }
  return value
}

function parsePageInput(value: unknown): { paneId: string; cursor?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid paneConversation.page input')
  }
  const record = value as Record<string, unknown>
  const paneId = parsePaneId(record.paneId)
  if (record.cursor === undefined) return { paneId }
  if (typeof record.cursor !== 'string' || record.cursor.length > 512) {
    throw new Error('Invalid cursor')
  }
  return { paneId, cursor: record.cursor }
}

function senderIdOf(event: IpcMainInvokeEvent | null | undefined): number {
  return typeof event?.sender?.id === 'number' ? event.sender.id : 0
}

/**
 * 1.5.0 F6 A53 / N2: desktop IPC adapter over F10's PaneConversations.
 * Read-only: has, page, watch, unwatch, and the { paneId } push on pane-conversation:changed.
 */
export function registerPaneConversationIpc(
  ipc: PaneConversationIpcMain,
  options: {
    conversations: PaneConversationSource
    push: (senderId: number, payload: { paneId: string }) => void
  }
): () => void {
  const { conversations, push } = options
  const watches = new Map<number, Map<string, () => void>>()
  const trackedSenders = new Set<number>()

  const dropSender = (senderId: number): void => {
    const byPane = watches.get(senderId)
    if (byPane) {
      for (const stop of byPane.values()) stop()
      byPane.clear()
      watches.delete(senderId)
    }
    trackedSenders.delete(senderId)
    conversations.forgetDevice(`desktop:${senderId}`)
  }

  const trackSender = (event: IpcMainInvokeEvent | null | undefined, senderId: number): void => {
    if (trackedSenders.has(senderId)) return
    const sender = event?.sender as { once?: (event: 'destroyed', listener: () => void) => void } | undefined
    if (typeof sender?.once === 'function') {
      trackedSenders.add(senderId)
      sender.once('destroyed', () => dropSender(senderId))
    }
  }

  ipc.handle(IPC_CHANNELS.paneConversation.has, (_event: IpcMainInvokeEvent, rawPaneId: unknown) => {
    return conversations.has(parsePaneId(rawPaneId))
  })

  ipc.handle(IPC_CHANNELS.paneConversation.page, (event: IpcMainInvokeEvent, rawInput: unknown) => {
    const input = parsePageInput(rawInput)
    const senderId = senderIdOf(event)
    trackSender(event, senderId)
    return conversations.page(`desktop:${senderId}`, input)
  })

  ipc.handle(IPC_CHANNELS.paneConversation.watch, (event: IpcMainInvokeEvent, rawPaneId: unknown) => {
    const paneId = parsePaneId(rawPaneId)
    const senderId = senderIdOf(event)
    trackSender(event, senderId)
    let byPane = watches.get(senderId)
    if (!byPane) {
      byPane = new Map()
      watches.set(senderId, byPane)
    }
    if (!byPane.has(paneId)) {
      const stop = conversations.subscribe(paneId, () => {
        push(senderId, { paneId })
      })
      byPane.set(paneId, stop)
    }
  })

  ipc.handle(IPC_CHANNELS.paneConversation.unwatch, (event: IpcMainInvokeEvent, rawPaneId: unknown) => {
    const paneId = parsePaneId(rawPaneId)
    const senderId = senderIdOf(event)
    const byPane = watches.get(senderId)
    const stop = byPane?.get(paneId)
    if (stop) {
      byPane!.delete(paneId)
      if (byPane!.size === 0) watches.delete(senderId)
      stop()
    }
  })

  return () => {
    for (const senderId of [...watches.keys()]) {
      dropSender(senderId)
    }
    for (const channel of [
      IPC_CHANNELS.paneConversation.has,
      IPC_CHANNELS.paneConversation.page,
      IPC_CHANNELS.paneConversation.watch,
      IPC_CHANNELS.paneConversation.unwatch
    ]) {
      ipc.removeHandler?.(channel)
    }
  }
}
