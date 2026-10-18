import type { ThreadEvent, ThreadSnapshot, ThreadTurn } from '../../../../shared/types/thread'

export type ThreadRewindFailure =
  | 'unsupported'        // the provider has no verified way to rewind
  | 'unavailable'        // not connected, busy, or the turn has no native identity
  | 'history-limit'      // provider history is longer than we are willing to prove
  | 'provider-refused'   // the provider rejected the request; nothing changed
  | 'proof-mismatch'     // the provider answered, but its history is not what we expected

export class ThreadRewindError extends Error {
  constructor(readonly code: ThreadRewindFailure, message: string) { super(message) }
}

const MAX_PAGES = 100

/** Reads every turn id in provider order. A repeated cursor or an endless history aborts. */
export async function readAllTurnIds(page: (cursor: string | null) => Promise<{ ids: string[]; next: string | null }>): Promise<string[]> {
  const ids: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let index = 0; index < MAX_PAGES; index++) {
    const result = await page(cursor)
    ids.push(...result.ids)
    if (!result.next) return ids
    if (seen.has(result.next)) throw new ThreadRewindError('proof-mismatch', 'The provider repeated a history cursor.')
    seen.add(result.next)
    cursor = result.next
  }
  throw new ThreadRewindError('history-limit', 'The provider history is too long to verify.')
}

/** The provider must now hold exactly the turns that preceded the target. */
export function verifyRevert(before: string[], after: string[], target: string): void {
  const position = before.indexOf(target)
  if (position < 0) throw new ThreadRewindError('unavailable', 'The provider no longer has that turn.')
  const expected = before.slice(0, position)
  if (after.length !== expected.length || after.some((id, index) => id !== expected[index])) {
    throw new ThreadRewindError('proof-mismatch', 'The provider history does not match the rewound conversation. Nothing was changed here.')
  }
}

export interface LocalRewind {
  /** Events kept: everything before the user message that opened the target turn. */
  events: ThreadEvent[]
  turns: ThreadTurn[]
  dropped: ThreadTurn[]
}

/** Pure local truncation; the caller persists it only after the provider is proven. */
export function planLocalRewind(snapshot: Pick<ThreadSnapshot, 'events' | 'turns'>, turnId: string): LocalRewind {
  const turns = snapshot.turns ?? []
  const index = turns.findIndex(turn => turn.id === turnId)
  if (index < 0) throw new ThreadRewindError('unavailable', 'That turn is not part of this conversation.')
  const cut = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  if (cut < 0) throw new ThreadRewindError('unavailable', 'That turn has no recorded message to rewind to.')
  return { events: snapshot.events.slice(0, cut), turns: turns.slice(0, index), dropped: turns.slice(index) }
}
