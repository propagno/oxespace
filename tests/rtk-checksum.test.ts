import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseChecksums, sha256File, verifyArchiveChecksum } from '../electron/main/services/rtk-checksum'

const sha = (data: string): string => createHash('sha256').update(data).digest('hex')

describe('RTK archive checksum', () => {
  let dir = ''
  const archive = 'rtk-archive-bytes'
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtk-checksum-'))
    writeFileSync(join(dir, 'rtk.zip'), archive)
  })
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

  describe('parseChecksums', () => {
    it('reads sha256sum text mode, binary mode and CRLF lines', () => {
      const a = sha('a'), b = sha('b'), c = sha('c')
      const map = parseChecksums(`${a}  first.zip\r\n${b} *second.tar.gz\n${c}  third file.zip\n`)
      expect(map.get('first.zip')).toBe(a)
      expect(map.get('second.tar.gz')).toBe(b)
      expect(map.get('third file.zip')).toBe(c)
    })

    it('normalises digests to lowercase and ignores malformed lines', () => {
      const upper = sha('a').toUpperCase()
      const map = parseChecksums(`${upper}  ok.zip\nnot a checksum line\n${'g'.repeat(64)}  bad.zip\n${sha('x').slice(0, 63)}  short.zip\n\n`)
      expect(map.get('ok.zip')).toBe(sha('a'))
      expect([...map.keys()]).toEqual(['ok.zip'])
    })

    it('returns an empty map for an HTML error page or empty input', () => {
      expect(parseChecksums('').size).toBe(0)
      expect(parseChecksums('<!doctype html><title>Not Found</title>').size).toBe(0)
    })
  })

  describe('verifyArchiveChecksum', () => {
    it('accepts an archive whose digest matches the published one', async () => {
      const text = `${sha('other')}  other.zip\n${sha(archive)}  rtk.zip\n`
      await expect(verifyArchiveChecksum(join(dir, 'rtk.zip'), 'rtk.zip', text)).resolves.toBeUndefined()
    })

    it('rejects a tampered or truncated archive', async () => {
      const text = `${sha('different bytes')}  rtk.zip\n`
      await expect(verifyArchiveChecksum(join(dir, 'rtk.zip'), 'rtk.zip', text)).rejects.toThrow(/checksum mismatch/)
    })

    it('fails closed when the release publishes no checksum for the asset', async () => {
      await expect(verifyArchiveChecksum(join(dir, 'rtk.zip'), 'rtk.zip', `${sha(archive)}  another.zip\n`)).rejects.toThrow(/no published checksum/)
      await expect(verifyArchiveChecksum(join(dir, 'rtk.zip'), 'rtk.zip', '')).rejects.toThrow(/no published checksum/)
    })

    it('does not match a file name that only shares a prefix', async () => {
      await expect(verifyArchiveChecksum(join(dir, 'rtk.zip'), 'rtk.zip', `${sha(archive)}  rtk.zip.sig\n`)).rejects.toThrow(/no published checksum/)
    })

    it('reports a missing archive instead of passing', async () => {
      await expect(verifyArchiveChecksum(join(dir, 'missing.zip'), 'rtk.zip', `${sha(archive)}  rtk.zip\n`)).rejects.toThrow()
    })
  })

  it('sha256File matches the reference digest', async () => {
    expect(await sha256File(join(dir, 'rtk.zip'))).toBe(sha(archive))
  })
})
