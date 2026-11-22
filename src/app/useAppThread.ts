import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ThreadSnapshot } from '../../shared/types/thread'
import { useThreadStore } from '../store/thread.store'

type ShownThread = ThreadSnapshot['thread']

/** The shown conversation's fields the window reads; the rest of the snapshot (its events) stays with ThreadView. */
export interface AppThread {
  id: string
  projectId: string
  workspaceId: string
  rootPath: string
  provider: ShownThread['provider']
  mcpServers: ShownThread['mcpServers']
}

/**
 * The shown conversation for App, read field by field (OXE-348 A8): a streaming chunk changes only the snapshot's events
 * and updatedAt, so the component that calls this does not re-render on it. Null without a conversation.
 */
export function useAppThread(): AppThread | null {
  return useThreadStore(useShallow(state => {
    const thread = state.snapshot?.thread
    return thread ? { id: thread.id, projectId: thread.projectId, workspaceId: thread.workspaceId, rootPath: thread.rootPath, provider: thread.provider, mcpServers: thread.mcpServers } : null
  }))
}

/**
 * The snapshot the palette's conversation commands read (running / finished turn, the last turn to undo). It changes only
 * when the conversation or its turns change, not on each streaming chunk, so App does not re-render while a turn streams.
 */
export function useCommandSnapshot(): ThreadSnapshot | null {
  const held = useRef<{ key: string; snapshot: ThreadSnapshot | null }>({ key: 'none', snapshot: null })
  return useThreadStore(state => {
    const snapshot = state.snapshot
    const key = snapshot ? `${snapshot.thread.id}|${(snapshot.turns ?? []).map(turn => `${turn.id}:${turn.status}`).join(',')}` : 'none'
    if (key !== held.current.key) held.current = { key, snapshot }
    return held.current.snapshot
  })
}
