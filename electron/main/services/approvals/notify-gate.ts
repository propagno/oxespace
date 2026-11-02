/**
 * B10 · What an agent may put in a desktop notification: no name only the app uses, and at most NOTIFY_PER_MINUTE per
 * execution. The title the person sees is prefixed by the app with who sent it (drafts.ts `noticeTitle`).
 */
import { reservedNameIn } from '../../../../shared/approval-rules'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { NOTIFY_PER_MINUTE } from '../../../../shared/types/approvals'

export class NotifyGate {
  private readonly sent = new Map<string, number[]>()

  constructor(private readonly now: () => number = Date.now, private readonly perMinute = NOTIFY_PER_MINUTE) {}

  /** The refusal, or null when the notice may go out (and is then counted). */
  check(executionKey: string, title: string, body: string): MainMessage | null {
    // A notice may not speak as the system anywhere in its text, not only in its first word ("Important: System notice").
    const reserved = reservedNameIn(title, 'notice') ?? reservedNameIn(body, 'notice')
    if (reserved) return mainMessage('notify.refused.reservedName', { name: reserved })
    const now = this.now()
    for (const [key, times] of this.sent) if (!times.some(at => now - at < 60_000)) this.sent.delete(key)
    const recent = (this.sent.get(executionKey) ?? []).filter(at => now - at < 60_000)
    if (recent.length >= this.perMinute) return mainMessage('notify.refused.rateLimit', { perMinute: this.perMinute })
    recent.push(now)
    this.sent.set(executionKey, recent)
    return null
  }
}
