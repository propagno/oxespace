import type { WebContents } from 'electron'
import { mainMessage } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'

export interface DebuggerTarget {
  attach(protocolVersion?: string): void
  detach(): void
  isAttached(): boolean
  sendCommand<T = unknown>(method: string, commandParams?: Record<string, unknown>, sessionId?: string): Promise<T>
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface DebuggerBrokerState {
  attached: boolean
  devToolsOpen: boolean
  users: string[]
}

export interface DebuggerBrokerOptions {
  devToolsOpen: () => boolean
  onChange?: (state: DebuggerBrokerState) => void
}

export interface DebuggerLease {
  release(): void
}

interface LeaseEntry {
  owner: string
  active: boolean
}

export class DebuggerBroker {
  private readonly leases = new Set<LeaseEntry>()
  private readonly listeners = new Set<(state: DebuggerBrokerState) => void>()

  constructor(
    private readonly dbg: DebuggerTarget,
    private readonly options: DebuggerBrokerOptions
  ) {
    if (options.onChange) this.listeners.add(options.onChange)
    this.dbg.on('detach', () => {
      if (this.leases.size === 0) return
      for (const entry of this.leases) entry.active = false
      this.leases.clear()
      this.notify()
    })
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const next = this.state()
    for (const listener of this.listeners) listener(next)
  }

  onStateChange(listener: (state: DebuggerBrokerState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  onMessage(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    const handler = (_event: unknown, method: unknown, params: unknown): void => {
      if (typeof method === 'string') listener(method, (params && typeof params === 'object' ? params : {}) as Record<string, unknown>)
    }
    this.dbg.on('message', handler)
    return () => { this.dbg.removeListener('message', handler) }
  }

  acquire(owner: string): DebuggerLease {
    if (this.leases.size === 0) {
      try {
        this.dbg.attach('1.3')
      } catch {
        throw new MainMessageError(mainMessage('preview.capture.busy', {}), 'Another debugger is attached to this page.')
      }
    }
    const entry: LeaseEntry = { owner, active: true }
    this.leases.add(entry)
    this.notify()
    return {
      release: () => {
        if (!entry.active) return
        entry.active = false
        this.leases.delete(entry)
        if (this.leases.size === 0 && this.dbg.isAttached()) {
          try {
            this.dbg.detach()
          } catch {
            // Already detached externally.
          }
        }
        this.notify()
      }
    }
  }

  state(): DebuggerBrokerState {
    const attached = this.leases.size > 0 && this.dbg.isAttached()
    const users = [...new Set([...this.leases].map(entry => entry.owner))].sort()
    return {
      attached,
      devToolsOpen: this.options.devToolsOpen(),
      users
    }
  }

  async sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.dbg.sendCommand<T>(method, params)
  }

  async capture(params: Record<string, unknown> = { format: 'png' }): Promise<{ data: string }> {
    if (this.options.devToolsOpen()) {
      throw new MainMessageError(mainMessage('preview.capture.devtools', {}), "Close the browser's DevTools to let the agent capture.")
    }
    const lease = this.acquire('capture')
    try {
      return await this.dbg.sendCommand<{ data: string }>('Page.captureScreenshot', params)
    } finally {
      lease.release()
    }
  }
}

const guestBrokers = new WeakMap<WebContents, DebuggerBroker>()

export function brokerForGuest(guest: WebContents): DebuggerBroker {
  let broker = guestBrokers.get(guest)
  if (!broker) {
    broker = new DebuggerBroker(guest.debugger as unknown as DebuggerTarget, {
      devToolsOpen: () => !guest.isDestroyed() && typeof guest.isDevToolsOpened === 'function' && guest.isDevToolsOpened()
    })
    guestBrokers.set(guest, broker)
  }
  return broker
}
