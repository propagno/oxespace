import type { TerminalSizeLease, TerminalSizeLeaseEvent } from '../../../../shared/types/ipc'

/** How long a phone's hold on a terminal's size lasts without being renewed. */
export const SIZE_LEASE_MS = 120_000

interface Lease { holder: string; desktop: { cols: number; rows: number }; cols: number; rows: number; expiresAt: number; timer: ReturnType<typeof setTimeout> }

/** What the holds need from the terminals: a pane's size now, a way to set it, and where to say a hold changed. */
export interface SizeLeaseHost {
  size(paneId: string): { cols: number; rows: number } | null
  apply(paneId: string, cols: number, rows: number): void
  emit(event: TerminalSizeLeaseEvent): void
}

/**
 * 1.5.0 · A phone that has a terminal open sizes it for its own screen, so a full-screen CLI draws for the phone
 * instead of the phone panning over the desktop's grid. One holder per pane; the desktop's size is kept and put back
 * when the holder lets go, disconnects, or stops renewing (`SIZE_LEASE_MS`). The desktop can take the size back.
 */
export class SizeLeases {
  private readonly leases = new Map<string, Lease>()
  /** Panes whose size the person took back, and from whom: that holder is refused until it lets go or disconnects. */
  private readonly takenBack = new Map<string, string>()

  constructor(private readonly host: SizeLeaseHost) {}

  /** While a phone holds the size, the desktop's own fit is remembered for when the phone lets go. True when held. */
  rememberDesktop(paneId: string, cols: number, rows: number): boolean {
    const lease = this.live(paneId)
    if (lease) lease.desktop = { cols, rows }
    return lease !== null
  }

  lease(paneId: string, holder: string, cols: number, rows: number): 'held' | 'no-terminal' | 'taken-back' {
    const size = this.host.size(paneId)
    if (!size) return 'no-terminal'
    if (this.takenBack.get(paneId) === holder) return 'taken-back'
    const current = this.live(paneId)
    const desktop = current?.desktop ?? size
    if (current) clearTimeout(current.timer)
    // The timer ends a hold nobody renews even when nothing else reads the pane (the phone lost its network).
    const timer = setTimeout(() => { if (this.leases.get(paneId)?.timer === timer) this.release(paneId) }, SIZE_LEASE_MS)
    timer.unref?.()
    this.leases.set(paneId, { holder, desktop, cols, rows, expiresAt: Date.now() + SIZE_LEASE_MS, timer })
    const changed = !current || current.cols !== cols || current.rows !== rows
    if (changed) { this.host.apply(paneId, cols, rows); this.host.emit({ paneId, lease: { cols, rows } }) }
    return 'held'
  }

  /** Puts the desktop's size back. With `holder`, only that holder's lease is released. */
  release(paneId: string, holder?: string): boolean {
    // Letting go also ends a "taken back": the next time this phone opens the terminal it may size it again.
    if (holder !== undefined && this.takenBack.get(paneId) === holder) this.takenBack.delete(paneId)
    const lease = this.leases.get(paneId)
    if (!lease || (holder !== undefined && lease.holder !== holder)) return false
    clearTimeout(lease.timer)
    this.leases.delete(paneId)
    if (this.host.size(paneId)) this.host.apply(paneId, lease.desktop.cols, lease.desktop.rows)
    this.host.emit({ paneId, lease: null })
    return true
  }

  releaseOf(holder: string): void {
    for (const [paneId, taken] of [...this.takenBack]) if (taken === holder) this.takenBack.delete(paneId)
    for (const [paneId, lease] of [...this.leases]) if (lease.holder === holder) this.release(paneId)
  }

  /** The person takes the pane's size back on the desktop; the phone that held it is refused until it lets go. */
  takeBack(paneId: string): boolean {
    const lease = this.live(paneId)
    if (!lease) return false
    this.takenBack.set(paneId, lease.holder)
    return this.release(paneId)
  }

  /** The size a phone holds for this pane right now, or null. */
  get(paneId: string): TerminalSizeLease | null {
    const lease = this.live(paneId)
    return lease ? { cols: lease.cols, rows: lease.rows } : null
  }

  /** The pane's process is gone: nothing is left to size, and the next process starts at the desktop's size. */
  forget(paneId: string): void {
    this.takenBack.delete(paneId)
    const lease = this.leases.get(paneId)
    if (!lease) return
    clearTimeout(lease.timer)
    this.leases.delete(paneId)
    this.host.emit({ paneId, lease: null })
  }

  /** A lease that stopped being renewed is over: the desktop's size goes back before anything else reads it. */
  private live(paneId: string): Lease | null {
    const lease = this.leases.get(paneId)
    if (!lease) return null
    if (lease.expiresAt > Date.now()) return lease
    this.release(paneId)
    return null
  }
}
