import type { ThreadProvider, ThreadSnapshot } from '../../../../shared/types/thread'
import type { SessionView } from '../../../../shared/types/thread-session'
import { ThreadOrchestrator } from './thread-orchestrator'
import { createChat, listSessions, openChat, readSession } from './thread-sessions'

/**
 * Stable public boundary for Thread IPC/runtime consumers. Runtime coordination
 * lives in ThreadOrchestrator; persistence, requests, sessions, exports,
 * portable packages and checkpoints are separate services behind it.
 */
export class ThreadManager extends ThreadOrchestrator {
  /** CR-F4-7b: a place added, or a drift seen or answered, per conversation; '*' hears every one (see ThreadPlaceObserver). */
  subscribePlaces = (id: string, listener: (id: string) => void): (() => void) => this.placeObserver.subscribePlaces(id, listener)
  /** OXE-170: the session led by this main chat, with its parallel chats (thread-sessions.ts). */
  readSession(sessionId: string): SessionView { return readSession(this.sessionHost(), sessionId) }
  /** OXE-170: every session once, archived ones too; never a parallel chat. */
  listSessions(): SessionView[] { return listSessions(this.sessionHost()) }
  /** OXE-170: a parallel chat in the session's folder or worktree; it connects on its first message. */
  createChat(sessionId: string, input: { provider: ThreadProvider }): ThreadSnapshot { return createChat(this.sessionHost(), sessionId, input) }
  /** OXE-170: records the chat the window shows. */
  openChat(sessionId: string, chatId: string): SessionView { return openChat(this.sessionHost(), sessionId, chatId) }
}
