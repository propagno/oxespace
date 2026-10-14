import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/**
 * Integrity check for the RTK archive downloaded from GitHub Releases.
 *
 * The release publishes `checksums.txt` (`<sha256>  <file name>` per line) next to the
 * archives. Verifying it before extraction catches truncated transfers and an archive
 * swapped without its checksum. It does not protect against a compromised release, where
 * the attacker controls both files; that would need a pinned hash or a signature.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Parses `sha256sum` output into a map of file name to lowercase hex digest. */
export function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    // Binary mode prefixes the name with `*`; both forms are valid sha256sum output.
    const match = /^([0-9a-fA-F]{64}) [ *](.+?)\s*$/.exec(line)
    if (!match) continue
    const digest = match[1].toLowerCase()
    if (SHA256_HEX.test(digest)) result.set(match[2], digest)
  }
  return result
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Throws unless `archivePath` matches the digest published for `assetName`.
 * Fails closed: a missing checksums file entry is an error, never a pass.
 */
export async function verifyArchiveChecksum(archivePath: string, assetName: string, checksumsText: string): Promise<void> {
  const expected = parseChecksums(checksumsText).get(assetName)
  if (!expected) throw new Error(`RTK release has no published checksum for ${assetName}`)
  const actual = await sha256File(archivePath)
  if (actual !== expected) throw new Error(`RTK archive checksum mismatch for ${assetName}`)
}
