import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import type { DelegationTask } from '../../../../shared/types/delegation'
const exec = promisify(execFile)

/** Only committed UTF-8 text blobs, never local dirty files or symlink targets. */
export async function collectEvidence(cwd: string, files: string[]): Promise<NonNullable<DelegationTask['evidence']>> {
  if (!Array.isArray(files) || files.length > 8) throw new Error('Select at most eight evidence files')
  const git = async (args: string[]) => (await exec('git', args, { cwd, windowsHide: true, timeout: 10000, maxBuffer: 70000 })).stdout
  const commit = (await git(['rev-parse', '--verify', 'HEAD^{commit}'])).trim()
  const result: NonNullable<DelegationTask['evidence']> = []
  let size = 0
  for (const path of [...new Set(files)]) {
    if (typeof path !== 'string' || path.length > 512 || !path || /[\\:\0\r\n]/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || /(^|\/)(\.env[^/]*|\.git|.*\.(pem|key|p12))($|\/)/i.test(path)) throw new Error('Invalid or sensitive evidence path')
    const mode = await git(['ls-tree', commit, '--', path])
    if (!/^100(644|755) blob /.test(mode) || mode.trim().split('\n').length !== 1) throw new Error('Evidence must be a committed regular file')
    const text = await git(['show', `${commit}:${path}`])
    size += Buffer.byteLength(text)
    if (size > 64000 || text.includes('\0') || text.includes('\uFFFD')) throw new Error('Evidence exceeds text/size limits')
    if (/-----BEGIN [^-]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(text)) throw new Error('Possible credential in evidence; redact before sharing')
    result.push({ path, commit, sha256: createHash('sha256').update(text).digest('hex'), text })
  }
  return result
}
