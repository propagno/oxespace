import { randomUUID } from 'node:crypto'

export type PickedKind = 'ca' | 'cert' | 'key' | 'sshKey'

interface Entry { kind: PickedKind; name: string; content: string; expires: number }

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 16

/**
 * Files the user chose in a native dialog. The renderer only ever receives an
 * opaque handle and the file name; the content (a private key, say) is read by
 * the main process and consumed when the connection is saved.
 */
export class PickedFiles {
  private readonly entries = new Map<string, Entry>()

  register(kind: PickedKind, name: string, content: string, now = Date.now()): string {
    this.sweep(now)
    while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string)
    const handle = randomUUID()
    this.entries.set(handle, { kind, name, content, expires: now + TTL_MS })
    return handle
  }

  /** Returns the file once; a handle cannot be replayed or used for another kind. */
  take(handle: string, kind: PickedKind, now = Date.now()): { name: string; content: string } | null {
    const entry = this.entries.get(handle)
    this.entries.delete(handle)
    if (!entry || entry.kind !== kind || entry.expires < now) return null
    return { name: entry.name, content: entry.content }
  }

  private sweep(now: number): void {
    for (const [handle, entry] of this.entries) if (entry.expires < now) this.entries.delete(handle)
  }
}

const PEM = /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/

/** Rejects anything that is not a PEM block, so a stray file is not stored as a certificate. */
export function assertPem(text: string, label: string): string {
  const value = text.trim()
  if (/^PuTTY-User-Key-File-/.test(value)) throw new Error(`${label} is a PuTTY (.ppk) key. Convert it to OpenSSH first: puttygen key.ppk -O private-openssh -o key.pem`)
  if (!PEM.test(value)) throw new Error(`${label} is not a PEM file.`)
  if (value.length > 64 * 1024) throw new Error(`${label} is too large.`)
  return value
}
