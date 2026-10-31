// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { crc32 } from 'node:zlib'
import unzipper from 'unzipper'
import { afterEach, describe, expect, it } from 'vitest'
import { dosDateTime, isSafeZipName, writeZip, ZipLimitError, type ZipEntry } from '../electron/main/services/diagnostics/zip-writer'

const roots: string[] = []
function fixture(): string { const root = mkdtempSync(join(tmpdir(), 'oxe-zip-')); roots.push(root); return root }
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

const entries: ZipEntry[] = [
  { name: 'snapshot.json', data: Buffer.from(JSON.stringify({ processes: [{ kind: 'main', memoryBytes: 1 }] }, null, 2).repeat(40)) },
  { name: 'incidents.json', data: Buffer.from('[]') },
  { name: 'logs/main-log-tail.txt', data: Buffer.from('[2026-10-30 10:00:00.000] [info] started\n'.repeat(500)) },
  { name: 'empty.txt', data: Buffer.alloc(0) },
  { name: 'binary.bin', data: Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 7919) % 256)) }
]

/** Reads the archive the way an unzip tool does: the end record, then each central entry and the local header it points to. */
function structure(zip: Buffer) {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  expect(zip.readUInt16LE(end + 20)).toBe(0) // no comment, so the record sits at the very end
  const count = zip.readUInt16LE(end + 10)
  expect(zip.readUInt16LE(end + 8)).toBe(count)
  const size = zip.readUInt32LE(end + 12)
  let at = zip.readUInt32LE(end + 16)
  expect(at + size).toBe(end)
  const found: Array<{ name: string; method: number; crc: number; compressed: number; size: number; date: number; time: number; local: number }> = []
  for (let index = 0; index < count; index++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32)
    const item = {
      method: zip.readUInt16LE(at + 10), time: zip.readUInt16LE(at + 12), date: zip.readUInt16LE(at + 14), crc: zip.readUInt32LE(at + 16),
      compressed: zip.readUInt32LE(at + 20), size: zip.readUInt32LE(at + 24), local: zip.readUInt32LE(at + 42),
      name: zip.subarray(at + 46, at + 46 + nameLength).toString('ascii')
    }
    expect(zip.readUInt16LE(at + 8) & 0x0009).toBe(0) // no encryption, no data descriptor
    // The local header repeats what the central directory says.
    const local = item.local
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    expect(zip.readUInt16LE(local + 8)).toBe(item.method)
    expect(zip.readUInt32LE(local + 14)).toBe(item.crc)
    expect(zip.readUInt32LE(local + 18)).toBe(item.compressed)
    expect(zip.readUInt32LE(local + 22)).toBe(item.size)
    expect(zip.subarray(local + 30, local + 30 + zip.readUInt16LE(local + 26)).toString('ascii')).toBe(item.name)
    expect(zip.readUInt16LE(local + 10)).toBe(item.time)
    expect(zip.readUInt16LE(local + 12)).toBe(item.date)
    found.push(item)
    at += 46 + nameLength + extra + comment
  }
  return found
}

function validDos(date: number, time: number): boolean {
  const month = (date >> 5) & 0xf, day = date & 0x1f, hours = time >> 11, minutes = (time >> 5) & 0x3f, seconds = (time & 0x1f) * 2
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hours < 24 && minutes < 60 && seconds < 60
}

