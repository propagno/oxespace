import { randomUUID } from 'node:crypto'
import type { DiagnosticsMetrics } from '../../../../shared/types/diagnostics'

/**
 * Measurement by subscription (B8.3): a window asks, gets a timer of its own, and the timer ends when it unwatches,
 * closes or navigates (a reload included). Without a subscription there is no timer and nothing is measured.
 */
export interface WatchedSender {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, value: unknown): void
  on(event: 'destroyed' | 'did-start-navigation', listener: (...args: unknown[]) => void): unknown
  removeListener(event: 'destroyed' | 'did-start-navigation', listener: (...args: unknown[]) => void): unknown
}

interface Subscription {
  sender: WatchedSender
  timer: ReturnType<typeof setInterval>
  busy: boolean
  detach: () => void
}

const PER_WINDOW = 4

export class MetricsWatcher {
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(private readonly measure: () => Promise<DiagnosticsMetrics>, private readonly channel: string) {}

  watch(sender: WatchedSender, intervalMs: number): string {
    if ([...this.subscriptions.values()].filter(item => item.sender === sender).length >= PER_WINDOW) throw new Error('Too many diagnostics subscriptions for this window')
    const id = randomUUID()
    const stop = () => this.unwatch(id)
    const navigation = (...args: unknown[]) => {
      // Electron passes the details object first; older positional arguments are (url, isInPlace, isMainFrame).
      const details = (args[0] ?? {}) as { isMainFrame?: boolean; isSameDocument?: boolean }
      const mainFrame = details.isMainFrame ?? args[3] === true
      const sameDocument = details.isSameDocument ?? args[2] === true
      if (mainFrame && !sameDocument) stop()
    }
    sender.on('destroyed', stop)
    sender.on('did-start-navigation', navigation)
    const subscription: Subscription = {
      sender,
      busy: false,
      timer: setInterval(() => void this.tick(id), intervalMs),
      detach: () => { sender.removeListener('destroyed', stop); sender.removeListener('did-start-navigation', navigation) }
    }
    this.subscriptions.set(id, subscription)
    void this.tick(id)
    return id
  }

  /** Only the window that subscribed can end its subscription; an unknown id is ignored. */
  unwatch(id: string, sender?: WatchedSender): void {
    const subscription = this.subscriptions.get(id)
    if (!subscription || (sender && subscription.sender !== sender)) return
    clearInterval(subscription.timer)
    this.subscriptions.delete(id)
    try { if (!subscription.sender.isDestroyed()) subscription.detach() } catch { /* already gone */ }
  }

  stopAll(): void { for (const id of [...this.subscriptions.keys()]) this.unwatch(id) }

  get size(): number { return this.subscriptions.size }

  private async tick(id: string): Promise<void> {
    const subscription = this.subscriptions.get(id)
    if (!subscription || subscription.busy) return
    if (subscription.sender.isDestroyed()) { this.unwatch(id); return }
    subscription.busy = true
    try {
      const metrics = await this.measure()
      if (this.subscriptions.get(id) === subscription && !subscription.sender.isDestroyed()) subscription.sender.send(this.channel, metrics)
    } catch { /* one failed measurement; the next tick tries again */ } finally {
      subscription.busy = false
    }
  }
}
