import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import net from 'node:net'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { RemoteGateway, type RemoteGatewayDeps } from '../../electron/main/services/remote/gateway'
import { readPairingUri, refreshSigningInput, type RemotePairingQr } from '../../shared/remote/protocol'
import type { RemoteChange, RemotePairingPrompt } from '../../shared/types/remote'
import { request, type HttpResult, type Target } from './remote-client'

/** `safeStorage` stand-in that really transforms the bytes, so a test can tell ciphertext from plaintext. */
export function fakeSafeStorage(available = true) {
  const flip = (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0x5a))
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.concat([Buffer.from('ENC1'), flip(Buffer.from(value, 'utf8'))]),
    decryptString: (value: Buffer) => {
      if (!value.subarray(0, 4).equals(Buffer.from('ENC1'))) throw new Error('not ours')
      return flip(value.subarray(4)).toString('utf8')
    },
    getSelectedStorageBackend: () => 'gnome_libsecret'
  }
}

export const LOOPBACK = { lo: [{ address: '127.0.0.1', family: 'IPv4' as const, internal: true, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: '127.0.0.1/8' }] }

export async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise(resolve => server.close(resolve))
  return port
}

/** Resolves true when something accepts a TCP connection there. */
export function tcpOpen(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

export interface Phone { keys: { publicKey: KeyObject; privateKey: KeyObject }; publicKey: string; spki: Buffer }

export function newPhone(): Phone {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = keys.publicKey.export({ format: 'der', type: 'spki' })
  return { keys, spki, publicKey: spki.toString('base64url') }
}

export function signRefresh(phone: Phone, fp: string, deviceId: string, nonce: string): string {
  return sign('sha256', Buffer.from(refreshSigningInput(fp, deviceId, nonce)), phone.keys.privateKey).toString('base64url')
}

export class Harness {
  readonly db: AppDatabase
  readonly changes: RemoteChange[] = []
  gateway: RemoteGateway
  clock = Date.now()
  port = 0
  private listeners: Array<(change: RemoteChange) => void> = []

  constructor(readonly overrides: Partial<RemoteGatewayDeps> = {}, db?: AppDatabase) {
    this.db = db ?? openInMemoryDatabase()
    this.gateway = this.create()
  }

  create(overrides: Partial<RemoteGatewayDeps> = {}): RemoteGateway {
    return new RemoteGateway({
      db: this.db, storage: fakeSafeStorage(), now: () => this.clock, interfaces: () => LOOPBACK, isAllowedAddress: address => address === '127.0.0.1',
      promptTimeoutMs: 5_000, platform: 'win32',
      broadcast: change => { this.changes.push(change); for (const listener of [...this.listeners]) listener(change) },
      ...this.overrides, ...overrides
    })
  }

  async enable(): Promise<Target> {
    this.port = this.port || await freePort()
    const status = await this.gateway.setEnabled({ enabled: true, port: this.port })
    if (!status.enabled) throw new Error(`gateway did not start: ${JSON.stringify(status.error)}`)
    return { host: '127.0.0.1', port: this.port, fp: status.fingerprint! }
  }

  offer(): RemotePairingQr {
    const read = readPairingUri(this.gateway.startPairing().uri)
    if (!read.ok) throw new Error('bad pairing URI')
    return read.qr
  }

  /** The next pairing prompt broadcast to the window; `stop` drops the wait. */
  nextPrompt(timeoutMs = 3000): Promise<RemotePairingPrompt> & { stop(): void } {
    let stop = () => {}
    const promise = new Promise<RemotePairingPrompt>((resolve, reject) => {
      const listener = (change: RemoteChange) => {
        if (!change.pairing) return
        stop()
        resolve(change.pairing)
      }
      const timer = setTimeout(() => { stop(); reject(new Error('no prompt')) }, timeoutMs)
      stop = () => { clearTimeout(timer); this.listeners = this.listeners.filter(entry => entry !== listener) }
      this.listeners.push(listener)
    })
    return Object.assign(promise, { stop: () => stop() })
  }

  /** A phone pairs; the person answers `accept` (or nothing, with `null`). */
  async pair(options: { accept?: boolean | null; qr?: RemotePairingQr; phone?: Phone; name?: string } = {}): Promise<{ res: HttpResult; phone: Phone; qr: RemotePairingQr; prompt?: RemotePairingPrompt }> {
    const qr = options.qr ?? this.offer(), phone = options.phone ?? newPhone(), accept = options.accept === undefined ? true : options.accept
    let prompt: RemotePairingPrompt | undefined
    const waiting = this.nextPrompt()
    void waiting.then(value => {
      prompt = value
      if (accept !== null) this.gateway.answerPairing({ promptId: value.promptId, accept })
    }, () => undefined)
    try {
      const res = await request(qr, { body: JSON.stringify({ code: qr.code, deviceName: options.name ?? 'Pixel 8', publicKey: phone.publicKey }) })
      return { res, phone, qr, prompt }
    } finally { waiting.stop() }
  }

  /** Lets the per-address attempt window pass (the code on screen expires with it). */
  passAttemptWindow(): void { this.clock += 2 * 60_000 + 1 }

  async close(): Promise<void> {
    await this.gateway.stop()
    this.db.close()
  }
}

export const spkiDigest = (spki: Buffer): Uint8Array => createHash('sha256').update(spki).digest()
