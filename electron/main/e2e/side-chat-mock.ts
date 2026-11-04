import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent, IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { mainMessage } from '../../../shared/messages'
import type { AgentConversationAdapter, ConversationThread, ThreadConfiguration, ThreadEvent, ThreadRequestResponse, ThreadSideOpenResult } from '../../../shared/types/thread'
import { ThreadSideChats } from '../services/conversation/thread-side-chat'

/** What a spec reads back through app.evaluate: the configuration each copy started with, and every answer it got. */
export interface E2eSideChatLog { starts: ThreadConfiguration[]; responses: { id: string; tool: string; response: ThreadRequestResponse }[] }

/**
 * B1.2 double: the real side chat service (configuration, forwarding, declining) over a provider stand-in that
 * answers each message with a fixed reply. A message that asks for a change makes the stand-in request Edit, Write
 * and Bash first, as a provider would; the service must decline each one and show none (T59).
 */
export function registerE2eSideChat(ipcMain: IpcMain): void {
  const log: E2eSideChatLog = { starts: [], responses: [] }
  ;(globalThis as typeof globalThis & { __e2eSideChat?: E2eSideChatLog }).__e2eSideChat = log
  const threads = new Map<string, ConversationThread>()
  // Specs read how many copies main still holds (T60: hiding keeps the copy, discarding drops it).
  const sides = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).__oxeSideChats = sides
  const chats = new ThreadSideChats({
    readThread: id => {
      const thread = threads.get(id)
      if (!thread) throw Error('Thread not found')
      return thread
    },
    subscribe: () => () => {},
    connect: async () => adapter(log),
    unavailable: () => false,
    discard: async () => {}
  })
  ipcMain.handle(IPC_CHANNELS.thread.sideOpen, async (event: IpcMainInvokeEvent, id: unknown): Promise<ThreadSideOpenResult> => {
    if (typeof id !== 'string' || !id) throw new Error('thread.invalidInput')
    if (process.env.OXESPACE_E2E_SIDE_UNAVAILABLE === '1') return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
    threads.set(id, { id, provider: 'claude', rootPath: '', workspaceId: 'thread:e2e', nativeSessionId: randomUUID(), status: 'idle', generation: 1, title: 'E2E', createdAt: 1, updatedAt: 1 } as ConversationThread)
    const result = await chats.open(id, sideEvent => { if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.thread.onSideEvent, sideEvent) })
    if (result.ok) sides.set(result.side.sideId, id)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.thread.sideSend, (_event: IpcMainInvokeEvent, sideId: unknown, text: unknown) => chats.send(sideId, text))
  ipcMain.handle(IPC_CHANNELS.thread.sideClose, async (_event: IpcMainInvokeEvent, sideId: unknown) => {
    await chats.close(sideId)
    if (typeof sideId === 'string') sides.delete(sideId)
  })
}

const CHANGE = /\b(fix|edit|write|change|run)\b/i
const TOOLS = ['Edit', 'Write', 'Bash'] as const

function adapter(log: E2eSideChatLog): AgentConversationAdapter {
  let emit: (event: ThreadEvent) => void = () => {}
  const asked = new Map<string, string>()
  const respond = async (id: string, response: ThreadRequestResponse) => {
    const tool = asked.get(id)
    if (!tool) throw Error('Request is no longer pending')
    asked.delete(id)
    log.responses.push({ id, tool, response })
  }
  return {
    capabilities: {},
    start: async (context, listener) => { log.starts.push({ ...context } as ThreadConfiguration); emit = listener },
    send: async text => {
      if (CHANGE.test(text)) {
        for (const tool of TOOLS) {
          const id = randomUUID()
          asked.set(id, tool)
          emit({ type: 'request', id, request: { id, kind: 'approval', title: `Allow ${tool}?`, generation: 0, createdAt: Date.now(), state: 'pending', toolName: tool } } as ThreadEvent)
          emit({ type: 'approval', id, title: `Allow ${tool}?` } as ThreadEvent)
        }
      }
      emit({ type: 'message', id: randomUUID(), role: 'assistant', text: 'E2E side chat reply.' })
    },
    interrupt: async () => {},
    approve: async (id, decision) => respond(id, { decision }),
    respondRequest: respond,
    dispose: async () => {}
  } as AgentConversationAdapter
}
