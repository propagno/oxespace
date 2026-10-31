import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import { isDerSignature, REMOTE_LIMITS, refreshSigningInput, type RemoteAuthResult } from '../../../../shared/remote/protocol'

/**
 * Access tokens for paired phones: `v1.<payload>.<mac>`, where the payload names the device and the expiry in the
 * desktop's clock, and the MAC is HMAC-SHA-256 with a key kept in `safeStorage`. The phone never computes validity;
 * the desktop does, so a phone with a wrong clock still works and cannot stretch a token.
 */

const MAX_TOKEN_LENGTH = 512

export type TokenCheck = { ok: true; deviceId: string; expiresAt: number } | { ok: false; code: 'unauthenticated' | 'token-expired' }

export class AccessTokens {
  constructor(private readonly key: Buffer, private readonly now: () => number = Date.now, private readonly ttlMs: number = REMOTE_LIMITS.accessTokenTtlMs) {
    if (key.length < 32) throw new Error('Token key too short')
  }

  issue(deviceId: string): RemoteAuthResult {
    const payload = Buffer.from(JSON.stringify({ d: deviceId, e: this.now() + this.ttlMs, n: randomBytes(9).toString('base64url') })).toString('base64url')
    const body = `v1.${payload}`
    return { accessToken: `${body}.${this.mac(body)}`, expiresInMs: this.ttlMs }
  }

  check(token: unknown): TokenCheck {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return { ok: false, code: 'unauthenticated' }
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return { ok: false, code: 'unauthenticated' }
    const expected = Buffer.from(this.mac(`v1.${parts[1]}`), 'base64url')
    if (!timingSafeEqual(expected, Buffer.from(parts[2], 'base64url'))) return { ok: false, code: 'unauthenticated' }
    let payload: { d?: unknown; e?: unknown }
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { d?: unknown; e?: unknown } } catch { return { ok: false, code: 'unauthenticated' } }
    if (typeof payload?.d !== 'string' || typeof payload.e !== 'number' || !Number.isFinite(payload.e)) return { ok: false, code: 'unauthenticated' }
    if (payload.e <= this.now()) return { ok: false, code: 'token-expired' }
    return { ok: true, deviceId: payload.d, expiresAt: payload.e }
  }

  private mac(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url')
  }
}

/**
 * Proof of possession for a refresh: an ECDSA P-256 / SHA-256 signature, by the key the device paired with, over
 * `refreshSigningInput(fp, deviceId, nonce)`. ASN.1 DER only (what Android's `SHA256withECDSA` gives); anything that is
 * not DER is refused before it reaches the crypto.
 */
export function verifyRefreshSignature(publicKeySpki: Buffer, fingerprint: string, deviceId: string, nonce: string, signature: string): boolean {
  if (!isDerSignature(signature)) return false
  const input = Buffer.from(refreshSigningInput(fingerprint, deviceId, nonce), 'utf8')
  try {
    const key = createPublicKey({ key: publicKeySpki, format: 'der', type: 'spki' })
    return verify('sha256', input, { key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'))
  } catch { return false }
}

/** An EC P-256 SubjectPublicKeyInfo, or null. */
export function readDevicePublicKey(spki: Buffer): Buffer | null {
  try {
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null
    // Re-encoded by Node, so what is stored is canonical and exactly a P-256 key.
    const canonical = key.export({ format: 'der', type: 'spki' })
    return canonical.equals(spki) ? canonical : null
  } catch { return null }
}

/** Constant-time equality of two strings whose length is public (a challenge, a code). */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8'), right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}