describe('zip writer', () => {
  it('writes local headers, a central directory and an end record that agree, with valid DOS times', () => {
    const zip = writeZip(entries, undefined, new Date(2026, 9, 30, 14, 5, 37))
    const found = structure(zip)
    expect(found.map(item => item.name)).toEqual(entries.map(entry => entry.name))
    for (const [index, item] of found.entries()) {
      expect([0, 8]).toContain(item.method)
      expect(item.size).toBe(entries[index].data.length)
      expect(item.crc).toBe(crc32(entries[index].data) >>> 0)
      expect(validDos(item.date, item.time), item.name).toBe(true)
    }
    expect(found.find(item => item.name === 'logs/main-log-tail.txt')!.method).toBe(8)
    expect(found.find(item => item.name === 'empty.txt')!.method).toBe(0)
    const { date, time } = dosDateTime(new Date(2026, 9, 30, 14, 5, 37))
    expect(found[0]).toMatchObject({ date, time })
    expect(date >> 9).toBe(2026 - 1980)
  })

  it('keeps DOS dates valid outside 1980-2107', () => {
    for (const when of [new Date(1970, 0, 1), new Date(2200, 5, 5), new Date(1999, 11, 31, 23, 59, 59)]) {
      const { date, time } = dosDateTime(when)
      expect(validDos(date, time), when.toISOString()).toBe(true)
    }
  })

  it('opens with unzipper: every entry has its exact bytes and its CRC', async () => {
    const zip = writeZip(entries)
    const directory = await unzipper.Open.buffer(zip)
    expect(directory.files.map(file => file.path)).toEqual(entries.map(entry => entry.name))
    for (const file of directory.files) {
      const content = await file.buffer()
      const expected = entries.find(entry => entry.name === file.path)!.data
      expect(content.equals(expected), file.path).toBe(true)
      expect(file.crc32 >>> 0).toBe(crc32(content) >>> 0)
    }
  })

  it('refuses names that are not plain ASCII paths of its own', () => {
    for (const name of ['../evil.txt', 'a/../../b', '/root.txt', '\\share\\x', 'C:/x.txt', 'C:x', 'a\\b.txt', 'café.txt', '', 'a//b', './a', 'a/']) {
      expect(isSafeZipName(name), name).toBe(false)
      expect(() => writeZip([{ name, data: Buffer.from('x') }]), name).toThrow('Invalid zip entry name')
    }
    expect(() => writeZip([{ name: 'a.txt', data: Buffer.from('1') }, { name: 'a.txt', data: Buffer.from('2') }])).toThrow('Duplicate')
    expect(isSafeZipName('logs/main-log-tail.txt')).toBe(true)
  })

  it('fails with a C3 code over the per-file or the total cap', () => {
    const big = { name: 'big.bin', data: Buffer.alloc(2048, 1) }
    expect(() => writeZip([big], { maxEntryBytes: 1024, maxTotalBytes: 1 << 20 })).toThrow(ZipLimitError)
    try { writeZip([big], { maxEntryBytes: 1024, maxTotalBytes: 1 << 20 }) } catch (error) { expect((error as ZipLimitError).code).toBe('diagnostics.bundle.fileTooLarge') }
    const random = randomBytes(3000) // does not compress
    try {
      writeZip([{ name: 'a.bin', data: random }, { name: 'b.bin', data: random }], { maxEntryBytes: 1 << 20, maxTotalBytes: 4000 })
      expect.unreachable()
    } catch (error) { expect((error as ZipLimitError).code).toBe('diagnostics.bundle.tooLarge') }
    expect(() => writeZip(Array.from({ length: 65_536 }, (_, index) => ({ name: `f${index}`, data: Buffer.alloc(0) })))).toThrow('65,535')
  })
})

/** bsdtar reads zip; GNU tar does not. Windows 10+ ships bsdtar as System32\tar.exe, which may sit behind Git's GNU tar on PATH. */
function bsdtar(): string | null {
  const candidates = [process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '', 'bsdtar', 'tar'].filter(Boolean)
  for (const command of candidates) {
    if (command.includes('System32') && !existsSync(command)) continue
    const version = spawnSync(command, ['--version'], { encoding: 'utf8' })
    if (version.status === 0 && /bsdtar|libarchive/i.test(version.stdout)) return command
  }
  return null
}

function hasUnzip(): boolean { return spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0 }

describe('zip writer with system tools', () => {
  const tar = bsdtar()
  it.skipIf(!tar)(`extracts with the system tar -xf (bsdtar)${tar ? '' : ': skipped, no bsdtar here (GNU tar cannot read zip)'}`, () => {
    const root = fixture(), archive = join(root, 'bundle.zip'), out = join(root, 'out')
    writeFileSync(archive, writeZip(entries))
    mkdirSync(out)
    const result = spawnSync(tar!, ['-xf', archive, '-C', out], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    for (const entry of entries) expect(readFileSync(join(out, entry.name)).equals(entry.data), entry.name).toBe(true)
  })

  it.skipIf(!hasUnzip())(`passes Info-ZIP unzip -t${hasUnzip() ? '' : ': skipped, unzip is not installed here'}`, () => {
    const root = fixture(), archive = join(root, 'bundle.zip')
    writeFileSync(archive, writeZip(entries))
    const result = spawnSync('unzip', ['-t', archive], { encoding: 'utf8' })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toMatch(/No errors detected/)
  })
})
