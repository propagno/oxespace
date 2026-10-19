import { History, Redo2 } from 'lucide-react'
import type { ThreadSnapshot } from '../../../shared/types/thread'

/** Turn ids set aside by a pending rewind: the target turn and every turn after it. */
export function supersededTurnIds(snapshot: Pick<ThreadSnapshot, 'thread' | 'turns'>): Set<string> {
  const pending = snapshot.thread.rewind
  const turns = snapshot.turns ?? []
  const index = pending ? turns.findIndex(turn => turn.id === pending.turnId) : -1
  return new Set(index < 0 ? [] : turns.slice(index).map(turn => turn.id))
}

/**
 * A rewind waiting for confirmation, above the composer: what was set aside, that the next message confirms
 * it, and Redo to bring the turns (and restored files) back.
 */
export function ThreadDockRewind({ snapshot, pending, onRedo }: { snapshot: ThreadSnapshot; pending: boolean; onRedo(): void }) {
  const rewind = snapshot.thread.rewind
  if (!rewind) return null
  const turns = rewind.removedTurns
  return <div className="thread-dock-rewind" role="status" data-testid="thread-dock-rewind">
    <History size={14} aria-hidden="true" />
    <span>Rewound {turns} {turns === 1 ? 'turn' : 'turns'}. {turns === 1 ? 'It leaves' : 'They leave'} the conversation when you send your next message.</span>
    <button type="button" disabled={pending} onClick={onRedo}><Redo2 size={13} aria-hidden="true" />Redo</button>
  </div>
}
