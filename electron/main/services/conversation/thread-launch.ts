import type { ThreadEvent } from '../../../../shared/types/thread'

/** Repair older histories whose provider ended a turn without a matching tool result. */
export function settleCompletedHistoryTools(events: ThreadEvent[]): number {
  let turnStart = 0, earliest = events.length
  events.forEach((event, index) => {
    if (event.type === 'message' && event.role === 'user') turnStart = index
    if (event.type !== 'completed') return
    for (let toolIndex = turnStart; toolIndex < index; toolIndex++) {
      const tool = events[toolIndex]
      if (tool.type !== 'tool' || tool.state !== 'running') continue
      tool.state = 'unknown'
      tool.files = tool.files?.map(file => ({ ...file, state: file.state === 'running' ? 'unknown' : file.state }))
      earliest = Math.min(earliest, toolIndex)
    }
    turnStart = index + 1
  })
  return earliest
}

/**
 * Stops sent while a turn is launching. The person sees a turn as working before the agent has it: the checkpoint
 * is being opened, the agent is connecting, or its process is still starting (a resumed session can take many
 * seconds). A Stop sent then found no execution, or an agent process that could not act on it yet, and was lost: the
 * turn ran on (CHAT-2). It is kept here, and the launch applies it the moment the turn can be stopped.
 */
export class LaunchStops {
  private readonly launching = new Set<string>()
  private readonly requested = new Set<string>()

  /** A turn starts launching. A Stop left from an earlier turn does not apply to it. */
  begin(id: string): void {
    this.launching.add(id)
    this.requested.delete(id)
  }

  /** The launch is over: the turn reached the agent, or it failed. True when a Stop was waiting for it. */
  end(id: string): boolean {
    this.launching.delete(id)
    return this.requested.delete(id)
  }

  /** Keeps a Stop for a turn that is launching. False when none is launching: the caller stops the turn itself. */
  request(id: string): boolean {
    if (!this.launching.has(id)) return false
    this.requested.add(id)
    return true
  }

  /** Between two steps of the launch: throws when a Stop is waiting, so the next step does not start. */
  check(id: string): void {
    if (this.requested.has(id)) throw Error('Stopped before the agent started')
  }
}
