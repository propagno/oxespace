import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ThreadProvider, ThreadSnapshot } from '../../../shared/types/thread'
import type { SessionView } from '../../../shared/types/thread-session'
import type { ThreadManager } from '../services/conversation/thread-manager'
import { createChat, type SessionHost } from '../services/conversation/thread-sessions'
import { MainRefusal } from '../services/main-refusal'

interface Deps {
  manager: Promise<ThreadManager>
}

const PROVIDERS: readonly ThreadProvider[] = ['claude', 'codex', 'antigravity']

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) throw new MainRefusal('thread.invalidInput', {})
  return value
}

function chatInput(value: unknown): { provider: ThreadProvider } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MainRefusal('thread.invalidInput', {})
  const provider = (value as Record<string, unknown>).provider
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider as ThreadProvider)) throw new MainRefusal('thread.invalidInput', {})
  return { provider: provider as ThreadProvider }
}

/**
 * OXE-170 (OXC-5) · Sessions and their parallel chats, for the person's window only: the central sender guard (B12)
 * refuses every other sender and no MCP tool reaches them (shared/mcp-coverage.ts `thread.sessions`). Creating a chat
 * never touches the checkout: the chat runs in the session's own folder or worktree and starts no process.
 */
export function registerThreadSessionsIpc({ manager }: Deps): void {
  ipcMain.handle(IPC_CHANNELS.thread.sessions, async (): Promise<SessionView[]> => (await manager).listSessions())
  ipcMain.handle(IPC_CHANNELS.thread.session, async (_event, id: unknown): Promise<SessionView> => {
    const value = sessionId(id)
    return (await manager).readSession(value)
  })
  ipcMain.handle(IPC_CHANNELS.thread.createChat, async (_event, id: unknown, input: unknown): Promise<ThreadSnapshot> => {
    // Validated before the store is touched.
    const value = sessionId(id), parsed = chatInput(input)
    const service = await manager
    // A parallel chat the person creates starts with the access chosen in Settings › Agents (user decision 12/11).
    const access = service.newConversationAccess()
    const host = (service as unknown as { sessionHost(): SessionHost }).sessionHost()
    return createChat({ ...host, create: context => host.create({ ...context, access }) }, value, parsed)
  })
  ipcMain.handle(IPC_CHANNELS.thread.openChat, async (_event, id: unknown, chatId: unknown): Promise<SessionView> => {
    const value = sessionId(id), chat = sessionId(chatId)
    return (await manager).openChat(value, chat)
  })
}
