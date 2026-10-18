/**
 * Decides whether a path an agent wants to touch is inside the workspace,
 * with the Windows-specific ways around a naive prefix check closed:
 * alternate data streams (`file.txt:hidden`), reserved device names (`CON`,
 * `NUL.txt`), trailing dots/spaces that Windows silently strips, 8.3 short
 * names (`PROGRA~1`) and `\\?\` / `\\.\` device prefixes.
 *
 * Pure: the caller supplies `realpath` (so the file system is never touched
 * here) to resolve symlinks and junctions for paths that exist.
 */
import { posix, win32 } from 'node:path'

export type PathVerdict =
  | { safe: true; resolved: string }
  | { safe: false; reason: 'outside-workspace' | 'device-name' | 'alternate-stream' | 'short-name' | 'device-prefix' | 'trailing-dot-or-space' | 'invalid' }

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function normalizeForCompare(path: string, windows: boolean): string {
  const base = windows ? win32.normalize(path).replace(/\\/g, '/') : posix.normalize(path)
  const trimmed = base.length > 1 ? base.replace(/\/+$/, '') : base
  return windows ? trimmed.toLowerCase() : trimmed
}

export interface PathSafetyOptions {
  windows?: boolean
  /** Resolves links for an existing path; returning the input means "no link" or "not found". */
  realpath?: (path: string) => string
}

export function checkWorkspacePath(workspaceRoot: string, candidate: string, options: PathSafetyOptions = {}): PathVerdict {
  const windows = options.windows ?? process.platform === 'win32'
  if (!candidate || candidate.includes('\0')) return { safe: false, reason: 'invalid' }

  if (windows) {
    // `\\?\` and `\\.\` bypass normalisation, so they are never trusted.
    if (/^[\\/]{2}[?.][\\/]/.test(candidate)) return { safe: false, reason: 'device-prefix' }
    // A colon is only valid as the drive designator at position 1.
    if (candidate.slice(2).includes(':') || (candidate.includes(':') && !/^[a-zA-Z]:/.test(candidate))) {
      return { safe: false, reason: 'alternate-stream' }
    }
    const segments = candidate.replace(/^[a-zA-Z]:/, '').split(/[\\/]+/).filter(Boolean)
    for (const segment of segments) {
      if (segment === '.' || segment === '..') continue
      if (RESERVED.test(segment.split('.')[0])) return { safe: false, reason: 'device-name' }
      if (/[. ]$/.test(segment)) return { safe: false, reason: 'trailing-dot-or-space' }
      if (/~\d/.test(segment)) return { safe: false, reason: 'short-name' }
    }
  }

  const path = windows ? win32 : posix
  const absolute = path.isAbsolute(candidate) ? candidate : path.join(workspaceRoot, candidate)
  const resolved = path.resolve(absolute)
  const real = options.realpath ? options.realpath(resolved) : resolved

  const root = normalizeForCompare(options.realpath ? options.realpath(path.resolve(workspaceRoot)) : path.resolve(workspaceRoot), windows)
  const target = normalizeForCompare(real, windows)
  const inside = target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`)
  return inside ? { safe: true, resolved: real } : { safe: false, reason: 'outside-workspace' }
}
