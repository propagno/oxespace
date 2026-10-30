import type { ThreadSnapshot } from '../../../../shared/types/thread'

/** Idle conversations kept parsed in memory. A long conversation is tens of megabytes, so only the latest stays. */
const MAX_IDLE = 1
/** How long an idle conversation stays parsed after its last read. The next read loads it from the database. */
const IDLE_TTL_MS = 30_000

/**
 * Full histories held for main-process work. Conversations with work in flight (`held`) keep theirs; the
 * others are dropped beyond the most recent one and after a short idle time, so a conversation nobody is
 * reading stops costing memory.
 */
export class ThreadSnapshotCache extends Map<string, ThreadSnapshot> {
  private readonly usedAt = new Map<string, number>()
  private sweep: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly held: (id: string) => boolean) { super() }

  /** Marks a conversation as just read and moves it to the most recently used position. */
  touch(id: string): void {
    const snapshot = this.get(id)
    if (!snapshot) return
    super.delete(id); super.set(id, snapshot)
    this.usedAt.set(id, Date.now())
  }

  trim(): void {
    const now = Date.now()
    let idle = 0
    for (const id of [...this.keys()].reverse()) {
      if (this.held(id)) continue
      const usedAt = this.usedAt.get(id) ?? now
      this.usedAt.set(id, usedAt)
      if (++idle > MAX_IDLE || now - usedAt > IDLE_TTL_MS) this.delete(id)
    }
    if (this.size && !this.sweep) {
      this.sweep = setTimeout(() => { this.sweep = undefined; this.trim() }, IDLE_TTL_MS)
      this.sweep.unref?.()
    }
  }

  override delete(id: string): boolean {
    this.usedAt.delete(id)
    return super.delete(id)
  }

  close(): void {
    clearTimeout(this.sweep); this.sweep = undefined
  }
}
