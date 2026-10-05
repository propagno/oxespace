import type { ThreadSnapshot } from '../../../../shared/types/thread'
import type { NativeStateResult } from './codex-state-reader'

export function hasUnconfirmedTurnTools(snapshot: ThreadSnapshot): boolean {
  const turn = snapshot.turns?.at(-1)
  const start = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === turn?.id)
  return start >= 0 && snapshot.events.slice(start + 1).some(event => event.type === 'tool' && (event.state === 'unknown' || event.state === 'running'))
}

/** Live recovery requires an additional adapter-owned atomic commit. Never edits the queue. */
export function recoverPublicTurn(snapshot: ThreadSnapshot, result: NativeStateResult, confirmedLive = false): ThreadSnapshot | undefined {
  const turn = snapshot.turns?.at(-1)
  if (!turn || !result.nativeTurnId || turn.nativeId !== result.nativeTurnId || !result.recoveredMessages || !['completed', 'failed'].includes(result.state)) return
  if (turn.status === 'completed' && !hasUnconfirmedTurnTools(snapshot) || snapshot.thread.status === 'running' && !confirmedLive || snapshot.thread.status === 'approval' || snapshot.thread.cliActive) return
  const start = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === turn.id)
  if (start < 0) return
  if (snapshot.events.slice(start + 1).some(event => event.type === 'request' && event.request.state === 'pending' || event.type === 'approval' && !snapshot.events.some(resolved => resolved.type === 'approval-resolved' && resolved.id === event.id))) return
  const recovered = structuredClone(snapshot)
  const items = result.recoveredItems ?? result.recoveredMessages
  const byId = new Map(items.map(item => [item.id, item]))
  // An incomplete/provisional journal must not erase or bless an unmatched
  // response that was already delivered through the live transport.
  if (snapshot.events.slice(start + 1).some(event => event.type === 'message' && event.role === 'assistant' && !byId.has(event.id))) return
  // Native IDs, not text hashes: equal text can legitimately occur twice.
  const priorIds = new Set(recovered.events.slice(0, start).filter(event => event.type === 'message' || event.type === 'tool').map(event => event.id))
  if ([...byId.keys()].some(id => priorIds.has(id))) return
  for (const event of snapshot.events.slice(start + 1)) {
    if (event.type !== 'message' && event.type !== 'tool') continue
    const item = byId.get(event.id)
    if (item && (item.type !== event.type || item.type === 'tool' && event.type === 'tool' && item.name !== event.name)) return
    if (item?.type === 'tool' && event.type === 'tool') {
      if (['completed', 'failed'].includes(event.state) && item.state === 'unknown') byId.set(item.id, structuredClone(event))
      else byId.set(item.id, { ...event, ...item })
    }
  }
  let nextMessage = 0
  const emitted = new Set<string>()
  recovered.events = recovered.events.filter((event, index) => {
    if (index <= start) return true
    return event.type !== 'completed' && event.type !== 'failure-details'
  }).flatMap((event, index) => {
    if (index <= start || event.type !== 'tool' && (event.type !== 'message' || event.role !== 'assistant')) return [event]
    const complete = byId.get(event.id)
    if (!complete) return [event]
    if (emitted.has(event.id)) return []
    const ordered = []
    while (nextMessage < items.length) {
      const message = byId.get(items[nextMessage++].id)!
      ordered.push(message); emitted.add(message.id)
      if (message.id === event.id) break
    }
    return ordered
  })
  recovered.events.push(...items.slice(nextMessage).map(item => byId.get(item.id)!), { type: 'completed', status: result.state as 'completed' | 'failed', ...(result.state === 'failed' ? { error: 'The provider confirmed that this turn failed. Its available public response was recovered.' } : {}) })
  for (const event of recovered.events.slice(start + 1)) {
    if (event.type === 'tool' && event.state === 'running') event.state = 'unknown'
    if (event.type === 'tool' || event.type === 'turn-diff') event.files = event.files?.map(file => file.state === 'running' ? { ...file, state: 'unknown' } : file)
  }
  const last = recovered.turns!.at(-1)!
  last.status = result.state as 'completed' | 'failed'
  last.completedAt = result.observedAt
  recovered.thread.status = result.state === 'completed' ? 'idle' : 'failed'
  recovered.thread.lastTurnStatus = last.status
  return recovered
}
