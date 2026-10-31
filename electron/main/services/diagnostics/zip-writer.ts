import { crc32, deflateRawSync } from 'node:zlib'

/**
 * A minimal .zip writer for the diagnostics bundle (B8.3), on Node's zlib only: no dependency. One fixed format that
 * Windows Explorer, macOS Archive Utility, Info-ZIP `unzip` and bsdtar all open: each entry stored or deflated
 * (whichever is smaller), ASCII names chosen by the app, a central directory and an end record. No ZIP64, no
 * encryption, no extra fields, no comments. Swapping it for a library only means keeping `writeZip`.
 */
export interface ZipEntry { name: string; data: Buffer }

export interface ZipLimits {
  /** Bytes one entry may hold before compression. */
  maxEntryBytes: number
  /** Bytes the finished archive may take. */
  maxTotalBytes: number
}

/** Bounds of the bundle: generous for a log tail and a journal, far below what ZIP64 would need. */
export const ZIP_LIMITS: ZipLimits = { maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 }

/** Without ZIP64 an archive holds at most this many entries and 4 GiB. */
const MAX_ENTRIES = 0xffff
const MAX_32 = 0xffffffff

/** Over a size cap: carries the C3 code the window shows (`shared/messages.ts`). */
export class ZipLimitError extends Error {
  constructor(readonly code: 'diagnostics.bundle.fileTooLarge' | 'diagnostics.bundle.tooLarge') { super(code) }
}

/** Names are ours, never a path from outside: ASCII segments of letters, digits, `.`, `_` and `-`, joined by `/`. */
export function isSafeZipName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(name)) return false
  return name.split('/').every(segment => segment !== '.' && segment !== '..')
}

/** MS-DOS date and time (local, two-second steps, 1980 to 2107), as every zip header stores them. */
export function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  const clamped = year !== date.getFullYear()
  const month = clamped ? 1 : date.getMonth() + 1
  const day = clamped ? 1 : date.getDate()
  const [hours, minutes, seconds] = clamped ? [0, 0, 0] : [date.getHours(), date.getMinutes(), date.getSeconds()]
  return { date: ((year - 1980) << 9) | (month << 5) | day, time: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2) }
}

export function writeZip(entries: ZipEntry[], limits: ZipLimits = ZIP_LIMITS, modified = new Date()): Buffer {
  if (entries.length > MAX_ENTRIES) throw new Error('A zip without ZIP64 holds at most 65,535 entries.')
  const seen = new Set<string>()
  const { date, time } = dosDateTime(modified)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (!isSafeZipName(entry.name)) throw new Error('Invalid zip entry name.')
    if (seen.has(entry.name)) throw new Error('Duplicate zip entry name.')
    seen.add(entry.name)
    if (!Buffer.isBuffer(entry.data)) throw new Error('Zip entry data must be a Buffer.')
    if (entry.data.length > limits.maxEntryBytes || entry.data.length > MAX_32) throw new ZipLimitError('diagnostics.bundle.fileTooLarge')
    const deflated = deflateRawSync(entry.data)
    const stored = deflated.length >= entry.data.length
    const body = stored ? entry.data : deflated
    const name = Buffer.from(entry.name, 'ascii')
    const crc = crc32(entry.data) >>> 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0 (deflate)
    local.writeUInt16LE(0, 6) // flags: no data descriptor, no encryption
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4) // made by: Unix, 2.0, so `unzip` applies the mode below
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a regular file, rw-r--r--
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
    if (offset > limits.maxTotalBytes || offset > MAX_32) throw new ZipLimitError('diagnostics.bundle.tooLarge')
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  if (offset + directory.length + end.length > limits.maxTotalBytes) throw new ZipLimitError('diagnostics.bundle.tooLarge')
  return Buffer.concat([...locals, directory, end])
}
