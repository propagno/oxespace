import type { ConversationThread, ThreadProvider } from './thread'

/**
 * OXE-170 (OXC-5): a session is one folder (or a worktree of it) plus one agent's main chat, and its parallel chats.
 * Its id is the main chat's id. Read in the main process by electron/main/services/conversation/thread-sessions.ts.
 */
export interface SessionChanges { additions: number; deletions: number }

export interface SessionChatView {
  id: string
  provider: ThreadProvider
  /** True only for the main chat, whose id is the session id. */
  main: boolean
  title: string
  status: ConversationThread['status']
  archived: boolean
  /** Additions and deletions of the completed file changes this chat's tool events carry. */
  changes: SessionChanges
}

export interface SessionView {
  id: string
  workspaceId: string
  projectId: string
  rootPath: string
  title: string
  /** The main chat first, then the parallel chats in the order they were created. */
  chats: SessionChatView[]
  /** The chat the window shows; the main chat until another is opened. */
  openChatId: string
  archived: boolean
  /** The sum of every chat's changes (OXE-170 CA-6). */
  changes: SessionChanges
}
