import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { REMOTE_LIMITS } from '../../../../shared/remote/protocol'
import type { RemotePairingPrompt } from '../../../../shared/types/remote'

/**
 * The pairing state of the desktop: at most one code on screen, the codes already spent, the attempts per address,
 * and at most one "Pair <phone>?" question waiting for the person.
 *
 * A code is good for one attempt, whatever its outcome. A wrong code (`pairing-invalid`) does not spend the one on screen (anyone on the
 * LAN could otherwise keep the person from pairing); it counts towards that address's attempt limit instead, and
 * 128 random bits leave nothing to guess.
 */

export const PAIRING_PROMPT_TIMEOUT_MS = 60_000
const MAX_TRACKED_ADDRESSES = 1024

export type ClaimResult = 'ok' | 'pairing-expired' | 'pairing-used' | 'pairing-invalid'

interface Prompt {
  prompt: RemotePairingPrompt
  settle(accept: boolean): void
  timer: ReturnType<typeof setTimeout>
}

const digest = (code: string): Buffer => createHash('sha256').update(code, 'utf8').digest()

export class PairingDesk {
  private offer: { hash: Buffer; expiresAt: number } | null = null
  private spent: Array<{ hash: Buffer; expiresAt: number }> = []
  private attempts = new Map<string, number[]>()
  private waiting: Prompt | null = null

  constructor(
    private readonly now: () => number = Date.now,
    private readonly promptTimeoutMs = PAIRING_PROMPT_TIMEOUT_MS,
    private readonly onPrompt: (prompt: RemotePairingPrompt | null) => void = () => {}
  ) {}

  /** A new code replaces the one on screen. The code itself is returned once and only its hash is kept. */
  start(): { code: string; expiresAt: number } {
    const code = randomBytes(16).toString('base64url')
    const expiresAt = this.now() + REMOTE_LIMITS.pairingCodeTtlMs
    this.offer = { hash: digest(code), expiresAt }
    return { code, expiresAt }
  }

  hasOffer(): boolean {
    return !!this.offer && this.offer.expiresAt > this.now()
  }

  /** Invalidates the code on screen and refuses the question waiting, if any. True when something was cancelled. */
  cancel(): boolean {
    const had = !!this.offer || !!this.waiting
    this.offer = null
    this.settle(false)
    return had
  }

  /** Forgets everything: the gateway was switched off. */
  reset(): void {
    this.cancel()
    this.spent = []
    this.attempts.clear()
  }

  /** Records an attempt from `address`; false once the address used up its attempts in the window. */
  attempt(address: string): boolean {
    const now = this.now(), since = now - REMOTE_LIMITS.pairingAttemptWindowMs
    const recent = (this.attempts.get(address) ?? []).filter(at => at > since)
    if (recent.length >= REMOTE_LIMITS.pairingAttemptsPerWindow) { this.attempts.set(address, recent); return false }
    recent.push(now)
    this.attempts.delete(address)
    this.attempts.set(address, recent)
    if (this.attempts.size > MAX_TRACKED_ADDRESSES) {
      for (const [key, times] of this.attempts) if (!times.some(at => at > since)) this.attempts.delete(key)
      while (this.attempts.size > MAX_TRACKED_ADDRESSES) this.attempts.delete(this.attempts.keys().next().value as string)
    }
    return true
  }

  /** Spends the code on screen when `code` is it. Compared as SHA-256 digests in constant time. */
  claim(code: string): ClaimResult {
    const now = this.now(), hash = digest(code)
    this.spent = this.spent.filter(entry => entry.expiresAt > now)
    if (this.spent.some(entry => timingSafeEqual(entry.hash, hash))) return 'pairing-used'
    const offer = this.offer
    // No code on screen, or not this one (cancelled, replaced, mistyped): it matches no offer.
    if (!offer || !timingSafeEqual(offer.hash, hash)) return 'pairing-invalid'
    this.offer = null
    if (offer.expiresAt <= now) return 'pairing-expired'
    this.spent.push({ hash, expiresAt: offer.expiresAt })
    return 'ok'
  }

  /** Asks the person; resolves true only on their explicit accept. A second question while one waits is refused. */
  ask(deviceName: string, verification: string): { promptId: string; answer: Promise<boolean> } | null {
    if (this.waiting) return null
    const promptId = randomUUID()
    const prompt: RemotePairingPrompt = { promptId, deviceName, verification, expiresAt: this.now() + this.promptTimeoutMs }
    let settle!: (accept: boolean) => void
    const answer = new Promise<boolean>(resolve => { settle = resolve })
    const timer = setTimeout(() => this.settle(false, promptId), this.promptTimeoutMs)
    timer.unref?.()
    this.waiting = { prompt, settle, timer }
    this.onPrompt(prompt)
    return { promptId, answer }
  }

  current(): RemotePairingPrompt | null {
    return this.waiting?.prompt ?? null
  }

  /** The person's answer, from the app's window. Throws for anything but the question on screen. */
  answer(promptId: string, accept: boolean): void {
    if (!this.waiting || this.waiting.prompt.promptId !== promptId) throw new Error('No such pairing request')
    this.settle(accept, promptId)
  }

  /** Refuses the question (the phone went away, it timed out, it was cancelled). */
  settle(accept: boolean, promptId?: string): void {
    const waiting = this.waiting
    if (!waiting || (promptId !== undefined && waiting.prompt.promptId !== promptId)) return
    this.waiting = null
    clearTimeout(waiting.timer)
    waiting.settle(accept)
    this.onPrompt(null)
  }
}
