import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto'

/**
 * The gateway's self-signed TLS certificate (EC P-256, ECDSA with SHA-256), built with Node's crypto and a small DER
 * writer: Node reads X.509 but cannot make it, and no dependency is needed for one fixed certificate shape.
 *
 * It carries no host name or address: the phone pins its SHA-256 fingerprint from the pairing QR instead of checking
 * names, so the certificate survives a change of the desktop's LAN address.
 *
 * DER only: the certificate and its key are kept and read back as DER, and nothing here parses PEM text. PEM is only
 * written, at the moment the TLS server is made, because Node's TLS options take nothing else.
 */

export interface GatewayCertificate {
  /** The certificate, DER. Public. */
  der: Buffer
  /** The private key, PKCS#8 DER. Kept only encrypted with `safeStorage`. */
  keyDer: Buffer
}

const CERTIFICATE_YEARS = 10
const COMMON_NAME = 'OXESpace remote gateway'

const length = (size: number): Buffer => {
  if (size < 0x80) return Buffer.from([size])
  if (size < 0x100) return Buffer.from([0x81, size])
  if (size < 0x10000) return Buffer.from([0x82, size >> 8, size & 0xff])
  throw new Error('DER value too long')
}
const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}
const sequence = (...parts: Buffer[]): Buffer => tlv(0x30, ...parts)
const set = (...parts: Buffer[]): Buffer => tlv(0x31, ...parts)
const explicit = (tagNumber: number, inner: Buffer): Buffer => tlv(0xa0 + tagNumber, inner)
const octetString = (value: Buffer): Buffer => tlv(0x04, value)
const bitString = (value: Buffer, unusedBits = 0): Buffer => tlv(0x03, Buffer.from([unusedBits]), value)
const utf8String = (value: string): Buffer => tlv(0x0c, Buffer.from(value, 'utf8'))
const TRUE = Buffer.from([0x01, 0x01, 0xff])

/** A non-negative INTEGER from big-endian bytes. */
export function derInteger(bytes: Buffer): Buffer {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  const trimmed = bytes.subarray(start)
  return tlv(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed)
}

export function derOid(dotted: string): Buffer {
  const arcs = dotted.split('.').map(Number)
  const bytes = [arcs[0] * 40 + arcs[1]]
  for (const arc of arcs.slice(2)) {
    const chunk = [arc & 0x7f]
    for (let rest = Math.floor(arc / 128); rest > 0; rest = Math.floor(rest / 128)) chunk.unshift((rest & 0x7f) | 0x80)
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

/** UTCTime until 2049, GeneralizedTime after, as RFC 5280 asks. */
export function derTime(date: Date): Buffer {
  const pad = (value: number) => String(value).padStart(2, '0')
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  const year = date.getUTCFullYear()
  return year < 2050 ? tlv(0x17, Buffer.from(`${pad(year % 100)}${rest}`)) : tlv(0x18, Buffer.from(`${year}${rest}`))
}

const ECDSA_WITH_SHA256 = sequence(derOid('1.2.840.10045.4.3.2'))

export function createGatewayCertificate(now = Date.now()): GatewayCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const name = sequence(set(sequence(derOid('2.5.4.3'), utf8String(COMMON_NAME))))
  const notBefore = new Date(now - 24 * 60 * 60_000)
  const notAfter = new Date(now)
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + CERTIFICATE_YEARS)
  const serial = randomBytes(16)
  serial[0] &= 0x7f
  const extensions = sequence(
    // basicConstraints: not a CA (critical).
    sequence(derOid('2.5.29.19'), TRUE, octetString(sequence())),
    // keyUsage: digitalSignature (critical).
    sequence(derOid('2.5.29.15'), TRUE, octetString(bitString(Buffer.from([0x80]), 7))),
    // extKeyUsage: serverAuth.
    sequence(derOid('2.5.29.37'), octetString(sequence(derOid('1.3.6.1.5.5.7.3.1'))))
  )
  const tbs = sequence(
    explicit(0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    ECDSA_WITH_SHA256,
    name,
    sequence(derTime(notBefore), derTime(notAfter)),
    name,
    publicKey.export({ format: 'der', type: 'spki' }),
    explicit(3, extensions)
  )
  const signature = sign('sha256', tbs, privateKey)
  return {
    der: sequence(tbs, ECDSA_WITH_SHA256, bitString(signature)),
    keyDer: privateKey.export({ format: 'der', type: 'pkcs8' })
  }
}

/** A certificate from its DER, refusing anything else (PEM text included): exactly these bytes, or it throws. */
export function readCertificateDer(der: Buffer): X509Certificate {
  if (!Buffer.isBuffer(der) || der[0] !== 0x30) throw new Error('Not a DER certificate')
  const certificate = new X509Certificate(der)
  if (!certificate.raw.equals(der)) throw new Error('Not a DER certificate')
  return certificate
}

/** A PKCS#8 private key from its DER, refusing anything else (PEM text included). */
export function readPrivateKeyDer(der: Buffer): KeyObject {
  if (!Buffer.isBuffer(der) || der[0] !== 0x30) throw new Error('Not a DER private key')
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

/** The key's DER as the text `safeStorage` encrypts (base64), and back; anything that is not exactly that is refused. */
export const encodeKeyDer = (der: Buffer): string => der.toString('base64')
export function decodeKeyDer(text: string): Buffer {
  const der = /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? Buffer.from(text, 'base64') : Buffer.alloc(0)
  if (!der.length || der.toString('base64') !== text) throw new Error('Not a DER private key')
  return der
}

/** What the QR and the status carry: SHA-256 of the DER, 64 lowercase hex characters. */
export function certificateFingerprint(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex')
}
